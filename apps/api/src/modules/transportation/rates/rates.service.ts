import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { RateType } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRateDto, UpdateRateDto } from './dto/rate.dto';

const rateInclude = {
  carrier: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, code: true, name: true } },
  lane: { select: { id: true, name: true, originType: true, destinationType: true } },
  fuelTable: { select: { id: true, name: true } },
  breaks: { orderBy: { upToKg: 'asc' as const } },
  accessorialPrices: { include: { accessorial: { select: { id: true, code: true, name: true, unit: true } } } },
} satisfies Prisma.RateInclude;

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  private async assertReferences(tenantId: string, dto: UpdateRateDto) {
    await Promise.all([
      this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId),
      this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId),
      this.ownership.assertOwnedIfSet('lane', dto.laneId, tenantId),
      this.ownership.assertOwnedIfSet('fuelSurchargeTable', dto.fuelTableId, tenantId),
      ...(dto.accessorialPrices ?? []).map((p) =>
        this.ownership.assertOwned('accessorial', p.accessorialId, tenantId),
      ),
    ]);
  }

  /** Breaks only make sense for PER_HUNDREDWEIGHT; duplicate bounds rejected here, not as DB errors. */
  private assertBreaks(rateType: RateType | undefined, dto: UpdateRateDto) {
    if (!dto.breaks || dto.breaks.length === 0) return;
    if (rateType !== RateType.PER_HUNDREDWEIGHT) {
      throw new BadRequestException('Weight breaks are only allowed on PER_HUNDREDWEIGHT rates');
    }
    const bounds = dto.breaks.map((b) => b.upToKg);
    if (new Set(bounds).size !== bounds.length) {
      throw new BadRequestException('Duplicate upToKg bounds in weight breaks');
    }
  }

  /** Duplicate accessorial ids would violate the (rateId, accessorialId) unique — reject up front. */
  private assertAccessorialPrices(dto: UpdateRateDto) {
    if (!dto.accessorialPrices) return;
    const ids = dto.accessorialPrices.map((p) => p.accessorialId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate accessorials in the price list');
    }
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.RateWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rate.findMany({ where, skip, take, orderBy: { name: 'asc' }, include: rateInclude }),
      this.prisma.rate.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const rate = await this.prisma.rate.findFirst({ where: { id, tenantId }, include: rateInclude });
    if (!rate) throw new NotFoundException('Rate not found');
    return rate;
  }

  async create(tenantId: string, dto: CreateRateDto) {
    await this.assertReferences(tenantId, dto);
    this.assertBreaks(dto.rateType, dto);
    this.assertAccessorialPrices(dto);
    const { breaks, accessorialPrices, validFrom, validTo, ...scalars } = dto;
    return this.prisma.rate.create({
      data: {
        tenantId,
        ...scalars,
        validFrom: validFrom ? new Date(validFrom) : undefined,
        validTo: validTo ? new Date(validTo) : undefined,
        breaks: { create: breaks ?? [] },
        accessorialPrices: { create: accessorialPrices ?? [] },
      },
      include: rateInclude,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRateDto) {
    const existing = await this.get(tenantId, id);
    await this.assertReferences(tenantId, dto);
    this.assertBreaks((dto.rateType ?? existing.rateType) as RateType, dto);
    this.assertAccessorialPrices(dto);
    const { breaks, accessorialPrices, validFrom, validTo, ...scalars } = dto;

    // Nested collections are replaced wholesale when provided (PUT semantics).
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    if (breaks) {
      operations.push(this.prisma.rateBreak.deleteMany({ where: { rateId: id } }));
    }
    if (accessorialPrices) {
      operations.push(this.prisma.rateAccessorialPrice.deleteMany({ where: { rateId: id } }));
    }
    operations.push(
      this.prisma.rate.update({
        where: { id },
        data: {
          ...scalars,
          validFrom: validFrom ? new Date(validFrom) : undefined,
          validTo: validTo ? new Date(validTo) : undefined,
          ...(breaks ? { breaks: { create: breaks } } : {}),
          ...(accessorialPrices ? { accessorialPrices: { create: accessorialPrices } } : {}),
        },
        include: rateInclude,
      }),
    );
    const results = await this.prisma.$transaction(operations);
    return results[results.length - 1];
  }
}
