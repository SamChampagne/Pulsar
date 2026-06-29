import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateBomDto,
  CreateBomLineDto,
  UpdateBomDto,
  UpdateBomLineDto,
} from './dto/bom.dto';

@Injectable()
export class BomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.BomWhereInput = {
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
      this.prisma.bom.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.bom.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const bom = await this.prisma.bom.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!bom) throw new NotFoundException('BOM not found');
    return bom;
  }

  async create(tenantId: string, dto: CreateBomDto) {
    const existing = await this.prisma.bom.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`BOM code "${dto.code}" already exists`);
    return this.prisma.bom.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateBomDto) {
    const { code: _code, ...data } = dto;
    const res = await this.prisma.bom.updateMany({ where: { id, tenantId }, data });
    if (res.count === 0) throw new NotFoundException('BOM not found');
    return this.prisma.bom.findFirstOrThrow({
      where: { id, tenantId },
      include: { lines: true },
    });
  }

  async remove(tenantId: string, id: string) {
    const res = await this.prisma.bom.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException('BOM not found');
    return { success: true };
  }

  async addLine(tenantId: string, bomId: string, dto: CreateBomLineDto) {
    await this.assertBomOwned(tenantId, bomId);
    return this.prisma.bomLine.create({ data: { ...dto, bomId, tenantId } });
  }

  async updateLine(tenantId: string, bomId: string, lineId: string, dto: UpdateBomLineDto) {
    await this.assertLineOwned(tenantId, bomId, lineId);
    await this.prisma.bomLine.updateMany({
      where: { id: lineId, bomId, tenantId },
      data: dto,
    });
    return this.prisma.bomLine.findFirstOrThrow({ where: { id: lineId, bomId, tenantId } });
  }

  async removeLine(tenantId: string, bomId: string, lineId: string) {
    await this.assertLineOwned(tenantId, bomId, lineId);
    await this.prisma.bomLine.deleteMany({ where: { id: lineId, bomId, tenantId } });
    return { success: true };
  }

  private async assertBomOwned(tenantId: string, bomId: string) {
    const bom = await this.prisma.bom.findFirst({ where: { id: bomId, tenantId } });
    if (!bom) throw new NotFoundException('BOM not found');
    return bom;
  }

  private async assertLineOwned(tenantId: string, bomId: string, lineId: string) {
    const line = await this.prisma.bomLine.findFirst({
      where: { id: lineId, bomId, tenantId },
    });
    if (!line) throw new NotFoundException('BOM line not found');
    return line;
  }
}
