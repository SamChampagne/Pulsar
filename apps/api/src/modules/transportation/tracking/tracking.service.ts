import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePodDto, CreateTrackingEventDto } from './dto/tracking.dto';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  listEvents(tenantId: string, filter: { loadId?: string; shipmentId?: string }) {
    if (!filter.loadId && !filter.shipmentId) {
      throw new BadRequestException('Provide loadId or shipmentId');
    }
    return this.prisma.trackingEvent.findMany({
      where: {
        tenantId,
        ...(filter.loadId ? { loadId: filter.loadId } : {}),
        ...(filter.shipmentId ? { shipmentId: filter.shipmentId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      include: {
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
        stop: { select: { id: true, sequence: true, type: true } },
      },
    });
  }

  createEvent(tenantId: string, userId: string, dto: CreateTrackingEventDto) {
    return this.prisma.trackingEvent.create({
      data: {
        tenantId,
        recordedById: userId,
        ...dto,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
      },
    });
  }

  async createPod(tenantId: string, userId: string, dto: CreatePodDto) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: dto.shipmentId, tenantId },
      include: { proofOfDelivery: true },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (shipment.proofOfDelivery) {
      throw new ConflictException('A POD already exists for this shipment');
    }
    if (shipment.status !== ShipmentStatus.DELIVERED && shipment.status !== ShipmentStatus.IN_TRANSIT) {
      throw new BadRequestException('POD can only be captured for IN_TRANSIT or DELIVERED shipments');
    }
    return this.prisma.proofOfDelivery.create({
      data: {
        tenantId,
        shipmentId: dto.shipmentId,
        signedByName: dto.signedByName,
        signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
        notes: dto.notes,
        receivedById: userId,
      },
    });
  }

  async getPod(tenantId: string, shipmentId: string) {
    const pod = await this.prisma.proofOfDelivery.findFirst({
      where: { tenantId, shipmentId },
      include: { receivedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!pod) throw new NotFoundException('No POD for this shipment');
    return pod;
  }
}
