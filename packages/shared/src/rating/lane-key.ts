import { LaneEndpointType } from '../enums/transportation';

export interface LaneEndpointInput {
  locationId?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

/** Trim, lowercase, strip diacritics (NFD) — « Montréal », "MONTREAL " share one key. */
export function normalizeGeo(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Literal union ('LOCATION' | 'CITY' | …) so both the shared enum and the Prisma enum
 * ($Enums.LaneEndpointType) are accepted without casts.
 */
export type LaneEndpointTypeLike = `${LaneEndpointType}`;

export const ENDPOINT_SPECIFICITY: Record<LaneEndpointTypeLike, number> = {
  [LaneEndpointType.LOCATION]: 3,
  [LaneEndpointType.CITY]: 2,
  [LaneEndpointType.STATE]: 1,
  [LaneEndpointType.COUNTRY]: 0,
};

export function buildEndpointKey(type: LaneEndpointType, input: LaneEndpointInput): string {
  switch (type) {
    case LaneEndpointType.LOCATION:
      if (!input.locationId) throw new Error('A LOCATION endpoint requires locationId');
      return `LOCATION:${input.locationId}`;
    case LaneEndpointType.CITY:
      if (!input.city?.trim() || !input.state?.trim() || !input.country?.trim())
        throw new Error('A CITY endpoint requires non-blank city, state and country');
      return `CITY:${normalizeGeo(input.country!)}|${normalizeGeo(input.state!)}|${normalizeGeo(input.city!)}`;
    case LaneEndpointType.STATE:
      if (!input.state?.trim() || !input.country?.trim())
        throw new Error('A STATE endpoint requires non-blank state and country');
      return `STATE:${normalizeGeo(input.country!)}|${normalizeGeo(input.state!)}`;
    case LaneEndpointType.COUNTRY:
      if (!input.country?.trim()) throw new Error('A COUNTRY endpoint requires non-blank country');
      return `COUNTRY:${normalizeGeo(input.country!)}`;
  }
}

export interface PhysicalLocation {
  id: string;
  city: string;
  state?: string | null;
  country: string;
}

/** Every key a physical location can match, most specific first. Levels missing data are skipped. */
export function candidateEndpointKeys(location: PhysicalLocation): string[] {
  const keys = [buildEndpointKey(LaneEndpointType.LOCATION, { locationId: location.id })];
  if (location.state) {
    keys.push(
      buildEndpointKey(LaneEndpointType.CITY, location),
      buildEndpointKey(LaneEndpointType.STATE, location),
    );
  }
  keys.push(buildEndpointKey(LaneEndpointType.COUNTRY, location));
  return keys;
}

export interface LaneForOrdering {
  originType: LaneEndpointTypeLike;
  destinationType: LaneEndpointTypeLike;
  createdAt: Date;
}

/**
 * Deterministic lane ordering, most preferred first:
 * total specificity desc → destination desc → origin desc → newest first.
 * The rating engine AND auto-tendering both use this — never reimplement it.
 */
export function compareLanes(a: LaneForOrdering, b: LaneForOrdering): number {
  const spec = (l: LaneForOrdering) =>
    ENDPOINT_SPECIFICITY[l.originType] + ENDPOINT_SPECIFICITY[l.destinationType];
  if (spec(a) !== spec(b)) return spec(b) - spec(a);
  const destDiff = ENDPOINT_SPECIFICITY[b.destinationType] - ENDPOINT_SPECIFICITY[a.destinationType];
  if (destDiff !== 0) return destDiff;
  const originDiff = ENDPOINT_SPECIFICITY[b.originType] - ENDPOINT_SPECIFICITY[a.originType];
  if (originDiff !== 0) return originDiff;
  return b.createdAt.getTime() - a.createdAt.getTime();
}
