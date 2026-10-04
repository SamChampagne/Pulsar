import { createHmac } from 'node:crypto';

export type DriverReferenceKind = 'shipment' | 'stop' | 'package' | 'document';

/** Token-scoped opaque reference. It is not an independent capability or an internal ID. */
export function driverReference(token: string, kind: DriverReferenceKind, id: string): string {
  return createHmac('sha256', token)
    .update(JSON.stringify(['pulsar-driver-reference-v1', kind, id]))
    .digest('base64url');
}
