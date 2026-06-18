// Shared helpers for procurement pages (RFP detail, routing guide).

export type EndpointType = 'LOCATION' | 'CITY' | 'STATE' | 'COUNTRY';

export interface LaneEndpoint {
  id: string;
  name: string;
  city: string;
}

export interface LaneLike {
  originType: EndpointType;
  originCity: string | null;
  originState: string | null;
  originCountry: string | null;
  originLocation: LaneEndpoint | null;
  destinationType: EndpointType;
  destinationCity: string | null;
  destinationState: string | null;
  destinationCountry: string | null;
  destinationLocation: LaneEndpoint | null;
}

export function endpointLabel(
  type: EndpointType,
  loc: LaneEndpoint | null,
  city: string | null,
  state: string | null,
  country: string | null,
): string {
  switch (type) {
    case 'LOCATION':
      return loc ? `${loc.name} (${loc.city})` : '—';
    case 'CITY':
      return `${city ?? ''}, ${state ?? ''} (${country ?? ''})`;
    case 'STATE':
      return `${state ?? ''} (${country ?? ''})`;
    case 'COUNTRY':
      return country ?? '—';
  }
}

export function laneLabel(lane: LaneLike): string {
  const orig = endpointLabel(
    lane.originType,
    lane.originLocation,
    lane.originCity,
    lane.originState,
    lane.originCountry,
  );
  const dest = endpointLabel(
    lane.destinationType,
    lane.destinationLocation,
    lane.destinationCity,
    lane.destinationState,
    lane.destinationCountry,
  );
  return `${orig} → ${dest}`;
}

export function formatDate(val: string | null | undefined): string {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('fr-CA');
}
