import { inflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeliveryPackageStatus, type DeliveryManifestRecord } from '@pulsar/shared';
import {
  renderDeliveryManifest,
  validateDeliveryManifestPrintable,
  deliveryManifestValueLabel,
} from './manifest-render';

const address = {
  name: 'Atelier de Québec',
  addressLine1: '123, rue de l’Église',
  addressLine2: 'Quai 4',
  city: 'Québec',
  province: 'QC',
  postalCode: 'G1K 3X2',
  country: 'Canada',
};
export const deliveryManifestPdfFixture: DeliveryManifestRecord = {
  id: 'manifest-1',
  number: 'MF-000001',
  revision: 2,
  issuedAt: '2026-10-02T14:30:00.000Z',
  reason: 'Révision après remplacement de la remorque. PRIVATE_REASON',
  snapshotHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  snapshot: {
    schemaVersion: 1,
    load: {
      id: 'load-1',
      loadNumber: 'LD-000042',
      status: 'IN_TRANSIT',
      updatedAt: '2026-10-02T14:29:00.000Z',
      carrierName: 'Transport Démonstration',
      driverName: 'Émilie Côté',
      vehicleNumber: 'V-102',
      trailerNumber: 'R-204',
    },
    stops: [{ sequence: 1, type: 'DELIVERY', location: address }],
    shipments: [
      {
        id: 'shipment-1',
        shipmentNumber: 'SH-000001',
        status: 'IN_TRANSIT',
        trackingEnabled: true,
        origin: { ...address, name: 'Centre de distribution', city: 'Montréal' },
        destination: address,
        packages: [
          {
            id: 'package-1',
            code: 'PKG-000001',
            label: 'Ensemble mécanique PRIVATE_LABEL',
            status: DeliveryPackageStatus.LOADED,
            version: 3,
            contents: [
              {
                reference: 'COMP-001',
                description: 'Boulons en acier inoxydable PRIVATE_CONTENT',
                quantity: '0.125',
                unit: 'kg',
              },
              {
                reference: 'COMP-002',
                description: 'Supports de montage',
                quantity: '12',
                unit: 'pièce',
              },
            ],
            loadedAt: '2026-10-02T13:00:00.000Z',
            deliveredAt: null,
          },
          {
            id: 'package-2',
            code: 'PKG-000002',
            label: 'Panneau livré',
            status: DeliveryPackageStatus.DELIVERED,
            version: 4,
            contents: [
              {
                reference: 'COMP-003',
                description: 'Panneau complet',
                quantity: '1',
                unit: 'pièce',
              },
            ],
            loadedAt: '2026-10-02T13:00:00.000Z',
            deliveredAt: '2026-10-02T14:00:00.000Z',
          },
          {
            id: 'package-3',
            code: 'PKG-000003',
            label: 'Colis annulé',
            status: DeliveryPackageStatus.CANCELLED,
            version: 2,
            contents: [
              {
                reference: 'COMP-004',
                description: 'Ancienne allocation',
                quantity: '9',
                unit: 'pièce',
              },
            ],
            loadedAt: null,
            deliveredAt: null,
          },
        ],
      },
    ],
  },
};

