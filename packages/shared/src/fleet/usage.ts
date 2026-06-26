// Pure fleet usage/cost helpers. Mirrored enums live in packages/database schema.prisma.

export enum OdometerSource {
  MANUAL = 'MANUAL',
  WORK_ORDER = 'WORK_ORDER',
  FUEL_LOG = 'FUEL_LOG',
}

export enum FuelUnit {
  L = 'L', // litres
  GAL = 'GAL', // US gallons
  KWH = 'KWH', // electric
}

/**
 * Cost per distance unit over a window. Returns null when distance is unknown or
 * non-positive (avoids divide-by-zero and meaningless ratios). Rounded to 4 decimals.
 */
export function costPerKm(totalCost: number, distanceKm: number): number | null {
  if (!Number.isFinite(totalCost) || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  return Math.round((totalCost / distanceKm) * 10000) / 10000;
}

/**
 * Fuel efficiency expressed as litres per 100 km (the common fleet metric).
 * GAL is converted to litres; KWH is returned as kWh/100km (same formula, unit differs).
 * Returns null when distance is unknown/non-positive.
 */
export function fuelEfficiencyPer100Km(
  volume: number,
  unit: OdometerSource | FuelUnit | string,
  distanceKm: number,
): number | null {
  if (!Number.isFinite(volume) || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const litres = unit === FuelUnit.GAL ? volume * 3.785411784 : volume;
  return Math.round((litres / distanceKm) * 100 * 100) / 100;
}

/**
 * Work-order total = parts subtotal + labour (hours × rate). All inputs optional;
 * missing components count as 0. Rounded to 2 decimals. This is the single source of
 * truth for WO cost once a WO is itemised (parts + labour), replacing a free costAmount.
 */
export function workOrderTotal(input: {
  partsCost?: number | null;
  laborHours?: number | null;
  laborRate?: number | null;
}): number {
  const parts = Number(input.partsCost ?? 0) || 0;
  const hours = Number(input.laborHours ?? 0) || 0;
  const rate = Number(input.laborRate ?? 0) || 0;
  return Math.round((parts + hours * rate) * 100) / 100;
}

/** Sum of part line totals (qty × unitCost), rounded to 2 decimals. */
export function partsSubtotal(parts: { qty: number; unitCost: number }[]): number {
  const sum = parts.reduce((acc, p) => acc + (Number(p.qty) || 0) * (Number(p.unitCost) || 0), 0);
  return Math.round(sum * 100) / 100;
}
