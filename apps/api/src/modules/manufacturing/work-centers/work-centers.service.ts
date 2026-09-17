import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWorkCenterDto, UpdateWorkCenterDto } from './dto/work-center.dto';

@Injectable()
export class WorkCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.WorkCenterWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workCenter.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: {
          calendar: {
            select: {
              locationId: true,
              location: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.workCenter.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const workCenter = await this.prisma.workCenter.findFirst({ where: { id, tenantId } });
    if (!workCenter) throw new NotFoundException('Work center not found');
    return workCenter;
  }

  async create(tenantId: string, dto: CreateWorkCenterDto) {
    const existing = await this.prisma.workCenter.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Work center code "${dto.code}" already exists`);
    await this.ownership.assertOwned('workingCalendar', dto.calendarId, tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      if (!(await tx.workingCalendar.findFirst({ where: { tenantId, id: dto.calendarId } })))
        throw new NotFoundException('Working calendar not found');
      return tx.workCenter.create({ data: { ...dto, tenantId } });
    });
  }

  async update(tenantId: string, id: string, dto: UpdateWorkCenterDto) {
    await this.ownership.assertOwnedIfSet('workingCalendar', dto.calendarId, tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const current = await tx.workCenter.findFirst({
        where: { id, tenantId },
        include: { calendar: true },
      });
      if (!current) throw new NotFoundException('Work center not found');
      if (dto.calendarId && dto.calendarId !== current.calendarId) {
        const next = await tx.workingCalendar.findFirst({
          where: { id: dto.calendarId, tenantId },
        });
        if (
          !next ||
          (current.calendar.locationId && current.calendar.locationId !== next.locationId)
        )
          throw new ConflictException('Un poste rattaché à un site ne peut pas changer de site.');
      }
      const { code: _code, ...data } = dto;
      await tx.workCenter.updateMany({ where: { id, tenantId }, data });
      return tx.workCenter.findFirstOrThrow({ where: { id, tenantId } });
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const removed = await tx.workCenter.deleteMany({ where: { id, tenantId } });
      if (!removed.count) throw new NotFoundException('Work center not found');
      return { id };
    });
  }
}
