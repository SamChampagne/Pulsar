import { CURRENCIES } from '../reference/currencies';
import type { DeliveryPlanOptions } from './delivery-plan';

/** Declared operational parameters, never tariff rules, purchase records or telemetry. */
export interface DeliveryFuelProfile {
  loadedLitersPer100Km: number;
  emptyLitersPer100Km: number;
  idleLitersPerHour: number;
  tankCapacityLitres: number;
  reserveLitres: number;
}
export interface DeliveryFuelPrice {
  effectiveOn: string;
  pricePerLitre: string;
  currency: string;
  reference: string;
}
export interface DeliveryFuelActual {
  distanceKm: string;
  consumedLitres: string;
  costAmount: string | null;
  currency: string | null;
  measuredAt: string;
  note: string;
}
export interface DeliveryFuelSourceInput {
  vehicleId: string;
  profileRevision: number;
  priceRevision: number;
  currency: string;
  asOf: string;
}
export interface DeliveryFuelSource extends DeliveryFuelSourceInput {
  version: 1;
  profileId: string;
  priceId: string;
  profile: DeliveryFuelProfile;
  price: DeliveryFuelPrice;
}
export type DeliveryFuelApplied = {
  options: Pick<
    DeliveryPlanOptions,
    | 'loadedLitersPer100Km'
    | 'emptyLitersPer100Km'
    | 'idleLitersPerHour'
    | 'pricePerLiter'
    | 'currency'
  >;
  fuelSource: DeliveryFuelSourceInput;
};
export interface DeliveryFuelRevision<T> {
  id: string;
  revision: number;
  createdAt: string;
  snapshot: T;
}
export interface DeliveryFuelBaseline {
  routeId: string;
  routeUpdatedAt: string;
  deliveryPlan: unknown;
}
export interface DeliveryFuelActualSnapshot extends DeliveryFuelActual {
  baseline: DeliveryFuelBaseline;
}

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Objet carburant requis.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw Error('Champ carburant inconnu.');
  return value;
}
function number(value: unknown, label: string, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6
  )
    throw Error(`${label} : nombre de ${min} à ${max}, trois décimales maximum.`);
  return value;
}
function text(value: unknown, label: string, min: number, max: number) {
  if (
    typeof value !== 'string' ||
    value.trim().length < min ||
    value.trim().length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
    throw Error(`${label} : ${min} à ${max} caractères requis.`);
  return value.trim();
}
export function deliveryFuelDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error('Date civile valide AAAA-MM-JJ requise.');
  return value;
}
function currency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCIES.some((entry) => entry.code === value))
    throw Error('Devise du catalogue requise; aucune conversion implicite.');
  return value;
}
function decimal(
  value: unknown,
  label: string,
  precision: number,
  max: number,
  positive = false,
): string {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^\\d{1,9}(\\.\\d{1,${precision}})?$`).test(value) ||
    Number(value) > max ||
    (positive && Number(value) <= 0)
  )
    throw Error(
      `${label} : décimal ${positive ? 'positif' : 'non négatif'} jusqu’à ${max}, ${precision} décimales maximum.`,
    );
  return value
    .replace(/^0+(?=\d)/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}
export function validateDeliveryFuelProfile(input: unknown): DeliveryFuelProfile {
  const v = object(input, [
    'loadedLitersPer100Km',
    'emptyLitersPer100Km',
    'idleLitersPerHour',
    'tankCapacityLitres',
    'reserveLitres',
  ]);
  const result = {
    loadedLitersPer100Km: number(v.loadedLitersPer100Km, 'Consommation chargé', 0.001, 200),
    emptyLitersPer100Km: number(v.emptyLitersPer100Km, 'Consommation à vide', 0.001, 200),
    idleLitersPerHour: number(v.idleLitersPerHour, 'Consommation au ralenti', 0, 100),
    tankCapacityLitres: number(v.tankCapacityLitres, 'Capacité du réservoir', 0.001, 10000),
    reserveLitres: number(v.reserveLitres, 'Réserve', 0, 10000),
  };
  if (result.reserveLitres >= result.tankCapacityLitres)
    throw Error('La réserve doit être inférieure à la capacité du réservoir.');
  return result;
}
export function validateDeliveryFuelPrice(input: unknown): DeliveryFuelPrice {
  const v = object(input, ['effectiveOn', 'pricePerLitre', 'currency', 'reference']);
  return {
    effectiveOn: deliveryFuelDate(v.effectiveOn),
    pricePerLitre: decimal(v.pricePerLitre, 'Prix par litre', 4, 100, true),
    currency: currency(v.currency),
    reference: text(v.reference, 'Source du prix déclaré', 3, 200),
  };
}
export function validateDeliveryFuelActual(input: unknown): DeliveryFuelActual {
  const v = object(input, [
    'distanceKm',
    'consumedLitres',
    'costAmount',
    'currency',
    'measuredAt',
    'note',
  ]);
  if (
    typeof v.measuredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      v.measuredAt,
    ) ||
    !Number.isFinite(Date.parse(v.measuredAt))
  )
    throw Error('Instant de relevé ISO avec fuseau requis.');
  deliveryFuelDate(v.measuredAt.slice(0, 10));
  const costAmount =
    v.costAmount === null ? null : decimal(v.costAmount, 'Coût déclaré', 2, 999999999.99);
  if (costAmount === null && v.currency !== null)
    throw Error('Ne fournissez une devise qu’avec un coût déclaré.');
  return {
    distanceKm: decimal(v.distanceKm, 'Distance déclarée', 3, 1000000),
    consumedLitres: decimal(v.consumedLitres, 'Litres consommés', 3, 1000000),
    costAmount,
    currency: costAmount === null ? null : currency(v.currency),
    measuredAt: new Date(v.measuredAt).toISOString(),
    note: text(v.note, 'Méthode et portée du relevé', 3, 1000),
  };
}
export function validateDeliveryFuelSource(input: unknown): DeliveryFuelSourceInput {
  const v = object(input, ['vehicleId', 'profileRevision', 'priceRevision', 'currency', 'asOf']);
  for (const key of ['profileRevision', 'priceRevision'])
    if (!Number.isSafeInteger(v[key]) || (v[key] as number) < 1)
      throw Error('Révision carburant positive requise.');
  return {
    vehicleId: text(v.vehicleId, 'Véhicule', 1, 100),
    profileRevision: v.profileRevision as number,
    priceRevision: v.priceRevision as number,
    currency: currency(v.currency),
    asOf: deliveryFuelDate(v.asOf),
  };
}
export function applyDeliveryFuelParameters(
  profile: DeliveryFuelProfile,
  price: DeliveryFuelPrice,
): DeliveryFuelApplied['options'] {
  return {
    loadedLitersPer100Km: profile.loadedLitersPer100Km,
    emptyLitersPer100Km: profile.emptyLitersPer100Km,
    idleLitersPerHour: profile.idleLitersPerHour,
    pricePerLiter: Number(price.pricePerLitre),
    currency: price.currency,
  };
}

/** Tank-full theoretical range only: neither departure fuel nor refuelling is known. */
export function deliveryFuelRange(profile: DeliveryFuelProfile, plannedLitres: number | null) {
  const usableLitres = profile.tankCapacityLitres - profile.reserveLitres;
  return {
    usableLitres,
    loadedRangeKm: Math.round(((usableLitres * 100) / profile.loadedLitersPer100Km) * 100) / 100,
    emptyRangeKm: Math.round(((usableLitres * 100) / profile.emptyLitersPer100Km) * 100) / 100,
    exceedsUsableTank: plannedLitres === null ? null : plannedLitres > usableLitres,
  };
}

/** Compare only the baseline captured with the first actual report, never today's profile/price. */
export function compareDeliveryFuel(actual: DeliveryFuelActual, baselinePlan: unknown) {
  const plan =
    baselinePlan && typeof baselinePlan === 'object'
      ? (baselinePlan as Record<string, unknown>)
      : {};
  const totals =
    plan.totals && typeof plan.totals === 'object' ? (plan.totals as Record<string, unknown>) : {};
  const known = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const distanceKm = known(totals.distanceKm),
    litres = known(totals.liters),
    costAmount = known(totals.fuelCost);
  const plannedCurrency = typeof totals.currency === 'string' ? totals.currency : null;
  const delta = (a: number, p: number | null) =>
    p === null ? null : Math.round((a - p) * 1000) / 1000;
  const sameCurrency =
    actual.costAmount !== null && actual.currency !== null && actual.currency === plannedCurrency;
  return {
    planned: { distanceKm, litres, costAmount, currency: plannedCurrency },
    deltaDistanceKm: delta(Number(actual.distanceKm), distanceKm),
    deltaLitres: delta(Number(actual.consumedLitres), litres),
    deltaCostAmount: sameCurrency ? delta(Number(actual.costAmount), costAmount) : null,
    costComparable: sameCurrency && costAmount !== null,
  };
}
