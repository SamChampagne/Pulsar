import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { canTransitionCarrier, CarrierStatus } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCarrierDto, UpdateCarrierDto } from './dto/carrier.dto';

@Injectable()
export class CarriersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.CarrierWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { scacCode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.carrier.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.carrier.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id, tenantId },
      include: { drivers: true, vehicles: true, trailers: true },
    });
    if (!carrier) throw new NotFoundException('Carrier not found');
    return carrier;
  }

  async create(tenantId: string, dto: CreateCarrierDto) {
    const existing = await this.prisma.carrier.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Carrier code "${dto.code}" already exists`);
    return this.prisma.carrier.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateCarrierDto) {
    const current = await this.prisma.carrier
      .findFirstOrThrow({ where: { id, tenantId } })
      .catch(() => Promise.reject(new NotFoundException('Carrier not found')));
    const { code: _code, ...data } = dto;
    if (
      dto.status !== undefined &&
      dto.status !== current.status &&
      !canTransitionCarrier(current.status as CarrierStatus, dto.status)
    )
      throw new ConflictException('Transition du transporteur impossible.');
    const result = await this.prisma.carrier.updateMany({
      where: { id, tenantId, status: current.status },
      data,
    });
    if (!result.count) throw new ConflictException('Le transporteur a changé. Rechargez sa fiche.');
    return this.prisma.carrier.findFirstOrThrow({ where: { id, tenantId } });
  }
}
