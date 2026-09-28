import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  PARTY_WORKSPACE_SOURCES,
  partyWorkspaceHref,
  type AuthUser,
  type PartyAccess,
  type PartyWorkspaceSource,
  type PartyWorkspaceView,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { paginationArgs } from '../../common/pagination';
import { partyParent } from './party-profile.service';
import { PartyWorkspaceQueryDto } from './party-workspace.dto';

type RecordRow = { id: string; reference: string; title: string; status: string; updatedAt: Date };
type Reader = { count: () => Promise<number>; rows: () => Promise<RecordRow[]> };
const common = { id: true, status: true, updatedAt: true } as const;

@Injectable()
export class PartyWorkspaceService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  async get(
    actor: AuthUser,
    access: PartyAccess,
    id: string,
    q: PartyWorkspaceQueryDto,
  ): Promise<PartyWorkspaceView> {
    const tenantId = actor.tenantId;
    const enabled = await this.modules.getEnabledKeys(tenantId);
    // Defence in depth for future internal callers; the facade is statically guarded too.
    if (!enabled.has(access.module) || !actor.permissions.includes(access.read))
      throw new ForbiddenException();
    const allowed = PARTY_WORKSPACE_SOURCES.filter(
      (s) => enabled.has(s.module) && actor.permissions.includes(s.permission),
    );
    if (q.source && !allowed.some((s) => s.key === q.source))
      throw new ForbiddenException('Ce type de dossier n’est pas accessible.');
    const { page, pageSize, skip, take } = paginationArgs(q);
    const source = q.source ?? allowed[0]?.key ?? null;
    const family =
      access.kind === 'customer' || access.kind === 'crm-company' ? access.kind : 'partner';
    return this.db.$transaction(
      async (tx) => {
        const owner = await partyParent(tx, tenantId, access.kind, id);
        // One identity hop only. Never infer partner -> company -> customer (or its reverse).
        let customerId: string | null = family === 'customer' ? id : null;
        let companyId: string | null = family === 'crm-company' ? id : null;
        const needsCustomer = allowed.some((s) => s.family === 'customer');
        const needsCrm = allowed.some((s) => s.family === 'crm-company');
        if (family === 'partner' && (needsCustomer || needsCrm)) {
          const link = await tx.businessPartner.findFirstOrThrow({
            where: { tenantId, id },
            select: { billingCustomerId: needsCustomer, crmCompanyId: needsCrm },
          });
          customerId = link.billingCustomerId ?? null;
          companyId = link.crmCompanyId ?? null;
        } else if (family === 'crm-company' && needsCustomer) {
          customerId = (
            await tx.crmCompany.findFirstOrThrow({
              where: { tenantId, id },
              select: { customerId: true },
            })
          ).customerId;
        }
        const partner: Prisma.BusinessPartnerWhereInput = {
          tenantId,
          ...(family === 'partner'
            ? { id }
            : family === 'customer'
              ? { billingCustomerId: id }
              : { crmCompanyId: id }),
        };
        const customer: Prisma.CustomerWhereInput = { tenantId, id: customerId ?? { in: [] } };
        const company: Prisma.CrmCompanyWhereInput = {
          tenantId,
          ...(family === 'customer' ? { customerId: id } : { id: companyId ?? { in: [] } }),
        };
        const orderBy = [{ updatedAt: 'desc' as const }, { id: 'asc' as const }];
        const query = (key: PartyWorkspaceSource, search = ''): Reader => {
          const contains = { contains: search, mode: 'insensitive' as const };
          const numbered = { ...common, number: true, title: true } as const;
          const normalize = (
            rows: Array<{
              id: string;
              number: string;
              title: string;
              status: string;
              updatedAt: Date;
            }>,
          ) => rows.map(({ number, ...r }) => ({ ...r, reference: number }));
          const text = search ? { OR: [{ number: contains }, { title: contains }] } : {};
          const paging = { skip, take, orderBy };
          switch (key) {
            case 'service-project': {
              const where = { tenantId, partner, ...text };
              return {
                count: () => tx.serviceProject.count({ where }),
                rows: () =>
                  tx.serviceProject
                    .findMany({ where, select: numbered, ...paging })
                    .then(normalize),
              };
            }
            case 'service-job': {
              const where = { tenantId, project: { tenantId, partner }, ...text };
              return {
                count: () => tx.serviceJob.count({ where }),
                rows: () =>
                  tx.serviceJob.findMany({ where, select: numbered, ...paging }).then(normalize),
              };
            }
            case 'service-quote': {
              const where = { tenantId, partner, ...text };
              return {
                count: () => tx.serviceQuote.count({ where }),
                rows: () =>
                  tx.serviceQuote.findMany({ where, select: numbered, ...paging }).then(normalize),
              };
            }
            case 'support-case': {
              const where = { tenantId, partner, ...text };
              return {
                count: () => tx.supportCase.count({ where }),
                rows: () =>
                  tx.supportCase.findMany({ where, select: numbered, ...paging }).then(normalize),
              };
            }
            case 'customer-invoice': {
              const where = { tenantId, customer, ...(search ? { invoiceNumber: contains } : {}) };
              return {
                count: () => tx.customerInvoice.count({ where }),
                rows: () =>
                  tx.customerInvoice
                    .findMany({ where, select: { ...common, invoiceNumber: true }, ...paging })
                    .then((rows) =>
                      rows.map(({ invoiceNumber, ...r }) => ({
                        ...r,
                        reference: invoiceNumber,
                        title: 'Facture client',
                      })),
                    ),
              };
            }
            case 'crm-deal': {
              const where = { tenantId, company, ...(search ? { title: contains } : {}) };
              return {
                count: () => tx.crmDeal.count({ where }),
                rows: () =>
                  tx.crmDeal
                    .findMany({
                      where,
                      select: { id: true, title: true, stage: true, updatedAt: true },
                      ...paging,
                    })
                    .then((rows) =>
                      rows.map(({ stage, ...r }) => ({
                        ...r,
                        reference: 'Opportunité',
                        status: stage,
                      })),
                    ),
              };
            }
            case 'crm-order': {
              const where = { tenantId, company, ...(search ? { number: contains } : {}) };
              return {
                count: () => tx.salesOrder.count({ where }),
                rows: () =>
                  tx.salesOrder
                    .findMany({ where, select: { ...common, number: true }, ...paging })
                    .then((rows) =>
                      rows.map(({ number, ...r }) => ({
                        ...r,
                        reference: number,
                        title: 'Commande commerciale',
                      })),
                    ),
              };
            }
            case 'transport-order': {
              const where = { tenantId, customer, ...(search ? { orderNumber: contains } : {}) };
              return {
                count: () => tx.transportOrder.count({ where }),
                rows: () =>
                  tx.transportOrder
                    .findMany({ where, select: { ...common, orderNumber: true }, ...paging })
                    .then((rows) =>
                      rows.map(({ orderNumber, ...r }) => ({
                        ...r,
                        reference: orderNumber,
                        title: 'Commande Transport',
                      })),
                    ),
              };
            }
          }
        };
        // No query/count against forbidden sources. Counts and selected page share a snapshot.
        const sections = await Promise.all(
          allowed.map(async (s) => ({
            key: s.key,
            label: s.label,
            total: await query(s.key).count(),
            relation:
              s.family === family
                ? 'Dossiers de cette fiche'
                : s.family === 'partner'
                  ? 'Partenaire lié directement à cette fiche'
                  : s.family === 'customer'
                    ? 'Client de facturation lié directement à cette fiche'
                    : 'Société CRM liée directement à cette fiche',
          })),
        );
        const selected = source ? query(source, q.search?.trim()) : null;
        const rows = selected ? await selected.rows() : [];
        const total = selected ? await selected.count() : 0;
        return {
          owner: { id: owner.id, name: owner.name },
          observedAt: new Date().toISOString(),
          sections,
          source,
          items: rows.map((r) => ({
            ...r,
            updatedAt: r.updatedAt.toISOString(),
            href: partyWorkspaceHref(source!, r.id),
          })),
          total,
          page,
          pageSize,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
