import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BinListQueryDto, CreateBinDto, UpdateBinDto } from './dto/bin.dto';

@Injectable()
export class BinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: BinListQueryDto) {
    return this.prisma.bin.findMany({
      where: {
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.search ? { code: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { code: 'asc' },
      take: 200,
      include: { location: { select: { id: true, code: true, name: true } } },
    });
  }

  async get(tenantId: string, id: string) {
    const bin = await this.prisma.bin.findFirst({
      where: { id, tenantId },
      include: { location: { select: { id: true, code: true, name: true } } },
    });
    if (!bin) throw new NotFoundException('Bin not found');
    return bin;
  }

  private async assertWarehouseLocation(tenantId: string, locationId: string) {
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true, type: true },
    });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.type !== 'WAREHOUSE') {
      throw new BadRequestException('Bins require a WAREHOUSE location');
    }
  }

  async create(tenantId: string, dto: CreateBinDto) {
    await this.assertWarehouseLocation(tenantId, dto.locationId);
    try {
      return await this.prisma.bin.create({ data: { ...dto, tenantId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bin code already exists in this location');
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateBinDto) {
    await this.get(tenantId, id);
    if (dto.locationId) await this.assertWarehouseLocation(tenantId, dto.locationId);
    try {
      await this.prisma.bin.updateMany({ where: { id, tenantId }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bin code already exists in this location');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }
}
