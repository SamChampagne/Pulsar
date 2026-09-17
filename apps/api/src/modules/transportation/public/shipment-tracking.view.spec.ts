import { NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildShipmentTrackingView,
  lastPositionsByLoad,
  trackingPositionVisible,
} from './shipment-tracking.view';

interface Event {
  loadId: string | null;
  latitude: number | null;
  longitude: number | null;
  occurredAt: Date;
}

function makePrisma(opts: { shipment?: Record<string, unknown> | null; events?: Event[] }) {
  const events = opts.events ?? [];
  const groupBy = jest.fn(async ({ where }: { where: { loadId: { in: string[] } } }) => {
    const byLoad = new Map<string, Date>();
    for (const event of events) {
      if (!event.loadId || !where.loadId.in.includes(event.loadId)) continue;
      if (event.latitude === null || event.longitude === null) continue;
      const known = byLoad.get(event.loadId);
      if (!known || known < event.occurredAt) byLoad.set(event.loadId, event.occurredAt);
    }
    return [...byLoad].map(([loadId, occurredAt]) => ({ loadId, _max: { occurredAt } }));
  });
  const findMany = jest.fn(
    async ({ where }: { where: { OR: Array<{ loadId: string; occurredAt: Date }> } }) =>
      events.filter((event) =>
        where.OR.some(
          (pair) =>
            pair.loadId === event.loadId &&
            pair.occurredAt.getTime() === event.occurredAt.getTime(),
        ),
      ),
  );
  const prisma = {
    trackingEvent: { groupBy, findMany },
    shipment: { findFirst: jest.fn(async () => opts.shipment ?? null) },
  } as unknown as PrismaService;
  return { prisma, groupBy, findMany };
}

describe('lastPositionsByLoad', () => {
  it('returns one point per load — the newest — and never touches the database for an empty list', async () => {
    const { prisma, groupBy } = makePrisma({ events: [] });
    await expect(lastPositionsByLoad(prisma, 't1', [null, undefined])).resolves.toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('keeps only the latest position of each load (no history)', async () => {
    const { prisma, groupBy, findMany } = makePrisma({
      events: [
        { loadId: 'l1', latitude: 1, longitude: 1, occurredAt: new Date('2026-09-01T08:00:00Z') },
        { loadId: 'l1', latitude: 2, longitude: 2, occurredAt: new Date('2026-09-01T09:00:00Z') },
        { loadId: 'l2', latitude: 3, longitude: 3, occurredAt: new Date('2026-09-01T07:00:00Z') },
      ],
    });

    const positions = await lastPositionsByLoad(prisma, 't1', ['l1', 'l2', 'l1']);

    expect(positions.get('l1')).toEqual({
      latitude: 2,
      longitude: 2,
      occurredAt: new Date('2026-09-01T09:00:00Z'),
    });
    expect(positions.get('l2')?.latitude).toBe(3);
    // Batched: two queries whatever the number of loads.
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    // The loads are deduplicated before hitting the database.
    expect(groupBy.mock.calls[0][0].where.loadId.in).toEqual(['l1', 'l2']);
  });
});

describe('trackingPositionVisible', () => {
  it('stops publishing a position once the shipment is delivered or closed (rule 20)', () => {
    expect(trackingPositionVisible(ShipmentStatus.IN_TRANSIT)).toBe(true);
    expect(trackingPositionVisible(ShipmentStatus.DISPATCHED)).toBe(true);
    expect(trackingPositionVisible(ShipmentStatus.DELIVERED)).toBe(false);
    expect(trackingPositionVisible(ShipmentStatus.CLOSED)).toBe(false);
  });
});

describe('buildShipmentTrackingView', () => {
  const shipment = {
    id: 's1',
    tenantId: 't1',
    shipmentNumber: 'SH-000001',
    status: ShipmentStatus.IN_TRANSIT,
    loadId: 'l1',
    plannedPickupEarly: null,
    plannedPickupLate: null,
    plannedDeliveryEarly: null,
    plannedDeliveryLate: null,
    actualPickupAt: null,
    actualDeliveryAt: null,
    tenant: { name: 'Shipper Inc' },
    originLocation: { city: 'Montréal', state: 'QC', latitude: 45, longitude: -73 },
    destinationLocation: { city: 'Toronto', state: 'ON', latitude: 43, longitude: -79 },
    proofOfDelivery: null,
    trackingEvents: [],
  };

  it('raises the caller wording when nothing matches — never revealing another scope', async () => {
    const { prisma } = makePrisma({ shipment: null });
    await expect(
      buildShipmentTrackingView(prisma, { id: 's1', tenantId: 't1' }, 'Shipment not found'),
    ).rejects.toThrow(new NotFoundException('Shipment not found'));
  });

  it('exposes one position and no internal reference (tenantId, loadId)', async () => {
    const { prisma } = makePrisma({
      shipment,
      events: [
        {
          loadId: 'l1',
          latitude: 45.5,
          longitude: -73.5,
          occurredAt: new Date('2026-09-01T09:00:00Z'),
        },
      ],
    });

    const view = await buildShipmentTrackingView(prisma, { trackingToken: 'tok' }, 'Unknown');

    expect(view.shipper).toBe('Shipper Inc');
    expect(view.lastPosition).toEqual({
      latitude: 45.5,
      longitude: -73.5,
      occurredAt: new Date('2026-09-01T09:00:00Z'),
    });
    const raw = JSON.stringify(view);
    expect(raw).not.toContain('tenantId');
    expect(raw).not.toContain('loadId');
  });

  it('suppresses the position of a delivered shipment', async () => {
    const { prisma, groupBy } = makePrisma({
      shipment: { ...shipment, status: ShipmentStatus.DELIVERED },
      events: [
        {
          loadId: 'l1',
          latitude: 45.5,
          longitude: -73.5,
          occurredAt: new Date('2026-09-01T09:00:00Z'),
        },
      ],
    });

    const view = await buildShipmentTrackingView(prisma, { trackingToken: 'tok' }, 'Unknown');

    expect(view.lastPosition).toBeNull();
    expect(groupBy).not.toHaveBeenCalled();
  });
});
