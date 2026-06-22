import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFuelTableDto, FuelEntryDto, UpdateFuelTableDto } from './dto/fuel-table.dto';

const tableInclude = { entries: { orderBy: { effectiveFrom: 'desc' as const } } } as const;

@Injectable()
export class FuelTablesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertDistinctDates(entries: FuelEntryDto[]) {
    const dates = entries.map((e) => new Date(e.effectiveFrom).toISOString());
    if (new Set(dates).size !== dates.length) {
      throw new BadRequestException('Duplicate effectiveFrom dates in the entry set');
    }
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.FuelSurchargeTableWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fuelSurchargeTable.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: tableInclude,
      }),
      this.prisma.fuelSurchargeTable.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const table = await this.prisma.fuelSurchargeTable.findFirst({
      where: { id, tenantId },
      include: tableInclude,
    });
    if (!table) throw new NotFoundException('Fuel surcharge table not found');
    return table;
  }

  async create(tenantId: string, dto: CreateFuelTableDto) {
    this.assertDistinctDates(dto.entries ?? []);
    return this.prisma.fuelSurchargeTable.create({
      data: {
        tenantId,
        name: dto.name,
        entries: {
          create: (dto.entries ?? []).map((e) => ({
            effectiveFrom: new Date(e.effectiveFrom),
            pct: e.pct,
          })),
        },
      },
      include: tableInclude,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateFuelTableDto) {
    await this.get(tenantId, id);
    if (dto.entries) this.assertDistinctDates(dto.entries);
    await this.prisma.$transaction([
      ...(dto.entries
        ? [
            this.prisma.fuelSurchargeEntry.deleteMany({ where: { tableId: id } }),
            this.prisma.fuelSurchargeEntry.createMany({
              data: dto.entries.map((e) => ({
                tableId: id,
                effectiveFrom: new Date(e.effectiveFrom),
                pct: e.pct,
              })),
            }),
          ]
        : []),
      this.prisma.fuelSurchargeTable.updateMany({
        where: { id, tenantId },
        data: { name: dto.name },
      }),
    ]);
    return this.get(tenantId, id);
  }

  /** Restrict policy: refuse deletion while rates reference the table. */
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const rates = await this.prisma.rate.count({ where: { fuelTableId: id } });
    if (rates > 0) {
      throw new ConflictException(`Fuel table is referenced by ${rates} rate(s) — detach them first`);
    }
    try {
      await this.prisma.fuelSurchargeTable.deleteMany({ where: { id, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException('Fuel table is still referenced by rates');
      }
      throw e;
    }
    return { deleted: true };
  }
}
