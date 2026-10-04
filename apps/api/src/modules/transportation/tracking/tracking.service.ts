import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShipmentStatus } from '@pulsar/shared';
import type { Prisma } from '@pulsar/database';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePodDto, CreateTrackingEventDto } from './dto/tracking.dto';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

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

  async createEvent(tenantId: string, userId: string, dto: CreateTrackingEventDto) {
    await Promise.all([
      this.ownership.assertOwnedIfSet('load', dto.loadId, tenantId),
      this.ownership.assertOwnedIfSet('shipment', dto.shipmentId, tenantId),
      this.ownership.assertOwnedIfSet('stop', dto.stopId, tenantId),
    ]);
    return this.prisma.trackingEvent.create({
      data: {
        tenantId,
        recordedById: userId,
        ...dto,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
      },
    });
  }

  /** `userId` is absent when the POD comes from the public driver link. */
  async createPod(
    tenantId: string,
    userId: string | undefined,
    dto: CreatePodDto,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const shipment = await tx.shipment.findFirst({
      where: { id: dto.shipmentId, tenantId },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    const existing = await tx.proofOfDelivery.findFirst({
      where: { tenantId, shipmentId: shipment.id },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A POD already exists for this shipment');
    }
    if (
      shipment.status !== ShipmentStatus.DELIVERED &&
      shipment.status !== ShipmentStatus.IN_TRANSIT
    ) {
      throw new BadRequestException(
        'POD can only be captured for IN_TRANSIT or DELIVERED shipments',
      );
    }
    return tx.proofOfDelivery.create({
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
