// Shared shapes for the customer-portal web UI. Mirrors the payloads returned
// by both the token-authenticated (`/public/portal/:token/*`) and
// session-authenticated (`/portal/*`) routes — same fields either way.

export interface PortalView {
  shipper: string;
  customer: string;
  branding: { logoUrl?: string; accentColor?: string };
  locations: { code: string; name: string; city: string }[];
  orders: {
    id: string;
    orderNumber: string;
    customerReference: string | null;
    status: string;
    requestedPickupEarly: string | null;
    requestedPickupLate: string | null;
    requestedDeliveryEarly: string | null;
    requestedDeliveryLate: string | null;
    originLocation: { city: string; state: string | null };
    destinationLocation: { city: string; state: string | null };
    shipments: {
      id: string;
      shipmentNumber: string;
      status: string;
      actualDeliveryAt: string | null;
      trackingUrl: string | null;
    }[];
  }[];
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
  invoiceNumber: string;
  status: string;
  currency: string;
  totalAmount: number;
  sentAt: string | null;
  paidAt: string | null;
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