function text(pdf: Buffer): string {
  const blocks: string[] = [];
  for (const match of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    blocks.push(
      [...content.matchAll(/<([0-9a-f]+)>/gi)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join(''),
    );
  }
  return blocks.join('\n');
}
const clone = () => structuredClone(deliveryManifestPdfFixture);
const count = (pdf: Buffer) => Number(pdf.toString('latin1').match(/\/Count (\d+)/)?.[1]);

describe('immutable delivery manifest PDFs', () => {
  it('renders full captured operations, exact quantities and historical disclaimers', async () => {
    const record = clone();
    const before = JSON.stringify(record);
    const pdf = await renderDeliveryManifest(record, 'manifest');
    const extracted = text(pdf);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString().trim()).toBe('%%EOF');
    for (const value of [
      'MF-000001',
      'LD-000042',
      'SH-000001',
      'PKG-000001',
      'PKG-000002',
      'PKG-000003',
      'COMP-001 | 0.125 kg',
      'COMP-002 | 12',
      'PRIVATE_REASON',
      'PRIVATE_CONTENT',
      'PRIVATE_LABEL',
      'Annulé',
      'Livré',
      'État capturé : En transit',
      'État capturé : Chargé',
      '1. Livraison',
      '(BOL)',
      '(POD)',
      record.snapshotHash,
      record.sourceHash,
      record.issuedAt,
      record.snapshot.load.updatedAt,
      'UTC',
      'Transport Démonstration',
      'V-102',
      'R-204',
    ]) {
      expect(extracted).toContain(value);
    }
    expect(JSON.stringify(record)).toBe(before);
  });

  it.each(['manifest', 'labels'] as const)(
    'is byte-deterministic for %s with no current clock',
    async (kind) => {
      const first = await renderDeliveryManifest(clone(), kind);
      const second = await renderDeliveryManifest(clone(), kind);
      expect(second.equals(first)).toBe(true);
    },
  );

  it('prints exactly one 4 x 6 label per non-cancelled package and no private contents', async () => {
    const pdf = await renderDeliveryManifest(clone(), 'labels');
    const extracted = text(pdf);
    expect(count(pdf)).toBe(2);
    expect(pdf.toString('latin1').match(/\/MediaBox \[0 0 288 432\]/g)).toHaveLength(2);
    for (const value of [
      'PKG-000001',
      'PKG-000002',
      'MF-000001',
      'SH-000001',
      'État capturé : Livré',
      'DESTINATION',
      'Code 128',
    ])
      expect(extracted).toContain(value);
    for (const value of [
      'PKG-000003',
      'PRIVATE_REASON',
      'PRIVATE_CONTENT',
      'PRIVATE_LABEL',
      'COMP-001',
      'Émilie',
    ])
      expect(extracted).not.toContain(value);
  });

  it('paginates long manifest content without dropping identifiers or the ending', async () => {
    const record = clone();
    record.snapshot.shipments[0].packages[0].contents = Array.from({ length: 50 }, (_, index) => ({
      reference: `REF-${String(index).padStart(3, '0')}`,
      description: `Contenu ${index} : ` + 'W'.repeat(190),
      quantity: '999999999999.999',
      unit: 'pièce',
    }));
    const pdf = await renderDeliveryManifest(record, 'manifest');
    expect(count(pdf)).toBeGreaterThan(5);
    const extracted = text(pdf);
    for (let index = 0; index < 50; index++)
      expect(extracted).toContain(`REF-${String(index).padStart(3, '0')}`);
    expect(extracted).toContain('999999999999.999');
    expect(extracted).toContain('PROVENANCE DE CETTE COPIE');
    expect(extracted).toContain(`${count(pdf)} / ${count(pdf)}`);
  });

  it.each(['漢字', '😀', 'e\u0301', 'a\tbc', 'a\u0000bc'])(
    'rejects unsupported characters before issuance (%j)',
    (value) => {
      const record = clone();
      record.snapshot.shipments[0].origin.name = value;
      expect(() => validateDeliveryManifestPrintable(record.snapshot)).toThrow(
        'Aucune substitution',
      );
    },
  );

  it('checks metadata as well as snapshot text', () => {
    const record = clone();
    record.reason = '😀';
    expect(() => validateDeliveryManifestPrintable(record)).toThrow('document.reason');
  });

  it.each([
    ['PREPARED', 'Préparé'],
    ['LOADED', 'Chargé'],
    ['DELIVERED', 'Livré'],
    ['RETURNED', 'Retourné'],
    ['IN_TRANSIT', 'En transit'],
    ['PICKUP', 'Ramassage'],
    ['DELIVERY', 'Livraison'],
    ['UNRECOGNIZED_STATE', 'UNRECOGNIZED_STATE'],
    ['constructor', 'constructor'],
  ])('labels captured %s without changing unknown values', (value, label) => {
    expect(deliveryManifestValueLabel(value)).toBe(label);
  });

  it('keeps unknown historical states visible without inventing a current state', async () => {
    const record = clone();
    record.snapshot.load.status = 'HISTORICAL_UNKNOWN';
    const before = JSON.stringify(record);
    expect(text(await renderDeliveryManifest(record, 'manifest'))).toContain(
      'État capturé : HISTORICAL_UNKNOWN',
    );
    expect(JSON.stringify(record)).toBe(before);
  });

  it('renders captured returned packages separately from delivered totals without rewriting the snapshot', async () => {
    const record = clone();
    record.snapshot.shipments[0].packages[0].status = DeliveryPackageStatus.RETURNED;
    const before = JSON.stringify(record);
    const extracted = text(await renderDeliveryManifest(record, 'manifest'));
    expect(extracted).toContain('État capturé : Retourné');
    expect(extracted).toContain(
      'Préparés : 0 | Chargés : 0 | Livrés : 1 | Retournés : 1 | Annulés : 1',
    );
    expect(extracted).not.toContain('État capturé : RETURNED');
    expect(JSON.stringify(record)).toBe(before);
    // Labels remain historical identification copies, not dispatch authorization.
    const labels = await renderDeliveryManifest(record, 'labels');
    expect(count(labels)).toBe(2);
    expect(text(labels)).toContain('État capturé : Retourné');
  });

  it('rejects an overlong label destination or barcode without shrinking below readable limits', () => {
    const record = clone();
    record.snapshot.shipments[0].destination.name = 'Longue destination '.repeat(100);
    expect(() => validateDeliveryManifestPrintable(record.snapshot)).toThrow(
      'Destination trop longue',
    );
    const other = clone();
    other.snapshot.shipments[0].packages[0].code = 'W'.repeat(100);
    expect(() => validateDeliveryManifestPrintable(other.snapshot)).toThrow('Code colis trop long');
  });

  it('rejects oversized payload, package and content-line counts', () => {
    const record = clone();
    record.reason = 'x'.repeat(10 * 1024 * 1024);
    expect(() => validateDeliveryManifestPrintable(record)).toThrow('10 Mio');
    const many = clone();
    const item = many.snapshot.shipments[0].packages[0];
    many.snapshot.shipments[0].packages = Array(2001).fill(item);
    expect(() => validateDeliveryManifestPrintable(many)).toThrow('2000 colis');
    const contents = clone();
    contents.snapshot.shipments[0].packages[0].contents = Array(5001).fill(item.contents[0]);
    expect(() => validateDeliveryManifestPrintable(contents)).toThrow('5000 lignes');
  });

  it('allows an empty manifest but rejects an empty labels download', async () => {
    const record = clone();
    record.snapshot.shipments = [];
    expect(text(await renderDeliveryManifest(record, 'manifest'))).toContain('Aucune expédition');
    await expect(renderDeliveryManifest(record, 'labels')).rejects.toThrow(
      'Aucun colis non annulé',
    );
  });

  it('can emit local visual-QA fixtures when explicitly requested', async () => {
    const directory = process.env.DELIVERY_MANIFEST_QA_DIR;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    const long = clone();
    long.snapshot.shipments[0].packages[0].contents = Array.from({ length: 50 }, (_, index) => ({
      reference: `REF-${index}`,
      description: 'Composant à vérifier avant le départ. '.repeat(6),
      quantity: '0.125',
      unit: 'kg',
    }));
    await writeFile(
      join(directory, 'manifest.pdf'),
      await renderDeliveryManifest(clone(), 'manifest'),
    );
    await writeFile(join(directory, 'labels.pdf'), await renderDeliveryManifest(clone(), 'labels'));
    await writeFile(
      join(directory, 'manifest-long.pdf'),
      await renderDeliveryManifest(long, 'manifest'),
    );
    const returned = clone();
    returned.snapshot.shipments[0].packages[0].status = DeliveryPackageStatus.RETURNED;
    await writeFile(
      join(directory, 'manifest-returned.pdf'),
      await renderDeliveryManifest(returned, 'manifest'),
    );
  });
});
