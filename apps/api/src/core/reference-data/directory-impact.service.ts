import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  MODULE_KEYS as M,
  PERMISSIONS as P,
  DOCUMENT_COORDINATE_ROLES,
  directoryEntryImpact,
  type AuthUser,
  type CoordinateCopy,
  type DocumentCoordinates,
  type DirectoryImpactSource,
  type DirectoryImpactScope,
  type DirectoryImpactView,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { paginationArgs } from '../../common/pagination';
import { PartyDirectoryService, type OwnerKind } from './party-directory.service';
import { DocumentCoordinatesService } from './document-coordinates.service';
import { DirectoryImpactQueryDto } from './directory-impact.dto';

const catalog = [
  {
    key: 'service-quote',
    label: 'Devis Services',
    module: M.SERVICES,
    permission: P.SERVICES.READ,
    owner: 'partner',
    family: 'partner',
  },
  {
    key: 'customer-invoice',
    label: 'Factures clients',
    module: M.BILLING,
    permission: P.BILLING.CUSTOMER_INVOICES_READ,
    owner: 'customer',
    family: 'customer',
  },
  {
    key: 'transport-order',
    label: 'Commandes Transport',
    module: M.TRANSPORTATION,
    permission: P.TRANSPORTATION.ORDERS_READ,
    owner: 'customer',
    family: 'customer',
  },
  {
    key: 'crm-sales-order',
    label: 'Commandes CRM',
    module: M.CRM,
    permission: P.CRM.READ,
    owner: 'crm-company',
    family: 'crm-company',
  },
  {
    key: 'supplier-order',
    label: 'Commandes fournisseurs',
    module: M.PURCHASING,
    permission: P.PURCHASING.READ,
    owner: 'supplier',
    family: 'partner',
  },
] as const;
const select = { id: true, status: true, updatedAt: true, documentCoordinates: true } as const;
type Row = {
  id: string;
  number: string;
  status: string;
  updatedAt: Date;
  documentCoordinates: Prisma.JsonValue | null;
};
const href = (key: DirectoryImpactSource, id: string) => {
  const encoded = encodeURIComponent(id);
  switch (key) {
    case 'service-quote':
      return `/services/quotes?quoteId=${encoded}`;
    case 'customer-invoice':
      return `/invoices?statement=${encoded}`;
    case 'transport-order':
      return `/transport-orders/${encoded}`;
    case 'crm-sales-order':
      return `/crm/sales-orders/${encoded}`;
    case 'supplier-order':
      return `/purchasing?orderId=${encoded}`;
  }
};
@Injectable()
export class DirectoryImpactService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
    private readonly directory: PartyDirectoryService,
    private readonly coordinates: DocumentCoordinatesService,
  ) {}

  async get(
    actor: AuthUser,
    kind: OwnerKind,
    ownerId: string,
    entryId: string,
    q: DirectoryImpactQueryDto,
  ): Promise<DirectoryImpactView> {
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    const family = kind === 'customer' || kind === 'crm-company' ? kind : 'partner';
    const allowed = catalog.filter(
      (c) =>
        c.family === family && enabled.has(c.module) && actor.permissions.includes(c.permission),
    );
    // Same denial for absent rights, disabled modules and incompatible identity families.
    if (q.source && !allowed.some((c) => c.key === q.source))
      throw new ForbiddenException('Ce type de document n’est pas accessible.');
    const { page, pageSize, skip, take } = paginationArgs(q),
      scope = q.scope ?? 'DRAFT';
    // Count, selection and entry version share one read snapshot; no writer/lock or mutation.
    return this.db.$transaction(
      async (tx) => {
        const entry = await this.directory.entry(actor.tenantId, kind, ownerId, entryId, tx);
        const context = await this.coordinates.context(tx, actor.tenantId);
        const observedAt = new Date().toISOString();
        const where = (key: DirectoryImpactSource, s: DirectoryImpactScope) => ({
          tenantId: actor.tenantId,
          status: s === 'DRAFT' ? ('DRAFT' as const) : { not: 'DRAFT' as const },
          AND: [
            { documentCoordinates: { path: ['schemaVersion'], equals: 1 } },
            {
              documentCoordinates: {
                path: ['owner', 'kind'],
                equals: catalog.find((c) => c.key === key)!.owner,
              },
            },
            { documentCoordinates: { path: ['owner', 'id'], equals: ownerId } },
            {
              OR: DOCUMENT_COORDINATE_ROLES.map((role) => ({
                documentCoordinates: { path: ['entries', role, 'id'], equals: entryId },
              })),
            },
            ...(s === 'FROZEN'
              ? [{ documentCoordinates: { path: ['frozenAt'], not: Prisma.AnyNull } }]
              : []),
          ],
        });
        const query = (key: DirectoryImpactSource, s: DirectoryImpactScope) => {
          const base = where(key, s);
          switch (key) {
            case 'service-quote': {
              const w = { ...base, partnerId: ownerId };
              return {
                count: () => tx.serviceQuote.count({ where: w }),
                rows: () =>
                  tx.serviceQuote.findMany({
                    where: w,
                    select: { ...select, number: true },
                    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
                    skip,
                    take,
                  }),
              };
            }
            case 'customer-invoice': {
              const w = { ...base, customerId: ownerId };
              return {
                count: () => tx.customerInvoice.count({ where: w }),
                rows: () =>
                  tx.customerInvoice
                    .findMany({
                      where: w,
                      select: { ...select, invoiceNumber: true },
                      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
                      skip,
                      take,
                    })
                    .then((rows) =>
                      rows.map(({ invoiceNumber, ...r }) => ({ ...r, number: invoiceNumber })),
                    ),
              };
            }
            case 'transport-order': {
              const w = { ...base, customerId: ownerId };
              return {
                count: () => tx.transportOrder.count({ where: w }),
                rows: () =>
                  tx.transportOrder
                    .findMany({
                      where: w,
                      select: { ...select, orderNumber: true },
                      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
                      skip,
                      take,
                    })
                    .then((rows) =>
                      rows.map(({ orderNumber, ...r }) => ({ ...r, number: orderNumber })),
                    ),
              };
            }
            case 'crm-sales-order': {
              const w = { ...base, companyId: ownerId };
              return {
                count: () => tx.salesOrder.count({ where: w }),
                rows: () =>
                  tx.salesOrder.findMany({
                    where: w,
                    select: { ...select, number: true },
                    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
                    skip,
                    take,
                  }),
              };
            }
            case 'supplier-order': {
              const w = { ...base, supplierId: ownerId };
              return {
                count: () => tx.supplierOrder.count({ where: w }),
                rows: () =>
                  tx.supplierOrder.findMany({
                    where: w,
                    select: { ...select, number: true },
                    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
                    skip,
                    take,
                  }),
              };
            }
          }
        };
        const sources = await Promise.all(
          allowed.map(async (c) => ({
            key: c.key,
            label: c.label,
            drafts: await query(c.key, 'DRAFT').count(),
            frozen: await query(c.key, 'FROZEN').count(),
          })),
        );
        const source =
          q.source ??
          sources.find((s) => (scope === 'DRAFT' ? s.drafts : s.frozen) > 0)?.key ??
          sources[0]?.key ??
          null;
        const selected = sources.find((s) => s.key === source);
        const rows: Row[] = source ? await query(source, scope).rows() : [];
        return {
          entry: { id: entry.id, label: entry.label, version: entry.version },
          observedAt,
          ...context,
          sources,
          source,
          scope,
          page,
          pageSize,
          total: selected ? (scope === 'DRAFT' ? selected.drafts : selected.frozen) : 0,
          items: rows.map((row) => {
            const captured = row.documentCoordinates as unknown as DocumentCoordinates;
            return {
              id: row.id,
              number: row.number,
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
              href: href(source!, row.id),
              frozenAt: captured.frozenAt,
              roles: directoryEntryImpact(
                captured,
                entry as unknown as CoordinateCopy,
                context.referenceDate,
              ),
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
