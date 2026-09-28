import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readLotDecisionIntent,
  rememberLotDecisionIntent,
  type LotDecisionIntent,
} from './lot-decision-intent';
describe('quarantine recovery', () => {
  const value: LotDecisionIntent = {
    action: 'quarantine',
    body: {
      operationKey: '12345678-1234-4123-8123-123456789012',
      expectedRevision: 0,
      reason: 'Contrôle requis',
    },
  };
  beforeEach(() => {
    const rows = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => rows.get(k) ?? null,
      setItem: (k: string, v: string) => rows.set(k, v),
    });
  });
  it('preserves the exact pending decision and refuses replacement', () => {
    rememberLotDecisionIntent('scope', value);
    expect(readLotDecisionIntent('scope')).toEqual(value);
    expect(() => rememberLotDecisionIntent('scope', { ...value, action: 'release' })).toThrow(
      'attend',
    );
  });
  it('fails closed for malformed or unavailable storage', () => {
    localStorage.setItem('scope', JSON.stringify({ ...value, action: 'release' }));
    expect(() => readLotDecisionIntent('scope')).toThrow('illisible');
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw Error('quota');
      },
    });
    expect(() => rememberLotDecisionIntent('scope', value)).toThrow('Aucune demande');
  });
  it('preserves the exact inspection version and rejects incomplete or hold references', () => {
    const release: LotDecisionIntent = {
      action: 'release',
      body: {
        ...value.body,
        controlNote: 'Inspection visuelle conforme',
        qualityInspectionId: 'qc-1',
        expectedInspectionUpdatedAt: '2026-09-25T12:00:00.000Z',
      },
    };
    rememberLotDecisionIntent('scope', release);
    expect(readLotDecisionIntent('scope')).toEqual(release);
    for (const body of [
      { ...release.body, expectedInspectionUpdatedAt: undefined },
      { ...release.body, qualityInspectionId: undefined },
      { ...release.body, expectedInspectionUpdatedAt: 'bad' },
    ]) {
      localStorage.setItem('scope', JSON.stringify({ action: 'release', body }));
      expect(() => readLotDecisionIntent('scope')).toThrow('illisible');
    }
    localStorage.setItem('scope', JSON.stringify({ ...release, action: 'quarantine' }));
    expect(() => readLotDecisionIntent('scope')).toThrow('illisible');
  });
});
