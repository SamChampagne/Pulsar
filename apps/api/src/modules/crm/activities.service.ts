import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CrmActivityType } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { ActivityListQueryDto, CreateActivityDto } from './dto/activity.dto';

/**
 * CRM activities service. All operations are tenant-scoped (rule 1).
 * Creating an activity on a deal bumps deal.lastActivityAt in the same transaction.
 * Subject FKs are validated via tenant-scoped lookups (rule 9 pattern).
 */
@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ActivityListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.search
        ? { body: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmActivity.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.crmActivity.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const activity = await this.prisma.crmActivity.findFirst({ where: { id, tenantId } });
    if (!activity) throw new NotFoundException('CRM activity not found');
    return activity;
  }

  /**
   * Create an activity. Validates subject FKs are tenant-owned.
   * If dealId is set, bumps deal.lastActivityAt in the same transaction.
   */
  async create(
    tenantId: string,
    dto: CreateActivityDto,
    author: { userId?: string; agentId?: string },
  ) {
    if (!dto.companyId && !dto.contactId && !dto.dealId) {
      throw new BadRequestException('At least one subject reference (companyId, contactId, or dealId) is required');
    }
    if (!author.userId && !author.agentId) {
      throw new BadRequestException('Activity must have at least one author (userId or agentId)');
    }

    await this.assertSubjectsOwned(dto, tenantId);

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.crmActivity.create({
        data: {
          tenantId,
          type: dto.type as CrmActivityType,
          body: dto.body,
          companyId: dto.companyId ?? null,
          contactId: dto.contactId ?? null,
          dealId: dto.dealId ?? null,
          dueAt: dto.dueAt ?? null,
          createdByUserId: author.userId ?? null,
          agentId: author.agentId ?? null,
        },
      });
      if (dto.dealId) {
        await tx.crmDeal.updateMany({
          where: { id: dto.dealId, tenantId },
          data: { lastActivityAt: new Date() },
        });
      }
      return activity;
    });
  }

  /** Mark an activity as completed (sets doneAt). */
  async complete(tenantId: string, id: string) {
    const { count } = await this.prisma.crmActivity.updateMany({
      where: { id, tenantId },
      data: { doneAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('CRM activity not found');
    return this.get(tenantId, id);
  }

  /** Rule 9: validate subject FKs belong to this tenant. */
  private async assertSubjectsOwned(dto: CreateActivityDto, tenantId: string) {
    if (dto.companyId) {
      const company = await this.prisma.crmCompany.findFirst({
        where: { id: dto.companyId, tenantId },
        select: { id: true },
      });
      if (!company) throw new BadRequestException(`Unknown crm-company "${dto.companyId}"`);
    }
    if (dto.contactId) {
      const contact = await this.prisma.crmContact.findFirst({
        where: { id: dto.contactId, tenantId },
        select: { id: true },
      });
      if (!contact) throw new BadRequestException(`Unknown crm-contact "${dto.contactId}"`);
    }
    if (dto.dealId) {
      const deal = await this.prisma.crmDeal.findFirst({
        where: { id: dto.dealId, tenantId },
        select: { id: true },
      });
      if (!deal) throw new BadRequestException(`Unknown crm-deal "${dto.dealId}"`);
    }
  }
}
