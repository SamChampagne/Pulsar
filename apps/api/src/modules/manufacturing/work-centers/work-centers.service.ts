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
      this.prisma.workCenter.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
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
    return this.prisma.workCenter.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateWorkCenterDto) {
    await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('workingCalendar', dto.calendarId, tenantId);
    const { code: _code, ...data } = dto;
    const res = await this.prisma.workCenter.updateMany({ where: { id, tenantId }, data });
    if (res.count === 0) throw new NotFoundException('Work center not found');
    return this.prisma.workCenter.findFirstOrThrow({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.workCenter.deleteMany({ where: { id, tenantId } });
    return { id };
  }
}
