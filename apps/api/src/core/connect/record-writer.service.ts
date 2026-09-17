import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  getInboundHookTarget,
  type InboundHookTarget,
  type InboundHookTargetKey,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { CustomersService } from '../../modules/transportation/customers/customers.service';
import { CarriersService } from '../../modules/transportation/carriers/carriers.service';
import { VehiclesService } from '../../modules/transportation/vehicles/vehicles.service';
import { TrailersService } from '../../modules/transportation/trailers/trailers.service';
import { TransportOrdersService } from '../../modules/transportation/transport-orders/transport-orders.service';
import { ItemsService } from '../../modules/wms/items/items.service';

/**
 * Whoever the write is attributed to. For CSV it is the signed-in user with the
 * permissions carried by the JWT; for an inbound webhook it is the tenant's
 * service-account (rule 13) scoped to the SINGLE permission of the configured
 * target — so a receiver can never write outside what it was configured for.
 */
export interface RecordWritePrincipal {
  id: string;
  tenantId: string;
  permissions: readonly string[];
}

export interface HookWriteResult {
  entityType: string;
  entityId: string;
  /** false when an `*.upsert` matched an existing row on its natural key. */
  created: boolean;
  summary: string;
}

/**
 * Field allowlist per inbound-hook target.
 *
 * Security: the business services spread their DTO into `prisma.create`, so an
 * attacker-controlled mapping could otherwise smuggle `tenantId`, `id`,
 * `status` or `createdById` into the write. Same guarantee `coerceTypes` gives
 * the CSV path (column whitelist) — nothing outside this list is ever passed on.
 */
const HOOK_FIELDS: Record<InboundHookTargetKey, string[]> = {
  'transport-order.create': [
    'customerId',
    'customerCode',
    'originLocationId',
    'originCode',
    'destinationLocationId',
    'destinationCode',
    'customerReference',
    'requestedPickupEarly',
    'requestedPickupLate',
    'requestedDeliveryEarly',
    'requestedDeliveryLate',
    'totalWeightKg',
    'totalVolumeM3',
    'palletCount',
    'notes',
    'mode',
  ],
  'location.upsert': [
    'code',
    'name',
    'type',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
    'latitude',
    'longitude',
    'timezone',
  ],
  'customer.upsert': ['code', 'name', 'contactName', 'email', 'phone', 'notes'],
  'carrier.upsert': [
    'code',
    'name',
    'scacCode',
    'mcNumber',
    'dotNumber',
    'contactName',
    'email',
    'phone',
  ],
  'item.upsert': ['sku', 'name', 'unit', 'barcode', 'reorderPoint', 'reorderQty'],
};

/** Fields coerced to a number when the partner sent a numeric string. */
const NUMERIC_FIELDS = new Set([
  'latitude',
  'longitude',
  'totalWeightKg',
  'totalVolumeM3',
  'palletCount',
  'reorderPoint',
  'reorderQty',
]);

