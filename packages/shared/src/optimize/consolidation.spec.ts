import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAILER_CAPACITY,
  suggestConsolidations,
  type CapacityProfile,
  type ConsolidationShipment,
} from './consolidation';

const cap: CapacityProfile = {
  weightKg: 10_000,
  volumeM3: 40,
  pallets: 20,
  maxShipmentsPerLoad: 12,
};

function ship(
  id: string,
  origin: string,
  dest: string,
  weightKg = 0,
  volumeM3 = 0,
  palletCount = 0,
): ConsolidationShipment {
  return {
    id,
    shipmentNumber: id.toUpperCase(),
    originCity: origin,
    destinationCity: dest,
    weightKg,
    volumeM3,
    palletCount,
  };
}

describe('suggestConsolidations', () => {
  it('groups same-lane shipments that fit together into one load', () => {
    const res = suggestConsolidations(
      [
        ship('a', 'Montréal', 'Toronto', 3000, 10, 6),
        ship('b', 'Montreal', 'toronto ', 3000, 10, 6),
      ],
      cap,
    );
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].count).toBe(2);
    expect(res.groups[0].shipmentIds.sort()).toEqual(['a', 'b']);
    expect(res.groups[0].totals.pallets).toBe(12);
    expect(res.groups[0].fill.pallets).toBe(0.6);
  });

  it('normalizes accents/case/whitespace into one lane (reuses normalizeGeo)', () => {
    const res = suggestConsolidations(
      [ship('a', 'Québec', 'Laval', 1000, 1, 2), ship('b', 'QUEBEC ', ' laval', 1000, 1, 2)],
      cap,
    );
    expect(res.groups).toHaveLength(1);
  });

  it('does not suggest different lanes together', () => {
    const res = suggestConsolidations(
      [ship('a', 'Montréal', 'Toronto', 1000, 1, 2), ship('b', 'Montréal', 'Ottawa', 1000, 1, 2)],
      cap,
    );
    expect(res.groups).toHaveLength(0);
  });

  it('splits a lane into multiple bins when capacity is exceeded (3-axis)', () => {
    // Three shipments of 8 pallets each, cap 20 → two bins (16 then 8); only the first merges 2.
    const res = suggestConsolidations(
      [ship('a', 'A', 'B', 0, 0, 8), ship('b', 'A', 'B', 0, 0, 8), ship('c', 'A', 'B', 0, 0, 8)],
      cap,
    );
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].count).toBe(2);
    expect(res.groups[0].totals.pallets).toBe(16);
  });

  it('flags an oversized shipment that cannot ride with anyone', () => {
    const res = suggestConsolidations(
      [
        ship('big', 'A', 'B', 0, 0, 30),
        ship('ok1', 'A', 'B', 0, 0, 5),
        ship('ok2', 'A', 'B', 0, 0, 5),
      ],
      cap,
    );
    expect(res.oversized).toEqual(['big']);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].shipmentIds.sort()).toEqual(['ok1', 'ok2']);
  });

  it('caps a no-dimension backlog at maxShipmentsPerLoad', () => {
    const many = Array.from({ length: 15 }, (_, i) => ship(`s${i}`, 'A', 'B'));
    const res = suggestConsolidations(many, { ...cap, maxShipmentsPerLoad: 5 });
    expect(res.groups.every((g) => g.count <= 5)).toBe(true);
  });

  it('orders suggestions by utilization then size', () => {
    const res = suggestConsolidations(
      [
        ship('l1', 'A', 'B', 0, 0, 2),
        ship('l2', 'A', 'B', 0, 0, 2),
        ship('h1', 'C', 'D', 0, 0, 9),
        ship('h2', 'C', 'D', 0, 0, 9),
      ],
      cap,
    );
    expect(res.groups[0].laneKey).toBe('c>d'); // 18/20 fill beats 4/20
  });

  it('exposes a default trailer profile', () => {
    expect(DEFAULT_TRAILER_CAPACITY.pallets).toBeGreaterThan(0);
  });
});
