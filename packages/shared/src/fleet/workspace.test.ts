import { describe, it, expect } from 'vitest';
import { fleetAttention, fleetDateKey, fleetDateWindow } from './workspace';

describe('Fleet workspace projections', () => {
  it('keeps UTC date boundaries across DST and leap days', () => {
    expect(fleetDateWindow('2026-03-08')).toEqual({
      from: '2026-03-08T00:00:00.000Z',
      until: '2026-03-15T00:00:00.000Z',
    });
    expect(fleetDateWindow('2024-02-29').until).toBe('2024-03-07T00:00:00.000Z');
    expect(fleetDateKey('2026-09-14T23:30:00-04:00')).toBe('2026-09-15');
  });
  it.each(['2026-02-30', '2025-02-29', 'garbage', '2026-9-01', '2026-13-01'])(
    'rejects %s',
    (value) => {
      expect(() => fleetDateWindow(value)).toThrow();
    },
  );
  it('prioritizes retired status and active interventions over expiry counts', () => {
    expect(fleetAttention({ status: 'RETIRED', openOrders: 2, expiredDocuments: 3 })).toBe(
      'Retiré du parc',
    );
    expect(fleetAttention({ status: 'AVAILABLE', openOrders: 2, expiredDocuments: 3 })).toBe(
      '2 intervention(s) active(s)',
    );
    expect(fleetAttention({ status: 'MAINTENANCE', openOrders: 0, expiredDocuments: 0 })).toBe(
      'Immobilisation sans ordre actif',
    );
    expect(fleetAttention({ status: 'AVAILABLE', openOrders: 0, expiredDocuments: 3 })).toBe(
      'Documents expirés à vérifier',
    );
  });
});
