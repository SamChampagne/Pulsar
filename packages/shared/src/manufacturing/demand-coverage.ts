import type { MrpFlow } from './mrp';

export interface PlanningDemand {
  id: string;
  locationId: string;
  itemId: string;
  kind: string;
  quantity: string;
  dueDate: string;
  reference: string;
  isActive: boolean;
  forecastStart?: string | null;
  forecastId?: string | null;
  state?: 'OPEN' | 'FULFILLED' | 'CANCELLED';
}
export interface ForecastCoverage {
  forecastId: string;
  itemId: string;
  reference: string;
  quantity: string;
  periodStart: string;
  periodEnd: string;
  consumed: string;
  remaining: string;
  orders: { entryId: string; quantity: string; applied: string; state: string }[];
}

// MRP input precision is 3 decimals. Integer arithmetic keeps consumption exact,
// browser-safe and independent of Prisma/Python. No unit or site aggregation.
function units(value: string): bigint {
  if (!/^\d{1,10}(\.\d{1,3})?$/.test(value)) throw new Error('Invalid demand quantity');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
function decimal(value: bigint) {
  return `${value / 1000n}.${String(value % 1000n).padStart(3, '0')}`.replace(/\.?0+$/, '');
}

/** Explicit, one-forecast-per-demand consumption; fulfilled sales keep consuming
 * the forecast but no longer require production. Cancellation restores it. */
export function deriveDemandCoverage(entries: readonly PlanningDemand[]): {
  demands: MrpFlow[];
  forecasts: ForecastCoverage[];
} {
  const active = entries
    .filter((e) => e.isActive)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  if (new Set(active.map((e) => e.id)).size !== active.length) throw new Error('Duplicate demand');
  const forecasts = active.filter((e) => e.kind === 'FORECAST');
  const rows = new Map(
    forecasts.map((e) => [
      e.id,
      {
        forecastId: e.id,
        itemId: e.itemId,
        reference: e.reference,
        quantity: e.quantity,
        periodStart: e.forecastStart ?? '',
        periodEnd: e.dueDate,
        consumed: '0',
        remaining: e.quantity,
        orders: [],
      } as ForecastCoverage,
    ]),
  );
  const byId = new Map(forecasts.map((e) => [e.id, e]));
  const demands: MrpFlow[] = [];
  for (const entry of active.filter((e) => e.kind === 'DEMAND')) {
    const quantity = units(entry.quantity);
    const state = entry.state ?? 'OPEN';
    if (state === 'CANCELLED') continue;
    if (state === 'OPEN' && quantity > 0n)
      demands.push({
        id: entry.id,
        item_id: entry.itemId,
        quantity: decimal(quantity),
        date: entry.dueDate,
        reference: entry.reference,
      });
    const forecast = entry.forecastId ? byId.get(entry.forecastId) : undefined;
    if (!forecast) continue; // An inactive forecast never suppresses a firm demand.
    if (
      forecast.itemId !== entry.itemId ||
      forecast.locationId !== entry.locationId ||
      !forecast.forecastStart ||
      entry.dueDate < forecast.forecastStart ||
      entry.dueDate > forecast.dueDate
    )
      throw new Error('Incompatible forecast consumption');
    const row = rows.get(forecast.id)!;
    const remaining = units(row.remaining);
    const applied = quantity < remaining ? quantity : remaining;
    row.remaining = decimal(remaining - applied);
    row.consumed = decimal(units(row.consumed) + applied);
    row.orders.push({
      entryId: entry.id,
      quantity: entry.quantity,
      applied: decimal(applied),
      state,
    });
  }
  for (const forecast of forecasts) {
    const row = rows.get(forecast.id)!;
    if (units(row.remaining) > 0n)
      demands.push({
        id: forecast.id,
        item_id: forecast.itemId,
        quantity: row.remaining,
        date: forecast.dueDate,
        reference: forecast.reference,
      });
  }
  return { demands, forecasts: [...rows.values()] };
}
