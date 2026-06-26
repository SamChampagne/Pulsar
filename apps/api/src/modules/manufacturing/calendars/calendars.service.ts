import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateCalendarDto,
  CreateShiftDto,
  UpdateCalendarDto,
} from './dto/calendar.dto';

@Injectable()
export class CalendarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.WorkingCalendarWhereInput = {
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
      this.prisma.workingCalendar.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.workingCalendar.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const calendar = await this.prisma.workingCalendar.findFirst({
      where: { id, tenantId },
      include: { shifts: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] } },
    });
    if (!calendar) throw new NotFoundException('Working calendar not found');
    return calendar;
  }

  async create(tenantId: string, dto: CreateCalendarDto) {
    const existing = await this.prisma.workingCalendar.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Working calendar code "${dto.code}" already exists`);
    return this.prisma.workingCalendar.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateCalendarDto) {
    await this.get(tenantId, id);
    const { code: _code, ...data } = dto;
    const res = await this.prisma.workingCalendar.updateMany({ where: { id, tenantId }, data });
    if (res.count === 0) throw new NotFoundException('Working calendar not found');
    return this.prisma.workingCalendar.findFirstOrThrow({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const referencing = await this.prisma.workCenter.count({ where: { tenantId, calendarId: id } });
    if (referencing > 0) {
      throw new ConflictException('Working calendar is referenced by work centers');
    }
    await this.prisma.workingCalendar.deleteMany({ where: { id, tenantId } });
    return { id };
  }

  async listShifts(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.workCenterShift.findMany({
      where: { tenantId, calendarId: id },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
  }

  async addShift(tenantId: string, id: string, dto: CreateShiftDto) {
    await this.ownership.assertOwned('workingCalendar', id, tenantId);
    return this.prisma.workCenterShift.create({
      data: { ...dto, tenantId, calendarId: id },
    });
  }

  async removeShift(tenantId: string, id: string, shiftId: string) {
    const shift = await this.prisma.workCenterShift.findFirst({
      where: { id: shiftId, tenantId, calendarId: id },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    await this.prisma.workCenterShift.deleteMany({ where: { id: shiftId, tenantId, calendarId: id } });
    return { id: shiftId };
  }
}
