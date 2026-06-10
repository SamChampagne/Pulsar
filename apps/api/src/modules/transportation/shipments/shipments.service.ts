import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoadStatus, ShipmentStatus } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';

const shipmentInclude = {
  transportOrder: { select: { id: true, orderNumber: true, status: true } },
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  load: { select: { id: true, loadNumber: true, status: true } },
} satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Generates (or returns) the public read-only tracking link for this shipment. */
  async generateTrackingLink(tenantId: string, id: string) {
    const shipment = await this.get(tenantId, id);
    let token = shipment.trackingToken;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await this.prisma.shipment.update({ where: { id }, data: { trackingToken: token } });
    }
    return { url: `${this.config.get('WEB_URL', 'http://localhost:5173')}/track/${token}` };
  }

  async revokeTrackingLink(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.shipment.update({ where: { id }, data: { trackingToken: null } });
    return { revoked: true };
  }

  async list(tenantId: string, query: ListQueryDto & { status?: ShipmentStatus }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.ShipmentWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { shipmentNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: shipmentInclude,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      include: { ...shipmentInclude, proofOfDelivery: true },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  /** Consolidation step: attach a PENDING shipment to an OPEN load. */
  async assignToLoad(tenantId: string, id: string, loadId: string) {
    const shipment = await this.get(tenantId, id);
    if (shipment.status !== ShipmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING shipments can be assigned to a load');
    }
    const load = await this.prisma.load.findFirst({ where: { id: loadId, tenantId } });
    if (!load) throw new NotFoundException('Load not found');
    if (load.status !== LoadStatus.OPEN && load.status !== LoadStatus.PLANNED) {
      throw new BadRequestException('Shipments can only be added to OPEN or PLANNED loads');
    }
    return this.prisma.shipment.update({
      where: { id },
      data: { loadId, status: ShipmentStatus.PLANNED },
      include: shipmentInclude,
    });
  }

  async removeFromLoad(tenantId: string, id: string) {
    const shipment = await this.get(tenantId, id);
    if (shipment.status !== ShipmentStatus.PLANNED) {
      throw new BadRequestException('Only PLANNED shipments can be removed from a load');
    }
    return this.prisma.shipment.update({
      where: { id },
      data: { loadId: null, status: ShipmentStatus.PENDING },
      include: shipmentInclude,
    });
  }
}
