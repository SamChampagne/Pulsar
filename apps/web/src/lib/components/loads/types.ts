// Shared types for load detail sub-panels

export interface ShipmentOnLoad {
  id: string;
  shipmentNumber: string;
  status: string;
  transportOrderId: string;
  originLocationId: string;
  destinationLocationId: string;
  proofOfDelivery: { id: string; signedByName: string | null; signedAt: string } | null;
}

export interface TenderRow {
  id: string;
  status: string;
  token: string;
  message: string | null;
  declineReason: string | null;
  sentAt: string;
  expiresAt: string;
  carrier: { id: string; name: string };
}

export interface AccessorialOnLoad {
  id: string;
  quantity: number | null;
  accessorial: { id: string; code: string; name: string; unit: string };
}

export interface CostLine {
  type: string;
  code?: string;
  label: string;
  amount: number;
}

export interface AppliedBreak {
  upToKg: number;
  amount: number;
  asIfApplied: boolean;
  asIfWeightKg?: number;
}

export interface CostDetail {
  version: number;
  computedAt: string;
  referenceDate: string;
  rate: {
    id: string;
    name: string;
    rateType: string;
    currency: string;
    baseAmount: number;
    minCharge: number | null;
    laneId: string | null;
    validFrom: string | null;
    validTo: string | null;
    validAtReference: boolean;
    breaks: unknown[];
    accessorialPrices: { code: string; amount: number }[];
    fuel: {
      pct: number;
      source: 'TABLE' | 'STATIC' | 'NONE';
      tableId?: string;
      effectiveFrom?: string;
    };
  };
  inputs: {
    distanceKm: number | null;
    weightKg: number | null;
    palletCount: number | null;
    accessorials: { code: string; unit: string; quantity: number }[];
  };
  result: {
    lines: CostLine[];
    base: number;
    fuelSurcharge: number;
    accessorialsTotal: number;
    total: number;
    appliedBreak: AppliedBreak | null;
    missingAccessorials: string[];
  };
}

export interface WindowWarning {
  shipmentNumber: string;
  field: 'pickup' | 'delivery';
  kind: 'BEFORE_EARLY' | 'AFTER_LATE';
  requested: string;
  planned: string;
}

export interface LoadDocument {
  id: string;
  fileName: string;
  createdAt: string;
}

export interface LoadDetail {
  updatedAt: string;
  id: string;
  loadNumber: string;
  status: string;
  mode: string | null;
  notes: string | null;
  estimatedCost: string | null;
  costCurrency: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  carrier: { id: string; name: string } | null;
  driver: { id: string; firstName: string; lastName: string } | null;
  vehicle: { id: string; unitNumber: string } | null;
  trailer: { id: string; unitNumber: string } | null;
  rate: { id: string; name: string } | null;
  shipments: ShipmentOnLoad[];
  route: { id: string } | null;
  accessorials: AccessorialOnLoad[];
  costDetail: CostDetail | null;
  windowWarnings?: WindowWarning[];
}

export interface RouteStop {
  id: string;
  sequence: number;
  type: string;
  status: string;
  locationId: string;
  shipmentId: string | null;
  plannedArrivalEarly: string | null;
  plannedArrivalLate: string | null;
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  location: { name: string; city: string };
}

export interface RouteDetail {
  id: string;
  totalDistanceKm: number | null;
  estimatedDurationMin: number | null;
  distanceSource: 'MANUAL' | 'OSRM' | 'HAVERSINE' | null;
  geometry: unknown;
  stops: RouteStop[];
}

export interface EditStop {
  type: string;
  locationId: string;
  shipmentId: string | null;
  plannedArrivalEarly: string;
  plannedArrivalLate: string;
  label: string;
}

export interface Option {
  id: string;
  name?: string;
  code?: string;
  unitNumber?: string;
  firstName?: string;
  lastName?: string;
}

export interface CatalogAccessorial {
  id: string;
  code: string;
  name: string;
  unit: string;
}

export interface RateOption {
  rateId: string;
  rateName: string;
  currency: string;
  carrier: { id: string; code: string; name: string } | null;
  laneSpecificity: { originType: string; destinationType: string; total: number } | null;
  breakdown: {
    lines: { type: string; code?: string; label: string; amount: number }[];
    total: number;
    appliedBreak: { upToKg: number; amount: number; asIfApplied: boolean } | null;
    missingAccessorials: string[];
  };
  missingAccessorials: string[];
}

export interface CapacityExcess {
  axis: string;
  capacity: number;
  requested: number;
  excess: number;
}
