import { renderBol } from './bol-render';
import type { BolData } from './bol-data';

const minimalData: BolData = {
  bolNumber: 'BOL-000001',
  generatedAt: new Date('2026-06-11T12:00:00Z'),
  carrier: { name: 'Test Carrier', scac: 'TEST' },
  driverName: 'John Driver',
  equipment: { vehicle: 'V-100', trailer: 'TR-100' },
  shipper: { name: 'Shipper Co', address: '1 Pickup Ave', city: 'Montreal' },
  consignee: { name: 'Consignee Inc', address: '9 Delivery St', city: 'Toronto' },
  lines: [
    {
      shipmentNumber: 'SH-000001',
      orderNumber: 'TO-000001',
      customerReference: 'REF-001',
      weightKg: 500,
      palletCount: 10,
    },
  ],
  totals: { weightKg: 500, units: 10 },
  notes: 'Test note',
  conditions: 'Received in apparent good order and condition except as noted.',
};

describe('renderBol', () => {
  it('produces a valid PDF buffer starting with %PDF-', async () => {
    const buf = await renderBol(minimalData);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('produces a buffer larger than 1500 bytes', async () => {
    const buf = await renderBol(minimalData);
    expect(buf.length).toBeGreaterThan(1500);
  });

  it('resolves a Buffer (not a stream)', async () => {
    const buf = await renderBol(minimalData);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});
