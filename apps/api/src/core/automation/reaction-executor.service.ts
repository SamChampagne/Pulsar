import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { reactionByKey, type ReactionCommand, AuditAction } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { PickingService } from '../../modules/wms/picking/picking.service';
import { CustomerInvoicesService } from '../../modules/billing/customer-invoices.service';
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
    private readonly picking: PickingService,
    private readonly customerInvoices: CustomerInvoicesService,
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
      await this.picking.create(tenantId, userId, dto);
    }
  }

  private async draftCustomerInvoice(
    tenantId: string,
    userId: string,
    loadId: string,
  ): Promise<void> {
    if (!loadId) return;
    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, loadId },
      select: { transportOrder: { select: { customerId: true } } },
    });
    const customerIds = [...new Set(shipments.map((s) => s.transportOrder.customerId))];
    for (const customerId of customerIds) {
      try {
        await this.customerInvoices.createDrafts(tenantId, userId, customerId);
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

  private async serviceAccountUserId(tenantId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, email: 'service-account@pulsar.local' },
      select: { id: true },
    });
    if (!user) throw new Error(`service-account user missing for tenant ${tenantId}`);
    return user.id;
  }
}
