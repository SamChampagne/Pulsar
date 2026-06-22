import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { ContactListQueryDto, CreateContactDto, UpdateContactDto } from './dto/contact.dto';

/**
 * CRM contacts service. All operations are tenant-scoped (rule 1).
 * companyId FK is validated inline (CrmCompany is not in OwnershipService's OwnedEntity
 * union, so we check directly — rule 9 pattern).
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, query: ContactListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmContact.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.crmContact.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const contact = await this.prisma.crmContact.findFirst({ where: { id, tenantId } });
    if (!contact) throw new NotFoundException('CRM contact not found');
    return contact;
  }

  async create(tenantId: string, userId: string, dto: CreateContactDto) {
    await this.assertCompanyOwned(dto.companyId, tenantId);

    const contact = await this.prisma.crmContact.create({
      data: {
        tenantId,
        name: dto.name,
        companyId: dto.companyId ?? null,
        title: dto.title ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        ownerUserId: dto.ownerUserId ?? null,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-contact',
      entityId: contact.id,
      after: { name: contact.name, companyId: contact.companyId },
    });

    return contact;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateContactDto) {
    await this.assertCompanyOwned(dto.companyId, tenantId);

    const { count } = await this.prisma.crmContact.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.companyId !== undefined ? { companyId: dto.companyId } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM contact not found');

    const contact = await this.get(tenantId, id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-contact',
      entityId: id,
      after: { name: contact.name, companyId: contact.companyId },
    });

    return contact;
  }

  /** Rule 9: validate companyId FK belongs to this tenant's CrmCompany. */
  private async assertCompanyOwned(companyId: string | undefined, tenantId: string) {
    if (!companyId) return;
    const company = await this.prisma.crmCompany.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) {
      throw new BadRequestException(`Unknown crm-company "${companyId}"`);
    }
  }
}
