import { describe, expect, it } from 'vitest';
import {
  canTransitionLotDisposition,
  lotAllowsMovement,
  LotDisposition as D,
  StockMovementType as M,
} from './wms.workflow';
describe('lot quarantine', () => {
  it('has only explicit opposite transitions', () => {
    expect(canTransitionLotDisposition(D.UNRESTRICTED, D.QUARANTINED)).toBe(true);
    expect(canTransitionLotDisposition(D.QUARANTINED, D.UNRESTRICTED)).toBe(true);
    expect(canTransitionLotDisposition(D.QUARANTINED, D.QUARANTINED)).toBe(false);
    expect(canTransitionLotDisposition('UNKNOWN' as D, D.UNRESTRICTED)).toBe(false);
  });
  it('blocks every outgoing use except a move retaining lot identity', () => {
    for (const type of Object.values(M)) {
      expect(lotAllowsMovement(D.UNRESTRICTED, type, true)).toBe(true);
      expect(lotAllowsMovement(D.QUARANTINED, type, true)).toBe(type === M.MOVE);
      expect(lotAllowsMovement(D.QUARANTINED, type, false)).toBe(true);
    }
    expect(lotAllowsMovement('UNKNOWN' as D, M.RECEIPT, false)).toBe(false);
  });
});
