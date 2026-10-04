import type { DeliveryPackageContent, DeliveryPackageStatus } from './packages';

/** Hard server-side limits: no silent truncation when capturing a manifest. */
export const DELIVERY_MANIFEST_LIMITS = Object.freeze({
  shipments: 200,
  packages: 2000,
  contentLines: 5000,
});

/** Operational address captured at issue time, not the private party-directory record. */
export interface DeliveryManifestAddress {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string | null;
}

/** Immutable authenticated snapshot. This is not a public tracking projection or proof of loading. */
export interface DeliveryManifestSnapshot {
  schemaVersion: 1;
  load: {
    id: string;
    loadNumber: string;
    status: string;
    updatedAt: string;
    carrierName: string | null;
    driverName: string | null;
    vehicleNumber: string | null;
    trailerNumber: string | null;
  };
  stops: {
    sequence: number;
    type: string;
    location: DeliveryManifestAddress;
  }[];
  shipments: {
    id: string;
    shipmentNumber: string;
    status: string;
    trackingEnabled: boolean;
    origin: DeliveryManifestAddress;
    destination: DeliveryManifestAddress;
    /** Cancelled units remain visible in the manifest history, but never produce labels. */
    packages: {
      id: string;
      code: string;
      label: string;
      status: DeliveryPackageStatus;
      version: number;
      contents: DeliveryPackageContent[];
      loadedAt: string | null;
      deliveredAt: string | null;
    }[];
  }[];
}

export interface DeliveryManifestRecord {
  id: string;
  number: string;
  revision: number;
  issuedAt: string;
  reason: string;
  snapshotHash: string;
  sourceHash: string;
  snapshot: DeliveryManifestSnapshot;
}

export type DeliveryManifestSummary = Omit<DeliveryManifestRecord, 'snapshot'>;

export interface DeliveryManifestPreview {
  sourceHash: string;
  snapshot: DeliveryManifestSnapshot;
  canIssue: boolean;
  blockers: string[];
}

export type DeliveryManifestFileKind = 'manifest' | 'labels';
