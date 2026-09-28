import { describe, expect, it } from 'vitest';
import { lotTraceChronology, verifyLotTraceProof, type LotTraceJournalMovement } from './lot-trace';
const journal: LotTraceJournalMovement[] = [
  {
    id: 'in',
    type: 'CONSUMPTION',
    itemId: 'raw',
    lotId: 'a',
    lotCode: 'A',
    fromBinId: 'bin',
    toBinId: null,
    quantity: '1.625',
    unit: 'KG',
    createdAt: '2026-09-25T12:00:00Z',
  },
  {
    id: 'out',
    type: 'PRODUCTION',
    itemId: 'fg',
    lotId: 'b',
    lotCode: 'B',
    fromBinId: null,
    toBinId: 'dest',
    quantity: '2',
    unit: 'EA',
    createdAt: '2026-09-25T12:00:00Z',
  },
];
const proof = () => ({
  version: 2,
  locationId: 'site',
  movements: journal.map((m) => ({
    id: m.id,
    type: m.type,
    itemId: m.itemId,
    quantity: m.quantity,
    unit: m.unit,
    binId: m.fromBinId ?? m.toBinId,
    binCode: 'Captured',
    lot: { id: m.lotId, code: m.lotCode },
  })),
});
describe('read-only lot trace proof', () => {
  it('preserves exact quantities and captured bin names without allocation', () => {
    expect(verifyLotTraceProof(proof(), 'site', journal)).toEqual(
      journal.map((m) => ({ ...m, binCode: 'Captured' })),
    );
  });
  it.each(['version', 'location', 'quantity', 'unit', 'lot', 'bin', 'missing', 'duplicate'])(
    'rejects unsupported or inconsistent %s evidence',
    (kind) => {
      const p = proof();
      if (kind === 'version') p.version = 1;
      if (kind === 'location') p.locationId = 'elsewhere';
      if (kind === 'quantity') p.movements[0].quantity = '1.624';
      if (kind === 'unit') p.movements[0].unit = 'LB';
      if (kind === 'lot') p.movements[0].lot.id = 'other';
      if (kind === 'bin') p.movements[0].binId = 'other';
      if (kind === 'missing') p.movements.pop();
      if (kind === 'duplicate') p.movements[1] = p.movements[0];
      expect(verifyLotTraceProof(p, 'site', journal)).toBeNull();
    },
  );
  it('rejects duplicate journal rows, empty proof and invalid physical time', () => {
    expect(verifyLotTraceProof(proof(), 'site', [journal[0], journal[0]])).toBeNull();
    expect(
      verifyLotTraceProof({ version: 2, locationId: 'site', movements: [] }, 'site', []),
    ).toBeNull();
    expect(
      verifyLotTraceProof(proof(), 'site', [{ ...journal[0], createdAt: 'bad' }, journal[1]]),
    ).toBeNull();
  });
  it('allows same-transaction time but never travels backwards along a physical chain', () => {
    const t = Date.parse(journal[0].createdAt),
      a = journal[0].createdAt,
      b = '2026-09-25T13:00:00Z';
    expect(lotTraceChronology('downstream', t, a, a)).toBe(true);
    expect(lotTraceChronology('downstream', t + 1, a, b)).toBe(false);
    expect(lotTraceChronology('upstream', t, a, b)).toBe(false);
    expect(lotTraceChronology('upstream', Infinity, a, b)).toBe(true);
    expect(lotTraceChronology('downstream', -Infinity, b, a)).toBe(false);
    expect(lotTraceChronology('downstream', NaN, a, a)).toBe(false);
  });
});
