/** Operational estimates only. Never used as a tariff, invoice or fuel purchase. */
export interface DeliveryStopInput {
  sequence: number;
  type: string;
  locationId: string;
  shipmentId?: string | null;
  plannedArrivalEarly?: string | null;
  plannedArrivalLate?: string | null;
  plannedDepartureAt?: string | null;
  serviceMinutes?: number;
  idleMinutes?: number;
}
export interface DeliveryPlanOptions {
  startAt?: string;
  returnToStart?: boolean;
  serviceMinutes?: number;
  loadedLitersPer100Km?: number;
  emptyLitersPer100Km?: number;
  idleLitersPerHour?: number;
  pricePerLiter?: number;
  currency?: string;
}
export interface DeliveryLeg {
  distanceKm: number | null;
  durationMin: number | null;
  source: 'OSRM' | 'HAVERSINE' | 'UNKNOWN';
}
export interface DeliveryMatrix {
  distancesKm: (number | null)[][];
  durationsMin: (number | null)[][];
}
const round = (n: number, digits = 2) =>
  Math.round((n + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const instant = (s?: string | null) => (s ? Date.parse(s) : NaN);

/** A shipment must have one pickup followed by one delivery, never an invented load. */
export function deliveryOrderError(stops: DeliveryStopInput[]): string | null {
  const picked = new Set<string>(),
    delivered = new Set<string>();
  for (const s of stops) {
    if (!s.shipmentId) continue; // legacy unlinked stop: no inferred cargo
    if (s.type === 'PICKUP') {
      if (picked.has(s.shipmentId)) return 'Une expédition ne peut être ramassée deux fois.';
      picked.add(s.shipmentId);
    } else {
      if (!picked.has(s.shipmentId))
        return 'Le ramassage doit précéder la livraison de chaque expédition.';
      if (delivered.has(s.shipmentId)) return 'Une expédition ne peut être livrée deux fois.';
      delivered.add(s.shipmentId);
    }
  }
  return picked.size === delivered.size ? null : 'Chaque ramassage doit avoir sa livraison.';
}

export function deliveryCoverageError(
  stops: DeliveryStopInput[],
  shipments: { id: string; originLocationId: string; destinationLocationId: string }[],
): string | null {
  const error = deliveryOrderError(stops);
  if (error) return error;
  for (const stop of stops) {
    if (!stop.shipmentId) continue;
    const s = shipments.find((s) => s.id === stop.shipmentId);
    if (
      !s ||
      stop.locationId !== (stop.type === 'PICKUP' ? s.originLocationId : s.destinationLocationId)
    )
      return 'Un arrêt ne correspond plus à une expédition affectée et à son lieu de ramassage/livraison.';
  }
  for (const s of shipments)
    if (!stops.some((stop) => stop.shipmentId === s.id && stop.type === 'DELIVERY'))
      return 'Des expéditions du chargement ne sont pas couvertes. Reconstruisez la tournée avant le départ.';
  return null;
}

export function buildDeliveryPlan(
  stops: DeliveryStopInput[],
  legs: DeliveryLeg[],
  options: DeliveryPlanOptions,
) {
  const expected = stops.length - 1 + (options.returnToStart ? 1 : 0);
  if (legs.length !== expected) throw new Error('Incomplete delivery legs');
  const hasUnlinked = stops.some((s) => !s.shipmentId);
  const onboard = new Set<string>();
  let clock: number | null = Number.isFinite(instant(options.startAt))
    ? instant(options.startAt)
    : null;
  let waiting = 0,
    service = 0,
    idle = 0,
    late = 0;
  let drivingLiters: number | null = 0;
  const measuredLegs: (DeliveryLeg & {
    fromSequence: number;
    toSequence: number;
    empty: boolean | null;
    liters: number | null;
  })[] = [];
  const recordLeg = (leg: DeliveryLeg, from: number, to: number) => {
    const empty = hasUnlinked ? null : onboard.size === 0;
    const consumption =
      empty === null
        ? undefined
        : empty
          ? options.emptyLitersPer100Km
          : options.loadedLitersPer100Km;
    const liters =
      leg.distanceKm === 0
        ? 0
        : leg.distanceKm != null && consumption != null
          ? (leg.distanceKm * consumption) / 100
          : null;
    drivingLiters = liters == null || drivingLiters == null ? null : drivingLiters + liters;
    measuredLegs.push({
      ...leg,
      fromSequence: from,
      toSequence: to,
      empty,
      liters: liters == null ? null : round(liters),
    });
    clock = clock != null && leg.durationMin != null ? clock + leg.durationMin * 60000 : null;
  };
  const schedule = stops.map((stop, i) => {
    if (i) recordLeg(legs[i - 1], i, i + 1);
    const arrivalAt = clock == null ? null : new Date(clock).toISOString();
    const early = instant(stop.plannedArrivalEarly),
      latest = instant(stop.plannedArrivalLate);
    const waitMin =
      clock != null && Number.isFinite(early) ? Math.max(0, (early - clock) / 60000) : null;
    if (clock != null) clock += (waitMin ?? 0) * 60000;
    const lateMin =
      clock != null && Number.isFinite(latest) ? Math.max(0, (clock - latest) / 60000) : null;
    const serviceMin = stop.serviceMinutes ?? options.serviceMinutes ?? 0;
    waiting += waitMin ?? 0;
    service += serviceMin;
    idle += stop.idleMinutes ?? 0;
    late += lateMin ?? 0;
    if (clock != null) {
      clock += serviceMin * 60000;
      const earliestDeparture = instant(stop.plannedDepartureAt);
      if (Number.isFinite(earliestDeparture) && earliestDeparture > clock) {
        waiting += (earliestDeparture - clock) / 60000;
        clock = earliestDeparture;
      }
    }
    if (stop.shipmentId) {
      if (stop.type === 'PICKUP') onboard.add(stop.shipmentId);
      else onboard.delete(stop.shipmentId);
    }
    return {
      sequence: i + 1,
      arrivalAt,
      departureAt: clock == null ? null : new Date(clock).toISOString(),
      waitMin: waitMin == null ? null : round(waitMin),
      lateMin: lateMin == null ? null : round(lateMin),
      serviceMin,
      idleMin: stop.idleMinutes ?? 0,
    };
  });
  if (options.returnToStart) recordLeg(legs[legs.length - 1], stops.length, 1);
  const sum = (field: 'distanceKm' | 'durationMin') =>
    legs.some((l) => l[field] == null) ? null : round(legs.reduce((n, l) => n + l[field]!, 0));
  const idleLiters =
    idle === 0
      ? 0
      : options.idleLitersPerHour == null
        ? null
        : (idle / 60) * options.idleLitersPerHour;
  const liters = drivingLiters == null || idleLiters == null ? null : drivingLiters + idleLiters;
  const warnings: string[] = [];
  if (legs.some((l) => l.source === 'HAVERSINE'))
    warnings.push(
      'Distance à vol d’oiseau : ce n’est pas un trajet routier; carburant sous-estimé possible.',
    );
  if (legs.some((l) => l.source === 'UNKNOWN'))
    warnings.push('Coordonnées ou trajets manquants : aucun total complet ne peut être garanti.');
  if (options.startAt == null)
    warnings.push('Renseignez le début au premier arrêt pour calculer les heures d’arrivée.');
  if (legs.some((l) => l.durationMin == null))
    warnings.push('Temps de conduite indisponible : les heures en aval restent inconnues.');
  if (hasUnlinked)
    warnings.push(
      'Des arrêts ne sont pas reliés aux expéditions : charge et carburant non déterminés.',
    );
  if (liters == null)
    warnings.push(
      'Complétez les consommations chargé/à vide et le ralenti pour estimer le carburant.',
    );
  if (late > 0)
    warnings.push('Certaines fenêtres de livraison sont dépassées dans cette prévision.');
  return {
    version: 1 as const,
    options: { ...options },
    stops: stops.map((s) => ({ ...s })),
    legs: measuredLegs,
    schedule,
    totals: {
      distanceKm: sum('distanceKm'),
      drivingMinutes: sum('durationMin'),
      serviceMinutes: service,
      waitingMinutes: clock == null ? null : round(waiting),
      idleMinutes: idle,
      lateMinutes: round(late),
      finishAt: clock == null ? null : new Date(clock).toISOString(),
      drivingLiters: drivingLiters == null ? null : round(drivingLiters),
      idleLiters: idleLiters == null ? null : round(idleLiters),
      liters: liters == null ? null : round(liters),
      fuelCost:
        liters == null || options.pricePerLiter == null || !options.currency
          ? null
          : round(liters * options.pricePerLiter),
      currency: options.currency ?? null,
    },
    warnings,
  };
}
export type DeliveryPlan = ReturnType<typeof buildDeliveryPlan> & {
  fuelSource?: import('./fuel-profile').DeliveryFuelSource;
};

/** Bounded local search, first pickup fixed. No claim of a global/truck-safe optimum.
 * Uses directed road metrics; never worsens late minutes, then minimizes distance.
 */
export function suggestDeliveryOrder(
  stops: DeliveryStopInput[],
  matrix: DeliveryMatrix,
  options: DeliveryPlanOptions,
): number[] {
  const original = stops.map((_, i) => i);
  if (stops.length > 50 || deliveryOrderError(stops)) return original;
  const score = (order: number[]) => {
    const reordered = order.map((i, sequence) => ({ ...stops[i], sequence: sequence + 1 }));
    if (deliveryOrderError(reordered)) return null;
    const pairs = order.slice(1).map((n, i) => [order[i], n]);
    if (options.returnToStart) pairs.push([order[order.length - 1], order[0]]);
    const legs = pairs.map(([a, b]) => ({
      distanceKm: matrix.distancesKm[a]?.[b] ?? null,
      durationMin: matrix.durationsMin[a]?.[b] ?? null,
      source: 'OSRM' as const,
    }));
    if (legs.some((l) => l.distanceKm == null || l.durationMin == null)) return null;
    const plan = buildDeliveryPlan(reordered, legs, options);
    return [plan.totals.lateMinutes, plan.totals.distanceKm!] as const;
  };
  let best = original,
    bestScore = score(best);
  if (!bestScore) return original;
  // Relocate one stop at a time, preserving every pickup/delivery pair.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let from = 1; from < stops.length; from++)
      for (let to = 1; to < stops.length; to++) {
        if (from === to) continue;
        const candidate = [...best];
        const [moved] = candidate.splice(from, 1);
        candidate.splice(to, 0, moved);
        const value = score(candidate);
        if (
          value &&
          (value[0] < bestScore[0] || (value[0] === bestScore[0] && value[1] < bestScore[1] - 0.01))
        ) {
          best = candidate;
          bestScore = value;
          changed = true;
        }
      }
    if (!changed) break;
  }
  return best;
}
