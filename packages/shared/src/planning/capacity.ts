/** The three capacity axes of a trailer vs the totals of a load's shipments. */
export interface CapacityAxes {
  weightKg: number | null;
  volumeM3: number | null;
  pallets: number | null;
}

export type CapacityAxis = keyof CapacityAxes;

export interface CapacityExcess {
  axis: CapacityAxis;
  capacity: number;
  requested: number;
  excess: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compares requested totals against capacities, axis by axis. An axis with no
 * capacity entered OR no computable total is IGNORED (we don't verify what we
 * don't know). Exactly-at-capacity is not an excess. Empty result = nothing to flag.
 */
export function checkCapacity(capacities: CapacityAxes, totals: CapacityAxes): CapacityExcess[] {
  const excesses: CapacityExcess[] = [];
  for (const axis of ['weightKg', 'volumeM3', 'pallets'] as CapacityAxis[]) {
    const capacity = capacities[axis];
    const requested = totals[axis];
    if (capacity == null || requested == null) continue;
    const requestedRounded = round2(requested);
    if (requestedRounded > capacity) {
      excesses.push({
        axis,
        capacity,
        requested: requestedRounded,
        excess: round2(requestedRounded - capacity),
      });
    }
  }
  return excesses;
}
