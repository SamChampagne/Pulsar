import { Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus, deriveShipmentPickStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Outbound fulfillment view for the WMS: lists TMS shipments originating from a
 * WAREHOUSE location that still need to be prepared (PENDING/PLANNED), and a
 * single-shipment view with its linked pick orders. The "prepared" state is
 * DERIVED from the linked pick orders (deriveShipmentPickStatus, pure
 * @pulsar/shared) — never a new ShipmentStatus, never a dispatch block. All
 * reads are tenant-scoped (rule 1).
 */
@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  async pendingShipments(tenantId: string) {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        status: { in: [ShipmentStatus.PENDING, ShipmentStatus.PLANNED] as any },
        originLocation: { type: 'WAREHOUSE' },
      },
      orderBy: [{ plannedPickupEarly: 'asc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        originLocation: { select: { id: true, code: true, name: true } },
        destinationLocation: { select: { id: true, code: true, name: true } },
        pickOrders: { select: { id: true, number: true, status: true } },
      },
    });
    return shipments.map((s) => ({
      ...s,
      pickStatus: deriveShipmentPickStatus(s.pickOrders.map((p) => p.status as any)),
    }));
  }

  async shipmentFulfillment(tenantId: string, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      include: {
        originLocation: { select: { id: true, code: true, name: true } },
        destinationLocation: { select: { id: true, code: true, name: true } },
        pickOrders: {
          include: {
            lines: {
              include: {
                item: { select: { sku: true, name: true } },
                fromBin: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return {
      ...shipment,
      pickStatus: deriveShipmentPickStatus(shipment.pickOrders.map((p) => p.status as any)),
    };
  }
}
