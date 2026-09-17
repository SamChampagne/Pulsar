// Shared shapes for the customer-portal web UI. Mirrors the payloads returned
// by both the token-authenticated (`/public/portal/:token/*`) and
// session-authenticated (`/portal/*`) routes — same fields either way.

/** The single live position the API exposes for a moving shipment (rule 20). */
export interface PortalPosition {
  latitude: number;
  longitude: number;
  // `GET /portal/view` names it `recordedAt`; the tracking detail
  // (`GET /portal/shipments/:id`) names it `occurredAt`. Accept both so one
  // shape serves the dashboard and the tracking panel.
  recordedAt?: string | null;
  occurredAt?: string | null;
}

export interface PortalShipment {
  id: string;
  shipmentNumber: string;
  status: string;
  plannedPickupEarly: string | null;
  plannedPickupLate: string | null;
  plannedDeliveryEarly: string | null;
  plannedDeliveryLate: string | null;
  actualPickupAt: string | null;
  actualDeliveryAt: string | null;
  weightKg: number | null;
  palletCount: number | null;
  documentCount: number;
  hasPod: boolean;
  lastPosition: PortalPosition | null;
  trackingUrl: string | null;
}

export interface PortalOrder {
  id: string;
  orderNumber: string;
  customerReference: string | null;
  status: string;
  mode: string | null;
  totalWeightKg: number | null;
  totalVolumeM3: number | null;
  palletCount: number | null;
  notes: string | null;
  requestedPickupEarly: string | null;
  requestedPickupLate: string | null;
  requestedDeliveryEarly: string | null;
  requestedDeliveryLate: string | null;
  createdAt: string;
  updatedAt: string;
  originLocation: { city: string; state: string | null };
  destinationLocation: { city: string; state: string | null };
  shipments: PortalShipment[];
}

export interface PortalView {
  shipper: string;
  customer: string;
  branding: { logoUrl?: string; accentColor?: string };
  locations: { code: string; name: string; city: string }[];
  orders: PortalOrder[];
}

export interface Template {
  id: string;
  name: string;
  // Opaque location codes (the API never exposes location PKs) — the same
  // values the order form binds to.
  originCode: string | null;
  destinationCode: string | null;
  mode: string | null;
  totalWeightKg: number | null;
  totalVolumeM3: number | null;
  palletCount: number | null;
  notes: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  // Numbers, never serialized Decimal strings (spec B2.2).
  totalAmount: number;
  amountPaid: number;
  taxAmount: number;
  netAmount: number;
  approvedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
}

/** `GET /portal/change-requests` — the customer-facing projection. */
export interface PortalChangeRequest {
  id: string;
  kind: string;
  note: string;
  status: string;
  staffResponse: string | null;
  orderNumber: string | null;
  shipmentNumber: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PortalDocument {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
}

export interface ShipmentComment {
  id: string;
  authorType: 'CUSTOMER' | 'STAFF';
  authorName: string;
  body: string;
  createdAt: string;
}

/** Reads whichever timestamp the payload carried for a position. */
export function positionAt(position: PortalPosition | null | undefined): string | null {
  return position?.recordedAt ?? position?.occurredAt ?? null;
}

/** One point of the tracking projection (`GET /portal/shipments/:id`). */
export interface PortalTrackingPoint {
  city: string;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** One entry of the tracking timeline. */
export interface PortalTrackingEvent {
  id: string;
  type: string;
  message: string | null;
  occurredAt: string;
}

/**
 * `GET /portal/shipments/:id` — the same projection the public tracking page
 * gets (rule 20: one position, never a history, never the other stops).
 * `proofOfDelivery.notes` is optional: today's projection carries the signer
 * and the signature date only.
 */
export interface PortalShipmentTracking {
  shipper: string;
  shipmentNumber: string;
  status: string;
  origin: PortalTrackingPoint | null;
  destination: PortalTrackingPoint | null;
  plannedPickupEarly: string | null;
  plannedPickupLate: string | null;
  plannedDeliveryEarly: string | null;
  plannedDeliveryLate: string | null;
  actualPickupAt: string | null;
  actualDeliveryAt: string | null;
  proofOfDelivery: {
    signedByName: string | null;
    signedAt: string | null;
    notes?: string | null;
  } | null;
  events: PortalTrackingEvent[];
  lastPosition: PortalPosition | null;
}
