import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PARTY_ACCESS, type AuthUser, type PartyAccess } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import {
  ServicesCommerceService,
  type PartnerLinkConsumer,
} from '../../modules/business/services-commerce.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { partyParent } from './party-profile.service';
import { ConfirmIdentityDto, IdentityCandidatesDto, ReviewIdentityDto } from './party-profile.dto';

@Injectable()
export class PartyIdentityService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
    private readonly commerce: ServicesCommerceService,
  ) {}
  private async grants(actor: AuthUser) {
    const enabled = await this.modules.getEnabledKeys(actor.tenantId);
    return PARTY_ACCESS.filter((a) => enabled.has(a.module) && actor.permissions.includes(a.read));
  }
  async get(actor: AuthUser, access: PartyAccess, id: string) {
    const tenantId = actor.tenantId,
      grants = await this.grants(actor);
    const owner = await partyParent(this.db, tenantId, access.kind, id);
    const customer = grants.find((a) => a.kind === 'customer'),
      crm = grants.find((a) => a.kind === 'crm-company');
    const partnerGrants = grants.filter((a) => ['partner', 'client', 'supplier'].includes(a.kind));
    const editable = ['client', 'supplier', 'partner'].includes(access.kind);
    const summary = { id: true, name: true, updatedAt: true } as const;
    const groups: Array<{
      family: string;
      label: string;
      records: Array<{ id: string; name: string; updatedAt: Date }>;
      available: boolean;
    }> = [];
    if (editable) {
      const row = await this.db.businessPartner.findFirstOrThrow({
        where: { tenantId, id },
        select: { billingCustomerId: true, crmCompanyId: true },
      });
      if (customer)
        groups.push({
          family: 'customer',
          label: 'Client Transport / Facturation',
          available: true,
          records: row.billingCustomerId
            ? await this.db.customer.findMany({
                where: { tenantId, id: row.billingCustomerId },
                select: summary,
              })
            : [],
        });
      if (crm)
        groups.push({
          family: 'crm-company',
          label: 'Société CRM',
          available: true,
          records: row.crmCompanyId
            ? await this.db.crmCompany.findMany({
                where: { tenantId, id: row.crmCompanyId },
                select: summary,
              })
            : [],
        });
    } else {
      if (partnerGrants.length)
        groups.push({
          family: 'partner',
          label: 'Partenaire Services / Achats',
          available: true,
          records: await this.db.businessPartner.findMany({
            where: {
              tenantId,
              ...(access.kind === 'customer' ? { billingCustomerId: id } : { crmCompanyId: id }),
              OR: partnerGrants.map((a) =>
                a.kind === 'client'
                  ? { isCustomer: true }
                  : a.kind === 'supplier'
                    ? { isSupplier: true }
                    : {},
              ),
            },
            select: summary,
            take: 20,
            orderBy: { id: 'asc' },
          }),
        });
      if (access.kind === 'customer' && crm)
        groups.push({
          family: 'crm-company',
          label: 'Sociétés CRM liées directement (20 maximum)',
          available: true,
          records: await this.db.crmCompany.findMany({
            where: { tenantId, customerId: id },
            select: summary,
            take: 20,
            orderBy: { id: 'asc' },
          }),
        });
      if (access.kind === 'crm-company' && customer) {
        const row = await this.db.crmCompany.findFirstOrThrow({
          where: { tenantId, id },
          select: { customerId: true },
        });
        groups.push({
          family: 'customer',
          label: 'Client lié directement par le CRM',
          available: true,
          records: row.customerId
            ? await this.db.customer.findMany({
                where: { tenantId, id: row.customerId },
                select: summary,
              })
            : [],
        });
      }
    }
    return {
      owner,
      groups,
      canEdit: editable && actor.permissions.includes(access.manage),
      notice:
        'Les fiches et carnets restent distincts. Aucun contact, document, droit portail ou historique n’est fusionné. Le lien client peut être utilisé par la facturation Services; son changement est bloqué après usage.',
    };
  }
  async candidates(actor: AuthUser, access: PartyAccess, id: string, q: IdentityCandidatesDto) {
    await partyParent(this.db, actor.tenantId, access.kind, id);
    if (!(await this.grants(actor)).some((a) => a.kind === q.family))
      throw new ForbiddenException();
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where = {
      tenantId: actor.tenantId,
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };
    const select = { id: true, name: true, updatedAt: true } as const;
    const [items, total] =
      q.family === 'customer'
        ? await this.db.$transaction([
            this.db.customer.findMany({
              where: { ...where, isActive: true },
              select,
              skip,
              take,
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
            }),
            this.db.customer.count({ where: { ...where, isActive: true } }),
          ])
        : await this.db.$transaction([
            this.db.crmCompany.findMany({
              where,
              select,
              skip,
              take,
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
            }),
            this.db.crmCompany.count({ where }),
          ]);
    return paginated(items, total, page, pageSize);
  }
  async review(
    actor: AuthUser,
    access: PartyAccess,
    id: string,
    d: ReviewIdentityDto | ConfirmIdentityDto,
    confirm = false,
  ) {
    if (
      !['client', 'supplier', 'partner'].includes(access.kind) ||
      !['catalog', 'services', 'clients', 'support', 'purchasing'].includes(access.module)
    )
      throw new BadRequestException('Le rapprochement se fait depuis la fiche partenaire.');
    await partyParent(this.db, actor.tenantId, access.kind, id);
    if (
      d.reason.trim().length < 5 ||
      (d.billingCustomerId === undefined && d.crmCompanyId === undefined)
    )
      throw new BadRequestException('Choisissez un lien et précisez le motif.');
    return this.commerce.partnerLinks(
      actor,
      id,
      {
        expectedUpdatedAt: d.expectedUpdatedAt,
        ...(d.billingCustomerId !== undefined ? { billingCustomerId: d.billingCustomerId } : {}),
        ...(d.crmCompanyId !== undefined ? { crmCompanyId: d.crmCompanyId } : {}),
      },
      access.module as PartnerLinkConsumer,
      { reason: d.reason, confirm, token: 'reviewToken' in d ? d.reviewToken : undefined },
    );
  }
}
