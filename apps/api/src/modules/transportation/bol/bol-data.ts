/**
 * Pure data-builder for a Bill of Lading.
 * No Prisma imports — takes a plain structural load graph so it stays testable.
 */

export interface BolLine {
  shipmentNumber: string;
  orderNumber: string;
  customerReference: string | null;
  weightKg: number | null;
  palletCount: number | null;
}

export interface BolParty {
  name: string;
  address: string;
  city: string;
}

export interface BolData {
  bolNumber: string;
  generatedAt: Date;
  carrier: { name: string; scac: string | null } | null;
  driverName: string | null;
  equipment: { vehicle: string | null; trailer: string | null };
  shipper: BolParty | null;
  consignee: BolParty | null;
  lines: BolLine[];
  totals: { weightKg: number; units: number };
  notes: string | null;
  conditions: string;
}

const CONDITIONS =
  'Received in apparent good order and condition except as noted.';

// ---------------------------------------------------------------------------
// Minimal structural input types — intentionally decoupled from Prisma
// ---------------------------------------------------------------------------

interface LocationLike {
  name: string;
  addressLine1: string;
  city: string;
}

interface StopLike {
  sequence: number;
  type: string; // 'PICKUP' | 'DELIVERY' | …
  location: LocationLike;
}

interface TransportOrderLike {
  orderNumber: string;
  customerReference: string | null;
}

interface ShipmentLike {
  shipmentNumber: string;
  weightKg: number | null;
  palletCount: number | null;
  originLocation: LocationLike | null;
  destinationLocation: LocationLike | null;
  transportOrder: TransportOrderLike | null;
}

interface LoadInput {
  carrier: { name: string; scac: string | null } | null;
  driver: { firstName: string; lastName: string } | null;
  vehicle: { unitNumber: string } | null;
  trailer: { unitNumber: string } | null;
  notes: string | null;
  route: { stops: StopLike[] } | null;
  shipments: ShipmentLike[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function toParty(loc: LocationLike): BolParty {
  return { name: loc.name, address: loc.addressLine1, city: loc.city };
}

export function buildBolData(load: LoadInput, bolNumber: string): BolData {
  const stops = load.route?.stops ?? [];

  // Shipper = first PICKUP stop; fallback = first shipment's originLocation
  const firstPickup = stops
    .filter((s) => s.type === 'PICKUP')
    .sort((a, b) => a.sequence - b.sequence)[0];

  const lastDelivery = stops
    .filter((s) => s.type === 'DELIVERY')
    .sort((a, b) => b.sequence - a.sequence)[0];

  const firstShipment = load.shipments[0] ?? null;

  const shipper: BolParty | null =
    firstPickup
      ? toParty(firstPickup.location)
      : firstShipment?.originLocation
        ? toParty(firstShipment.originLocation)
        : null;

  const consignee: BolParty | null =
    lastDelivery
      ? toParty(lastDelivery.location)
      : firstShipment?.destinationLocation
        ? toParty(firstShipment.destinationLocation)
        : null;

  const lines: BolLine[] = load.shipments.map((s) => ({
    shipmentNumber: s.shipmentNumber,
    orderNumber: s.transportOrder?.orderNumber ?? '',
    customerReference: s.transportOrder?.customerReference ?? null,
    weightKg: s.weightKg,
    palletCount: s.palletCount,
  }));

  const totals = load.shipments.reduce(
    (acc, s) => ({
      weightKg: acc.weightKg + (s.weightKg ?? 0),
      units: acc.units + (s.palletCount ?? 0),
    }),
    { weightKg: 0, units: 0 },
  );

  return {
    bolNumber,
    generatedAt: new Date(),
    carrier: load.carrier ?? null,
    driverName:
      load.driver
        ? `${load.driver.firstName} ${load.driver.lastName}`
        : null,
    equipment: {
      vehicle: load.vehicle?.unitNumber ?? null,
      trailer: load.trailer?.unitNumber ?? null,
    },
    shipper,
    consignee,
    lines,
    totals,
    notes: load.notes ?? null,
    conditions: CONDITIONS,
  };
}
