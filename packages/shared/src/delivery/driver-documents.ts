import type { DeliveryManifestAddress } from './manifests';

/** Deliberately closed publication. No IDs, private contacts, contents, notes or prices. */
export interface DriverDocumentSnapshot {
  schemaVersion: 1;
  load: {
    loadNumber: string;
    updatedAt: string;
    carrierName: string | null;
    driverName: string | null;
    vehicleNumber: string | null;
    trailerNumber: string | null;
  };
  stops: { sequence: number; type: string; location: DeliveryManifestAddress }[];
  shipments: {
    shipmentNumber: string;
    trackingEnabled: boolean;
    origin: DeliveryManifestAddress;
    destination: DeliveryManifestAddress;
    packageCodes: string[];
  }[];
}

export interface DriverDocumentSummary {
  id: string;
  number: string;
  revision: number;
  issuedAt: string;
  reason: string;
  sourceHash: string;
  snapshotHash: string;
  ready: boolean;
}
export interface DriverDocumentRecord extends DriverDocumentSummary {
  snapshot: DriverDocumentSnapshot;
}
export interface DriverDocumentPreview {
  snapshot: DriverDocumentSnapshot;
  sourceHash: string;
  canIssue: boolean;
  blockers: string[];
}
/** Capability-bound latest publication only; no internal ID or issuance reason. */
export interface PublicDriverDocuments {
  documents: {
    ref: string;
    number: string;
    revision: number;
    issuedAt: string;
    ready: boolean;
  }[];
  message: string | null;
}
