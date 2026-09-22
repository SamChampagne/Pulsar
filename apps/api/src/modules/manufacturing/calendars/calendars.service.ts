import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCalendarDto, CreateShiftDto, UpdateCalendarDto } from './dto/calendar.dto';

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
      this.prisma.workingCalendar.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: { location: { select: { id: true, code: true, name: true } } },
      }),
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
    await this.ownership.assertOwnedIfSet('location', dto.locationId, tenantId);
    const existing = await this.prisma.workingCalendar.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Working calendar code "${dto.code}" already exists`);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await this.validateSite(tx, tenantId, dto.locationId);
      return tx.workingCalendar.create({ data: { ...dto, tenantId } });
    });
  }

  private async validateSite(tx: Prisma.TransactionClient, tenantId: string, id?: string) {
    if (!id) return;
    if (
      !(await tx.location.findFirst({ where: { id, tenantId, type: 'WAREHOUSE', isActive: true } }))
    )
      throw new BadRequestException('Choisir un site entrepôt actif de cette entreprise.');
  }

  sites(tenantId: string) {
    return this.prisma.location.findMany({
      where: { tenantId, type: 'WAREHOUSE', isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
      take: 1000,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCalendarDto) {
    await this.ownership.assertOwnedIfSet('location', dto.locationId, tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const current = await tx.workingCalendar.findFirst({ where: { id, tenantId } });
      if (!current) throw new NotFoundException('Working calendar not found');
      if (dto.locationId !== undefined && dto.locationId !== current.locationId) {
        if (current.locationId)
          throw new ConflictException(
            'Le site est fixé. Créez un calendrier pour le nouveau site.',
          );
        if (!dto.expectedUpdatedAt)
          throw new ConflictException('Rechargez le calendrier avant de choisir son site.');
      }
      if (
        dto.expectedUpdatedAt &&
        new Date(dto.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()
      )
        throw new ConflictException('Le calendrier a changé. Rechargez-le.');
      await this.validateSite(tx, tenantId, dto.locationId);
      const { code: _code, expectedUpdatedAt: _version, ...data } = dto;
      await tx.workingCalendar.updateMany({
        where: { id, tenantId, updatedAt: current.updatedAt },
        data: {
          ...data,
          updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
        },
      });
      return tx.workingCalendar.findFirstOrThrow({ where: { id, tenantId } });
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const referencing = await tx.workCenter.count({ where: { tenantId, calendarId: id } });
      if (referencing > 0) {
        throw new ConflictException('Working calendar is referenced by work centers');
      }
      const removed = await tx.workingCalendar.deleteMany({ where: { id, tenantId } });
      if (!removed.count) throw new NotFoundException('Working calendar not found');
      return { id };
    });
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const calendar = await tx.workingCalendar.findFirst({ where: { tenantId, id } });
      if (!calendar) throw new NotFoundException('Working calendar not found');
      const shift = await tx.workCenterShift.create({
        data: { ...dto, tenantId, calendarId: id },
      });
      await tx.workingCalendar.updateMany({
        where: { id, tenantId },
        data: { updatedAt: new Date(Math.max(Date.now(), calendar.updatedAt.getTime() + 1)) },
      });
      return shift;
    });
  }

  async removeShift(tenantId: string, id: string, shiftId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const calendar = await tx.workingCalendar.findFirst({ where: { id, tenantId } });
      const shift = await tx.workCenterShift.findFirst({
        where: { id: shiftId, tenantId, calendarId: id },
      });
      if (!shift || !calendar) throw new NotFoundException('Shift not found');
      await tx.workCenterShift.deleteMany({ where: { id: shiftId, tenantId, calendarId: id } });
      await tx.workingCalendar.updateMany({
        where: { id, tenantId },
        data: { updatedAt: new Date(Math.max(Date.now(), calendar.updatedAt.getTime() + 1)) },
      });
      return { id: shiftId };
    });
  }
}
