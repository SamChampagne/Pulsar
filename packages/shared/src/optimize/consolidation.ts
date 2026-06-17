import { normalizeGeo } from '../rating/lane-key';

/**
 * Load consolidation optimizer (pure, browser-safe).
 *
 * Given a backlog of unassigned shipments, propose how to group them into loads
 * that maximize trailer fill while respecting a 3-axis capacity (weight / volume /
 * pallets) and lane compatibility (same origin→destination city pair). It never
 * mutates anything — the UI applies a chosen group through the existing atomic
 * POST /loads/consolidate endpoint, which re-checks capacity/ownership server-side.
 *
 * Strategy: bucket by normalized lane key, then First-Fit-Decreasing bin-packing
 * inside each bucket. Deterministic ordering throughout so the same backlog always
 * yields the same suggestions.
 */

export interface ConsolidationShipment {
  id: string;
  shipmentNumber: string;
  originCity: string;
  destinationCity: string;
  /** Missing dimensions are treated as 0 (they never block packing on that axis). */
  weightKg: number;
  volumeM3: number;
  palletCount: number;
}

export interface CapacityProfile {
  weightKg: number;
  volumeM3: number;
  pallets: number;
  /** Hard cap so backlogs with no dimension data don't collapse into one giant load. */
  maxShipmentsPerLoad: number;
}

/** A representative 53' dry-van trailer. Display/suggestion default only. */
export const DEFAULT_TRAILER_CAPACITY: CapacityProfile = {
  weightKg: 18_000,
  volumeM3: 76,
  pallets: 26,
  maxShipmentsPerLoad: 12,
};

export interface ConsolidationGroup {
  laneKey: string;
  originCity: string;
  destinationCity: string;
  shipmentIds: string[];
  shipmentNumbers: string[];
  count: number;
  totals: { weightKg: number; volumeM3: number; pallets: number };
  /** Per-axis utilization 0..1 against the capacity profile. */
  fill: { weight: number; volume: number; pallets: number };
  /** The binding (highest) axis — how full the load is overall. */
  utilization: number;
}

export interface ConsolidationResult {
  groups: ConsolidationGroup[];
  /** Shipments not worth suggesting: lane singletons or oversized (one shipment > capacity). */
  oversized: string[];
  capacity: CapacityProfile;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function exceedsAlone(s: ConsolidationShipment, cap: CapacityProfile): boolean {
  return s.weightKg > cap.weightKg || s.volumeM3 > cap.volumeM3 || s.palletCount > cap.pallets;
}

/** Deterministic "biggest first" ordering for FFD packing. */
function bySizeDesc(a: ConsolidationShipment, b: ConsolidationShipment): number {
  return (
    b.palletCount - a.palletCount ||
    b.weightKg - a.weightKg ||
    b.volumeM3 - a.volumeM3 ||
    a.shipmentNumber.localeCompare(b.shipmentNumber)
  );
}

export function suggestConsolidations(
  shipments: ConsolidationShipment[],
  capacity: CapacityProfile = DEFAULT_TRAILER_CAPACITY,
): ConsolidationResult {
  const cap = capacity;
  const oversized: string[] = [];

  // 1. Bucket by normalized lane (origin city → destination city).
  const lanes = new Map<string, ConsolidationShipment[]>();
  for (const s of shipments) {
    if (exceedsAlone(s, cap)) {
      oversized.push(s.id);
      continue;
    }
    const laneKey = `${normalizeGeo(s.originCity || '')}>${normalizeGeo(s.destinationCity || '')}`;
    const arr = lanes.get(laneKey) ?? [];
    arr.push(s);
    lanes.set(laneKey, arr);
  }

  const groups: ConsolidationGroup[] = [];

  for (const [laneKey, laneShipments] of lanes) {
    // Singletons carry no consolidation value — leave them in the backlog.
    if (laneShipments.length < 2) continue;

    const ordered = [...laneShipments].sort(bySizeDesc);
    const bins: ConsolidationShipment[][] = [];
    const binTotals: Array<{ w: number; v: number; p: number }> = [];

    for (const s of ordered) {
      let placed = false;
      for (let i = 0; i < bins.length; i++) {
        const t = binTotals[i];
        if (
          bins[i].length < cap.maxShipmentsPerLoad &&
          t.w + s.weightKg <= cap.weightKg &&
          t.v + s.volumeM3 <= cap.volumeM3 &&
          t.p + s.palletCount <= cap.pallets
        ) {
          bins[i].push(s);
          t.w += s.weightKg;
          t.v += s.volumeM3;
          t.p += s.palletCount;
          placed = true;
          break;
        }
      }
      if (!placed) {
        bins.push([s]);
        binTotals.push({ w: s.weightKg, v: s.volumeM3, p: s.palletCount });
      }
    }

    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      // Only a bin that actually merges ≥2 shipments is a useful suggestion.
      if (bin.length < 2) continue;
      const t = binTotals[i];
      const fill = {
        weight: cap.weightKg > 0 ? round2(t.w / cap.weightKg) : 0,
        volume: cap.volumeM3 > 0 ? round2(t.v / cap.volumeM3) : 0,
        pallets: cap.pallets > 0 ? round2(t.p / cap.pallets) : 0,
      };
      groups.push({
        laneKey,
        originCity: bin[0].originCity,
        destinationCity: bin[0].destinationCity,
        shipmentIds: bin.map((s) => s.id),
        shipmentNumbers: bin.map((s) => s.shipmentNumber),
        count: bin.length,
        totals: { weightKg: round2(t.w), volumeM3: round2(t.v), pallets: t.p },
        fill,
        utilization: Math.max(fill.weight, fill.volume, fill.pallets),
      });
    }
  }

  // Best fill first, then biggest merge, then stable by lane.
  groups.sort(
    (a, b) =>
      b.utilization - a.utilization || b.count - a.count || a.laneKey.localeCompare(b.laneKey),
  );

  return { groups, oversized, capacity: cap };
}
