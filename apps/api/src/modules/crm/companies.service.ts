import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CrmCompanyStatus, CustomFieldEntity } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../core/custom-fields/custom-fields.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { CompanyListQueryDto, CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { lockBusinessTenant } from '../business/business-lock';
import { assertCompanyCustomerLink } from '../business/identity-links';

/**
 * CRM companies service. All operations are tenant-scoped (rule 1).
 * FK references (customerId, carrierId) are validated via OwnershipService (rule 9).
 * customData is validated via CustomFieldsService before persisting (rule 35).
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(tenantId: string, query: CompanyListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.status ? { status: query.status as CrmCompanyStatus } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmCompany.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.crmCompany.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const company = await this.prisma.crmCompany.findFirst({
      where: { id, tenantId },
      include: {
        contacts: { orderBy: { createdAt: 'desc' } },
        deals: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!company) throw new NotFoundException('CRM company not found');
    return company;
  }

  async create(tenantId: string, userId: string, dto: CreateCompanyDto) {
    await this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);

    const customData = await this.customFields.validateValues(
      'crm',
      tenantId,
      CustomFieldEntity.CRM_COMPANY,
      dto.customData,
      { partial: false },
    );

    const company = await this.prisma.crmCompany.create({
      data: {
        tenantId,
        name: dto.name,
        domain: dto.domain ?? null,
        industry: dto.industry ?? null,
        status: dto.status ?? CrmCompanyStatus.PROSPECT,
        ownerUserId: dto.ownerUserId ?? null,
        customerId: dto.customerId ?? null,
        carrierId: dto.carrierId ?? null,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-company',
      entityId: company.id,
      after: { name: company.name, status: company.status },
    });

    return company;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCompanyDto) {
    await this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);

    const customData = await this.customFields.validateValues(
      'crm',
      tenantId,
      CustomFieldEntity.CRM_COMPANY,
      dto.customData,
      { partial: true },
    );

    const { count } = await this.prisma.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      if (dto.customerId !== undefined)
        await assertCompanyCustomerLink(tx, tenantId, id, dto.customerId ?? null);
      return tx.crmCompany.updateMany({
        where: { id, tenantId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.domain !== undefined ? { domain: dto.domain } : {}),
          ...(dto.industry !== undefined ? { industry: dto.industry } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
          ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
          ...(dto.carrierId !== undefined ? { carrierId: dto.carrierId } : {}),
          ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
        },
      });
    });
    if (count === 0) throw new NotFoundException('CRM company not found');

    const company = await this.get(tenantId, id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-company',
      entityId: id,
      after: { name: company.name, status: company.status },
    });

    return company;
  }
}
