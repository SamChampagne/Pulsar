import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { AddCompanyContactsDto, AddMemberDto, CreateListDto, ListListQueryDto, UpdateListDto } from './dto/list.dto';

/**
 * CRM lists service. All operations are tenant-scoped (rule 1).
 * addMember is idempotent on the @@unique([listId,contactId]) constraint (catches P2002).
 */
@Injectable()
export class ListsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = { tenantId };
    const [items, total] = await Promise.all([
      this.prisma.crmList.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { members: true } } },
      }),
      this.prisma.crmList.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const list = await this.prisma.crmList.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { members: true } } },
    });
    if (!list) throw new NotFoundException('CRM list not found');
    return list;
  }

  async create(tenantId: string, dto: CreateListDto) {
    return this.prisma.crmList.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        ownerUserId: dto.ownerUserId ?? null,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateListDto) {
    const { count } = await this.prisma.crmList.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM list not found');
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    const { count } = await this.prisma.crmList.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('CRM list not found');
    return { deleted: true };
  }

  /** Add a contact to a list. Validates both belong to the tenant. Idempotent (P2002 caught). */
  async addMember(tenantId: string, listId: string, dto: AddMemberDto) {
    // Validate list belongs to tenant.
    const listExists = await this.prisma.crmList.findFirst({
      where: { id: listId, tenantId },
      select: { id: true },
    });
    if (!listExists) throw new NotFoundException('CRM list not found');

    // Validate contact belongs to tenant.
    const contactExists = await this.prisma.crmContact.findFirst({
      where: { id: dto.contactId, tenantId },
      select: { id: true },
    });
    if (!contactExists) throw new BadRequestException(`Unknown crm-contact "${dto.contactId}"`);

    try {
      return await this.prisma.crmListMember.create({
        data: { tenantId, listId, contactId: dto.contactId },
      });
    } catch (err) {
      // P2002 = unique constraint violation — already a member (idempotent).
      if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        const existing = await this.prisma.crmListMember.findFirst({
          where: { listId, contactId: dto.contactId },
        });
        return existing!;
      }
      throw err;
    }
  }

  /** Remove a contact from a list. */
  async removeMember(tenantId: string, listId: string, contactId: string) {
    // Validate list belongs to tenant.
    const listExists = await this.prisma.crmList.findFirst({
      where: { id: listId, tenantId },
      select: { id: true },
    });
    if (!listExists) throw new NotFoundException('CRM list not found');

    const { count } = await this.prisma.crmListMember.deleteMany({
      where: { listId, contactId, tenantId },
    });
    if (count === 0) throw new NotFoundException('Member not found in list');
    return { deleted: true };
  }

  /** List all members (joined contacts) for a list. Returns a Paginated flat shape. */
  async members(tenantId: string, listId: string, query?: ListListQueryDto) {
    const listExists = await this.prisma.crmList.findFirst({
      where: { id: listId, tenantId },
      select: { id: true },
    });
    if (!listExists) throw new NotFoundException('CRM list not found');

    const { page, pageSize, skip, take } = paginationArgs(query ?? {});
    const where = { listId, tenantId };
    const [rows, total] = await Promise.all([
      this.prisma.crmListMember.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
        include: {
          contact: { select: { id: true, name: true, email: true, title: true } },
        },
      }),
      this.prisma.crmListMember.count({ where }),
    ]);

    const items = rows.map((m) => ({
      id: m.id,
      contactId: m.contactId,
      name: m.contact.name,
      email: m.contact.email,
      title: m.contact.title,
    }));

    return paginated(items, total, page, pageSize);
  }

  /**
   * Add all contacts of a given company (with non-empty email) to the list.
   * Idempotent: duplicates are silently ignored.
   */
  async addCompanyContacts(tenantId: string, listId: string, dto: AddCompanyContactsDto) {
    const listExists = await this.prisma.crmList.findFirst({
      where: { id: listId, tenantId },
      select: { id: true },
    });
    if (!listExists) throw new NotFoundException('CRM list not found');

    const companyExists = await this.prisma.crmCompany.findFirst({
      where: { id: dto.companyId, tenantId },
      select: { id: true },
    });
    if (!companyExists) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);

    const contacts = await this.prisma.crmContact.findMany({
      where: {
        tenantId,
        companyId: dto.companyId,
        email: { not: null },
      },
      select: { id: true, email: true },
    });

    // Exclude empty-string emails so added/total counts are accurate.
    const eligible = contacts.filter((c) => c.email && c.email.trim().length > 0);

    let added = 0;
    for (const c of eligible) {
      try {
        await this.prisma.crmListMember.create({
          data: { tenantId, listId, contactId: c.id },
        });
        added++;
      } catch (err) {
        if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') continue; // already member
        throw err;
      }
    }
    return { added, total: eligible.length };
  }
}