function pickAllowed(data: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;
    if (NUMERIC_FIELDS.has(key)) {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isNaN(n)) out[key] = n;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The single write surface of the ingestion plane: CSV import rows and inbound
 * webhook payloads both land here, so both get the same permission re-check,
 * the same field allowlist and the same business services (never raw Prisma
 * writes on domain tables).
 */
@Injectable()
export class ConnectRecordWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly locations: LocationsService,
    private readonly carriers: CarriersService,
    private readonly items: ItemsService,
    private readonly vehicles: VehiclesService,
    private readonly trailers: TrailersService,
    private readonly transportOrders: TransportOrdersService,
  ) {}

  /** No privilege escalation: the acting principal must hold the target permission. */
  private assertPermission(principal: RecordWritePrincipal, permission: string, label: string) {
    if (!principal.permissions.includes(permission)) {
      throw new ForbiddenException(`Permission "${permission}" is required to write ${label}`);
    }
  }

  // ---------------------------------------------------------------------------
  // CSV importer targets (customers | locations | carriers | items | vehicles | trailers)
  // ---------------------------------------------------------------------------

  async createImportRecord(
    principal: RecordWritePrincipal,
    targetKey: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const { tenantId, id: userId } = principal;
    switch (targetKey) {
      case 'customers':
        return this.customers.create(tenantId, data as never);
      case 'locations':
        return this.locations.create(tenantId, data as never);
      case 'carriers':
        return this.carriers.create(tenantId, data as never);
      case 'items':
        return this.items.create(tenantId, userId, data as never);
      case 'vehicles':
        return this.vehicles.create(tenantId, data as never);
      case 'trailers':
        return this.trailers.create(tenantId, data as never);
      default:
        throw new BadRequestException(`Unknown import target: "${targetKey}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound webhook targets
  // ---------------------------------------------------------------------------

  async writeHookTarget(
    principal: RecordWritePrincipal,
    targetKey: string,
    data: Record<string, unknown>,
  ): Promise<HookWriteResult> {
    const target = getInboundHookTarget(targetKey);
    if (!target) throw new BadRequestException(`Unknown inbound target: "${targetKey}"`);
    this.assertPermission(principal, target.permission, target.label);
    const payload = pickAllowed(data, HOOK_FIELDS[target.key]);

    switch (target.key) {
      case 'transport-order.create':
        return this.createTransportOrder(principal, payload);
      case 'location.upsert':
        return this.upsertLocation(principal, payload, target);
      case 'customer.upsert':
        return this.upsertCustomer(principal, payload, target);
      case 'carrier.upsert':
        return this.upsertCarrier(principal, payload, target);
      case 'item.upsert':
        return this.upsertItem(principal, payload, target);
    }
  }

  /**
   * A partner rarely knows Pulsar ids, so `customerCode` / `originCode` /
   * `destinationCode` are resolved against the tenant's own master data
   * (rule 1 — the lookup is tenant-scoped; explicit ids are re-asserted by
   * TransportOrdersService via OwnershipService, rule 9).
   */
  private async createTransportOrder(
    principal: RecordWritePrincipal,
    payload: Record<string, unknown>,
  ): Promise<HookWriteResult> {
    const { tenantId } = principal;
    const customerId =
      asString(payload.customerId) ??
      (await this.resolveCustomerIdByCode(tenantId, asString(payload.customerCode)));
    const originLocationId =
      asString(payload.originLocationId) ??
      (await this.resolveLocationIdByCode(tenantId, asString(payload.originCode)));
    const destinationLocationId =
      asString(payload.destinationLocationId) ??
      (await this.resolveLocationIdByCode(tenantId, asString(payload.destinationCode)));

    const missing = [
      customerId ? null : 'customerId/customerCode',
      originLocationId ? null : 'originLocationId/originCode',
      destinationLocationId ? null : 'destinationLocationId/destinationCode',
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`Unresolved reference(s): ${missing.join(', ')}`);
    }

    const {
      customerCode: _customerCode,
      originCode: _originCode,
      destinationCode: _destinationCode,
      customerId: _customerId,
      originLocationId: _originLocationId,
      destinationLocationId: _destinationLocationId,
      ...rest
    } = payload;

    const order = await this.transportOrders.create(tenantId, principal.id, {
      ...(rest as Record<string, never>),
      customerId: customerId!,
      originLocationId: originLocationId!,
      destinationLocationId: destinationLocationId!,
    });
    return {
      entityType: 'transport-order',
      entityId: order.id,
      created: true,
      summary: `Commande de transport ${order.orderNumber}`,
    };
  }

  private async resolveCustomerIdByCode(tenantId: string, code?: string) {
    if (!code) return undefined;
    const row = await this.prisma.customer.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    return row?.id;
  }

  private async resolveLocationIdByCode(tenantId: string, code?: string) {
    if (!code) return undefined;
    const row = await this.prisma.location.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    return row?.id;
  }

  private naturalKey(payload: Record<string, unknown>, target: InboundHookTarget): string {
    const field = target.naturalKey ?? 'code';
    const value = asString(payload[field]);
    if (!value) throw new BadRequestException(`Field "${field}" is required for ${target.key}`);
    return value;
  }

  private async upsertLocation(
    principal: RecordWritePrincipal,
    payload: Record<string, unknown>,
    target: InboundHookTarget,
  ): Promise<HookWriteResult> {
    const { tenantId } = principal;
    const code = this.naturalKey(payload, target);
    const existing = await this.prisma.location.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    const row = existing
      ? await this.locations.update(tenantId, existing.id, payload as never)
      : await this.locations.create(tenantId, payload as never);
    return {
      entityType: 'location',
      entityId: row.id,
      created: !existing,
      summary: `Lieu ${code}`,
    };
  }

  private async upsertCustomer(
    principal: RecordWritePrincipal,
    payload: Record<string, unknown>,
    target: InboundHookTarget,
  ): Promise<HookWriteResult> {
    const { tenantId } = principal;
    const code = this.naturalKey(payload, target);
    const existing = await this.prisma.customer.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    const row = existing
      ? await this.customers.update(tenantId, existing.id, payload as never)
      : await this.customers.create(tenantId, payload as never);
    return {
      entityType: 'customer',
      entityId: row.id,
      created: !existing,
      summary: `Client ${code}`,
    };
  }

  private async upsertCarrier(
    principal: RecordWritePrincipal,
    payload: Record<string, unknown>,
    target: InboundHookTarget,
  ): Promise<HookWriteResult> {
    const { tenantId } = principal;
    const code = this.naturalKey(payload, target);
    const existing = await this.prisma.carrier.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    const row = existing
      ? await this.carriers.update(tenantId, existing.id, payload as never)
      : await this.carriers.create(tenantId, payload as never);
    return {
      entityType: 'carrier',
      entityId: row.id,
      created: !existing,
      summary: `Transporteur ${code}`,
    };
  }

  private async upsertItem(
    principal: RecordWritePrincipal,
    payload: Record<string, unknown>,
    target: InboundHookTarget,
  ): Promise<HookWriteResult> {
    const { tenantId, id: userId } = principal;
    const sku = this.naturalKey(payload, target);
    const existing = await this.prisma.wmsItem.findFirst({
      where: { tenantId, sku },
      select: { id: true },
    });
    const row = existing
      ? await this.items.update(tenantId, existing.id, payload as never)
      : await this.items.create(tenantId, userId, payload as never);
    return {
      entityType: 'wms-item',
      entityId: row.id,
      created: !existing,
      summary: `Article ${sku}`,
    };
  }
}
