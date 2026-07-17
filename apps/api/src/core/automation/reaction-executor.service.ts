import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { reactionByKey, type ReactionCommand, AuditAction } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { CreatePickOrderDto } from '../../modules/wms/picking/dto/pick.dto';

const als = new AsyncLocalStorage<{ reactionRuleId: string }>();

export function currentReactionRuleId(): string | null {
  return als.getStore()?.reactionRuleId ?? null;
}

@Injectable()
export class ReactionExecutorService {
  private readonly logger = new Logger(ReactionExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly modules: TenantModulesCacheService,
    private readonly moduleRef: ModuleRef,
  ) {}

  runInReactionContext<T>(ruleId: string, fn: () => Promise<T>): Promise<T> {
    return als.run({ reactionRuleId: ruleId }, fn);
  }

  /** Idempotent, module-gated, best-effort. Never throws. */
  async executeCommand(tenantId: string, eventId: string, command: ReactionCommand): Promise<void> {
    const descriptor = reactionByKey(command.action);
    if (!descriptor) {
      this.logger.warn(`Unknown reaction "${command.action}" (rule ${command.ruleId})`);
      return;
    }

    // Module gating — no-op if a required module is disabled.
    const enabled = await this.modules.getEnabledKeys(tenantId).catch(() => new Set<string>());
    for (const m of descriptor.requiredModules) {
      if (!enabled.has(m)) return;
    }

    // Idempotency claim: insert the ledger row; on unique conflict, already executed → skip.
    try {
      await this.prisma.reactionExecution.create({
        data: {
          tenantId,
          eventId,
          ruleId: command.ruleId,
          action: command.action,
          status: 'EXECUTED',
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already done
      this.logger.error(`reaction ledger insert failed: ${String(e)}`);
      return;
    }

    // Execute the handler inside the anti-loop context.
    try {
      await this.runInReactionContext(command.ruleId, () => this.dispatch(tenantId, command));
      await this.audit
        .log({
          tenantId,
          action: AuditAction.UPDATE,
          entityType: 'reaction',
          entityId: `${command.ruleId}:${eventId}`,
          after: { action: command.action, args: command.args, status: 'EXECUTED' },
        })
        .catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`reaction ${command.action} (rule ${command.ruleId}) failed: ${msg}`);
      await this.prisma.reactionExecution
        .updateMany({
          where: { tenantId, eventId, ruleId: command.ruleId },
          data: { status: 'FAILED', error: msg.slice(0, 500) },
        })
        .catch(() => undefined);
      await this.audit
        .log({
          tenantId,
          action: AuditAction.UPDATE,
          entityType: 'reaction',
          entityId: `${command.ruleId}:${eventId}`,
          after: { action: command.action, status: 'FAILED', error: msg.slice(0, 500) },
        })
        .catch(() => undefined);
    }
  }

  private async dispatch(tenantId: string, command: ReactionCommand): Promise<void> {
    const sysUserId = await this.serviceAccountUserId(tenantId);
    switch (command.action) {
      case 'create_picks_for_order':
        return this.createPicksForOrder(tenantId, sysUserId, command.args['orderId']);
      case 'draft_customer_invoice':
        return this.draftCustomerInvoice(tenantId, sysUserId, command.args['loadId']);
      case 'open_maintenance_order':
        return this.openMaintenanceOrder(tenantId, sysUserId, command.args);
      case 'assign_dock_appointment':
        return this.assignDockAppointment(tenantId, sysUserId, command.args['visitId']);
      case 'close_delivered_transport_order':
        return this.closeDeliveredTransportOrder(tenantId, sysUserId, command.args['loadId']);
      case 'draft_invoice_from_sales_order':
        return this.draftInvoiceFromSalesOrder(tenantId, command.args);
      case 'fulfill_sales_order':
        return this.fulfillSalesOrder(tenantId, sysUserId, command.args);
      default:
        this.logger.warn(`No handler for reaction action "${command.action}"`);
    }
  }

  private async createPicksForOrder(
    tenantId: string,
    userId: string,
    orderId: string,
  ): Promise<void> {
    if (!orderId) return;

    // Lazy-resolve PickingService to avoid a circular JS require chain in the
    // module graph (AutomationModule → WmsModule → OperatingModule → AutomationModule).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PickingService } = require('../../modules/wms/picking/picking.service') as typeof import('../../modules/wms/picking/picking.service');
    const picking = this.moduleRef.get(PickingService, { strict: false });

    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        transportOrderId: orderId,
        originLocation: { type: 'WAREHOUSE' },
      },
      select: {
        id: true,
        originLocationId: true,
        pickOrders: { select: { id: true } },
      },
    });
    for (const s of shipments) {
      if (s.pickOrders.length > 0) continue; // idempotent at business level
      const dto = new CreatePickOrderDto();
      dto.locationId = s.originLocationId;
      dto.shipmentId = s.id;
      await picking.create(tenantId, userId, dto);
    }
  }

  private async draftCustomerInvoice(
    tenantId: string,
    userId: string,
    loadId: string,
  ): Promise<void> {
    if (!loadId) return;

    // Lazy-resolve CustomerInvoicesService to avoid a circular JS require chain.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CustomerInvoicesService } = require('../../modules/billing/customer-invoices.service') as typeof import('../../modules/billing/customer-invoices.service');
    const customerInvoices = this.moduleRef.get(CustomerInvoicesService, { strict: false });

    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, loadId },
      select: { transportOrder: { select: { customerId: true } } },
    });
    const customerIds = [...new Set(shipments.map((s) => s.transportOrder.customerId))];
    for (const customerId of customerIds) {
      try {
        await customerInvoices.createDrafts(tenantId, userId, customerId);
      } catch (err) {
        // "No ratable delivered orders" is an expected no-op (anti-double-billing).
        // Swallow it and continue to the next customer; only unexpected errors propagate.
        if (err instanceof BadRequestException) {
          this.logger.debug(
            `draft_customer_invoice: no ratable orders for customer ${customerId} on load ${loadId} — skipping`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  private async openMaintenanceOrder(
    tenantId: string,
    userId: string,
    args: Record<string, string>,
  ): Promise<void> {
    const assetKind = args['assetKind'];
    const assetId = args['assetId'];
    if (!assetId || (assetKind !== 'vehicle' && assetKind !== 'trailer')) return;

    // Idempotent: skip if an open (non-terminal) WO already exists for this asset.
    const open = await this.prisma.maintenanceOrder.findFirst({
      where: {
        tenantId,
        ...(assetKind === 'vehicle' ? { vehicleId: assetId } : { trailerId: assetId }),
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { id: true },
    });
    if (open) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MaintenanceService } = require('../../modules/fleet/maintenance/maintenance.service') as typeof import('../../modules/fleet/maintenance/maintenance.service');
    const maintenance = this.moduleRef.get(MaintenanceService, { strict: false });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CreateMaintenanceOrderDto } = require('../../modules/fleet/maintenance/dto/maintenance.dto') as typeof import('../../modules/fleet/maintenance/dto/maintenance.dto');
    const { MaintenanceType } = require('@pulsar/shared') as typeof import('@pulsar/shared');

    const dto = new CreateMaintenanceOrderDto();
    if (assetKind === 'vehicle') dto.vehicleId = assetId;
    else dto.trailerId = assetId;
    dto.type = MaintenanceType.PREVENTIVE;
    dto.description = args['name'] || 'Entretien préventif planifié';
    await maintenance.create(tenantId, userId, dto);
  }

  private async assignDockAppointment(
    tenantId: string,
    userId: string,
    visitId: string,
  ): Promise<void> {
    if (!visitId) return;
    const visit = await this.prisma.yardVisit.findFirst({
      where: { id: visitId, tenantId },
      select: { id: true, spotId: true, appointmentId: true },
    });
    if (!visit || visit.spotId || !visit.appointmentId) return; // already placed or no appointment
    const appt = await this.prisma.dockAppointment.findFirst({
      where: { id: visit.appointmentId, tenantId },
      select: { spotId: true },
    });
    if (!appt?.spotId) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VisitsService } = require('../../modules/yard/visits/visits.service') as typeof import('../../modules/yard/visits/visits.service');
    const visits = this.moduleRef.get(VisitsService, { strict: false });
    try {
      await visits.assign(tenantId, userId, visitId, { spotId: appt.spotId } as never);
    } catch (err) {
      // Spot became occupied (spotConflictPolicy=BLOCK) → benign no-op for an auto-assign.
      if (err instanceof ConflictException) return;
      throw err;
    }
  }

  private async closeDeliveredTransportOrder(
    tenantId: string,
    userId: string,
    loadId: string,
  ): Promise<void> {
    if (!loadId) return;
    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, loadId },
      select: { transportOrderId: true },
    });
    const orderIds = [...new Set(shipments.map((s) => s.transportOrderId).filter(Boolean))] as string[];
    if (orderIds.length === 0) return;
    const orders = await this.prisma.transportOrder.findMany({
      where: { tenantId, id: { in: orderIds }, status: 'COMPLETED' },
      select: { id: true },
    });
    if (orders.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TransportOrdersService } = require('../../modules/transportation/transport-orders/transport-orders.service') as typeof import('../../modules/transportation/transport-orders/transport-orders.service');
    const orderSvc = this.moduleRef.get(TransportOrdersService, { strict: false });
    for (const o of orders) {
      await orderSvc.close(tenantId, userId, o.id); // COMPLETED → CLOSED (canTransition)
    }
  }

  private async draftInvoiceFromSalesOrder(
    tenantId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const salesOrderId = String(args['salesOrderId'] ?? '');
    if (!salesOrderId) return;

    // Lazy-resolve CustomerInvoicesService to avoid a circular JS require chain.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CustomerInvoicesService } = require('../../modules/billing/customer-invoices.service') as typeof import('../../modules/billing/customer-invoices.service');
    const customerInvoices = this.moduleRef.get(CustomerInvoicesService, { strict: false });

    const userId = await this.serviceAccountUserId(tenantId);
    try {
      await customerInvoices.createDraftFromSalesOrder(tenantId, userId, salesOrderId);
    } catch (err) {
      // "No ratable orders" is an expected no-op — swallow it.
      if (err instanceof BadRequestException) {
        this.logger.debug(
          `draft_invoice_from_sales_order: no ratable orders for salesOrder ${salesOrderId} — skipping`,
        );
        return;
      }
      throw err;
    }
  }

  private async fulfillSalesOrder(
    tenantId: string,
    userId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const salesOrderId = String(args['salesOrderId'] ?? '');
    if (!salesOrderId) return;

    // Lazy-resolve SalesOrdersService to avoid a circular JS require chain
    // (AutomationModule must not statically import CrmModule — rule 38).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SalesOrdersService } = require('../../modules/crm/sales-orders.service') as typeof import('../../modules/crm/sales-orders.service');
    const salesOrders = this.moduleRef.get(SalesOrdersService, { strict: false });

    // Idempotent + claim-safe inside the service; returns a decision we log.
    const result = await salesOrders.fulfillFromTransport(tenantId, userId, salesOrderId);
    this.logger.debug(
      `fulfill_sales_order ${salesOrderId}: fulfilled=${result.fulfilled} reason=${result.reason}`,
    );
  }

  /**
   * The tenant's hidden service-account user, created lazily if absent (mirrors
   * ApiKeysService.ensureServiceUser). A tenant can wire automation reactions
   * before ever minting an API key or agent, so we must not assume the account
   * already exists. DISABLED → can never sign in; gives reaction writes a real
   * user id for audit/FK attribution (rule 13).
   */
  private async serviceAccountUserId(tenantId: string): Promise<string> {
    const email = 'service-account@pulsar.local';
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash: randomBytes(48).toString('hex'),
        firstName: 'Service',
        lastName: 'Account',
        status: 'DISABLED',
      },
      select: { id: true },
    });
    return created.id;
  }
}
