import { Injectable } from '@nestjs/common';
import { catalogFor, resolveSettings } from '@pulsar/shared';
import { PrismaService } from './prisma.service';
import { TenantModulesCacheService } from './tenant-modules-cache.service';

export type SequenceKey =
  | 'transport-order'
  | 'shipment'
  | 'load'
  | 'invoice'
  | 'customer-invoice'
  | 'bol'
  | 'receipt'
  | 'pick-order'
  | 'cycle-count'
  | 'dock-appointment'
  | 'yard-visit'
  | 'exception-case'
  | 'import-batch'
  | 'inbound-message'
  | 'rfp'
  | 'customer'
  | 'sales-order';

const PREFIXES: Record<SequenceKey, string> = {
  'transport-order': 'TO',
  shipment: 'SH',
  load: 'LD',
  invoice: 'INV',
  'customer-invoice': 'CINV',
  bol: 'BOL',
  receipt: 'RC',
  'pick-order': 'PK',
  'cycle-count': 'CC',
  'dock-appointment': 'DA',
  'yard-visit': 'YV',
  'exception-case': 'EC',
  'import-batch': 'IB',
  'inbound-message': 'IN',
  rfp: 'RFP',
  customer: 'CUST',
  'sales-order': 'SO',
};

/** Sequence keys whose prefix is overridable by a module tenant setting. */
const PREFIX_SETTING: Partial<Record<SequenceKey, { module: string; settingKey: string }>> = {
  'transport-order': { module: 'transportation', settingKey: 'documentPrefixTransportOrder' },
  shipment: { module: 'transportation', settingKey: 'documentPrefixShipment' },
  load: { module: 'transportation', settingKey: 'documentPrefixLoad' },
  invoice: { module: 'billing', settingKey: 'invoiceNumberPrefix' },
  'customer-invoice': { module: 'billing', settingKey: 'customerInvoiceNumberPrefix' },
  receipt: { module: 'wms', settingKey: 'documentPrefixReceipt' },
  'pick-order': { module: 'wms', settingKey: 'documentPrefixPickOrder' },
  'yard-visit': { module: 'yard', settingKey: 'documentPrefixYardVisit' },
  'dock-appointment': { module: 'yard', settingKey: 'documentPrefixDockAppointment' },
  rfp: { module: 'procurement', settingKey: 'documentPrefixRfp' },
};

/**
 * Per-tenant atomic document numbering backed by the number_sequences table.
 * The upsert-returning statement is a single atomic operation, so concurrent
 * callers always get distinct values (unlike the count-based v0 approach).
 *
 * For configurable document types (transport-order, shipment, load, invoice,
 * customer-invoice), the prefix is resolved from the tenant's module settings so
 * that operators can customise document numbers without forking the counter series
 * (the counter is always keyed on the SequenceKey, never the prefix — rule 8 preserved).
 *
 * NOTE: We read settings via TenantModulesCacheService + resolveSettings directly
 * rather than injecting ModuleSettingsService, because ModuleSettingsService lives
 * in ModuleRegistryModule which itself depends on TenantModulesCacheService
 * (PrismaModule) — importing ModuleRegistryModule here would create a circular
 * module dependency. The direct path is functionally identical.
 */
@Injectable()
export class SequencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantModulesCache: TenantModulesCacheService,
  ) {}

  async next(tenantId: string, key: SequenceKey): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO number_sequences (tenant_id, key, value)
      VALUES (${tenantId}, ${key}, 1)
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET value = number_sequences.value + 1
      RETURNING value`;
    return rows[0].value;
  }

  private async prefixFor(tenantId: string, key: SequenceKey): Promise<string> {
    const entry = PREFIX_SETTING[key];
    if (!entry) return PREFIXES[key];
    const cat = catalogFor(entry.module);
    if (!cat) return PREFIXES[key];
    // Resolve the module's storage row id to read its settings.
    const def = await this.prisma.moduleDefinition.findUnique({ where: { key: entry.module } });
    if (!def) return PREFIXES[key];
    const raw = await this.tenantModulesCache.getRawSettings(tenantId, def.id);
    const settings = resolveSettings(cat, raw);
    const v = settings[entry.settingKey];
    return typeof v === 'string' && v.length > 0 ? v : PREFIXES[key];
  }

  async nextNumber(tenantId: string, key: SequenceKey): Promise<string> {
    const value = await this.next(tenantId, key); // counter is keyed on `key`, never the prefix
    const prefix = await this.prefixFor(tenantId, key);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}
