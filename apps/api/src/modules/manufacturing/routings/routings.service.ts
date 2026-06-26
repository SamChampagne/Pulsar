import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateRoutingDto,
  CreateRoutingStepDto,
  UpdateRoutingDto,
  UpdateRoutingStepDto,
} from './dto/routing.dto';

@Injectable()
export class RoutingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.RoutingWhereInput = {
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
      this.prisma.routing.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.routing.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const routing = await this.prisma.routing.findFirst({
      where: { id, tenantId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (!routing) throw new NotFoundException('Routing not found');
    return routing;
  }

  async create(tenantId: string, dto: CreateRoutingDto) {
    const existing = await this.prisma.routing.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Routing code "${dto.code}" already exists`);
    return this.prisma.routing.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateRoutingDto) {
    const { code: _code, ...data } = dto;
    const res = await this.prisma.routing.updateMany({ where: { id, tenantId }, data });
    if (res.count === 0) throw new NotFoundException('Routing not found');
    return this.prisma.routing.findFirstOrThrow({
      where: { id, tenantId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const res = await this.prisma.routing.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException('Routing not found');
    return { success: true };
  }

  async addStep(tenantId: string, routingId: string, dto: CreateRoutingStepDto) {
    await this.assertRoutingOwned(tenantId, routingId);
    return this.prisma.routingStep.create({ data: { ...dto, routingId, tenantId } });
  }

  async updateStep(
    tenantId: string,
    routingId: string,
    stepId: string,
    dto: UpdateRoutingStepDto,
  ) {
    await this.assertStepOwned(tenantId, routingId, stepId);
    await this.prisma.routingStep.updateMany({
      where: { id: stepId, routingId, tenantId },
      data: dto,
    });
    return this.prisma.routingStep.findFirstOrThrow({
      where: { id: stepId, routingId, tenantId },
    });
  }

  async removeStep(tenantId: string, routingId: string, stepId: string) {
    await this.assertStepOwned(tenantId, routingId, stepId);
    await this.prisma.routingStep.deleteMany({ where: { id: stepId, routingId, tenantId } });
    return { success: true };
  }

  private async assertRoutingOwned(tenantId: string, routingId: string) {
    const routing = await this.prisma.routing.findFirst({ where: { id: routingId, tenantId } });
    if (!routing) throw new NotFoundException('Routing not found');
    return routing;
  }

  private async assertStepOwned(tenantId: string, routingId: string, stepId: string) {
    const step = await this.prisma.routingStep.findFirst({
      where: { id: stepId, routingId, tenantId },
    });
    if (!step) throw new NotFoundException('Routing step not found');
    return step;
  }
}
