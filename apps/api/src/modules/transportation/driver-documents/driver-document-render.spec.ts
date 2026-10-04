import { renderDriverDocument, validateDriverDocumentPrintable } from './driver-document-render';
import type { DriverDocumentRecord } from '@pulsar/shared';
import { inflateSync } from 'node:zlib';

export function driverDocumentFixture(): DriverDocumentRecord {
  const address = {
    name: 'Atelier Québec',
    addressLine1: '120 rue de la Fabrique',
    addressLine2: null,
    city: 'Québec',
    province: 'QC',
    postalCode: 'G1A 1A1',
    country: 'CA',
  };
  return {
    id: 'internal-document-id',
    number: 'DL-00042',
    revision: 2,
    issuedAt: '2026-10-03T12:00:00.000Z',
    reason: 'PRIVATE_REASON_987',
    sourceHash: 'a'.repeat(64),
    snapshotHash: 'b'.repeat(64),
    ready: true,
    snapshot: {
      schemaVersion: 1,
      load: {
        loadNumber: 'LD-00037',
        updatedAt: '2026-10-03T11:00:00.000Z',
        driverName: 'Renée Roy',
        carrierName: 'Transport du Fleuve',
        vehicleNumber: 'V-201',
        trailerNumber: 'R-42',
      },
      stops: [
        { sequence: 1, type: 'PICKUP', location: address },
        {
          sequence: 2,
          type: 'DELIVERY',
          location: {
            ...address,
            name: 'Dépôt de Lévis',
            addressLine1: '49 route des Ateliers',
            city: 'Lévis',
          },
        },
      ],
      shipments: [
        {
          shipmentNumber: 'SH-00581',
          trackingEnabled: true,
          origin: address,
          destination: { ...address, name: 'Dépôt de Lévis', city: 'Lévis' },
          packageCodes: ['PKG-000021', 'PKG-000022'],
        },
      ],
    },
  };
}
function decompressedPdf(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((m) => {
      try {
        return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
      } catch {
        return m[1];
      }
    })
    .join('\n');
}
describe('Safe driver PDF', () => {
  it('renders only the snapshot, never private issuance reason, hashes or internal identity', async () => {
    const record = driverDocumentFixture(),
      bytes = await renderDriverDocument(record),
      decoded = decompressedPdf(bytes);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    for (const forbidden of [record.reason, record.id, record.snapshotHash, record.sourceHash]) {
      expect(decoded).not.toContain(forbidden);
      expect(decoded.toLowerCase()).not.toContain(Buffer.from(forbidden).toString('hex'));
    }
    expect(decoded.toLowerCase()).toContain(Buffer.from(record.number).toString('hex'));
  });
  it('preserves Unicode French but rejects unsupported scripts or controls explicitly', () => {
    const record = driverDocumentFixture();
    expect(() => validateDriverDocumentPrintable(record.snapshot)).not.toThrow();
    record.snapshot.shipments[0].destination.name = '配送';
    expect(() => validateDriverDocumentPrintable(record.snapshot)).toThrow('Windows-1252');
    record.snapshot.shipments[0].destination.name = 'site\u0000';
    expect(() => validateDriverDocumentPrintable(record.snapshot)).toThrow('Windows-1252');
  });
  it('paginates long safe snapshots without losing the last package code', async () => {
    const record = driverDocumentFixture();
    record.snapshot.shipments[0].packageCodes = Array.from(
      { length: 120 },
      (_, i) => `PKG-${String(i + 1).padStart(6, '0')}`,
    );
    const bytes = await renderDriverDocument(record),
      raw = bytes.toString('latin1');
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(2);
    expect(decompressedPdf(bytes).toLowerCase()).toContain(
      Buffer.from('PKG-000120').toString('hex'),
    );
  });
});
