import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readSupplierReportIntent as read,
  rememberSupplierReportIntent as remember,
} from './supplier-report-intent';
const p = {
  operationKey: '12345678-1234-4234-8234-123456789abc',
  expectedRevision: 0,
  received: '5.125',
  accepted: '2',
  refused: '0',
  evidenceId: 'proof',
  reference: 'RMA-123',
  note: 'Réception confirmée par le fournisseur',
  reportedAt: '2026-09-26T12:00:00.000Z',
};
describe('supplier report durable request', () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    });
  });
  it('preserves the exact original cumulative quantities and version', () => {
    remember('k', p);
    expect(read('k')).toEqual(p);
    remember('k', p);
  });
  it('refuses to replace an unresolved body', () => {
    remember('k', p);
    expect(() => remember('k', { ...p, accepted: '3' })).toThrow();
    expect(read('k')).toEqual(p);
  });
  it.each([
    { expectedRevision: -1 },
    { received: '-1' },
    { evidenceId: '' },
    { reportedAt: '2026-09-26' },
    { correctionReason: 'x' },
  ])('rejects corrupt payload %s', (v) => {
    data.set('k', JSON.stringify({ ...p, ...v }));
    expect(() => read('k')).toThrow();
  });
  it('fails closed on unavailable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw Error();
      },
    });
    expect(() => remember('k', p)).toThrow('Aucune déclaration envoyée');
  });
});
