import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  readEvidenceIntent,
  rememberEvidenceIntent,
  sameEvidenceFile,
  type EvidenceIntent,
} from './evidence-intent';
describe('stock exit file exact recovery', () => {
  const p: EvidenceIntent = {
    operationKey: '0b90fa3f-b0a7-4523-bc15-1f6fbad2579f',
    caption: 'Bon fournisseur',
    fileName: 'proof.pdf',
    mimeType: 'application/pdf',
    size: 100,
    sha256: 'a'.repeat(64),
  };
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
    });
  });
  it('stores metadata only and preserves the same request after reload', () => {
    rememberEvidenceIntent('k', p);
    expect(readEvidenceIntent('k')).toEqual(p);
    rememberEvidenceIntent('k', p);
    expect(readEvidenceIntent('other')).toBeNull();
  });
  it('refuses replacement of an uncertain request', () => {
    rememberEvidenceIntent('k', p);
    expect(() => rememberEvidenceIntent('k', { ...p, caption: 'different' })).toThrow();
  });
  it('requires identical bytes, filename, MIME and size for reselection', () => {
    const file = { name: p.fileName, type: p.mimeType, size: p.size };
    expect(sameEvidenceFile(p, file, p.sha256)).toBe(true);
    expect(sameEvidenceFile(p, { ...file, name: 'other.pdf' }, p.sha256)).toBe(false);
    expect(sameEvidenceFile(p, file, 'b'.repeat(64))).toBe(false);
  });
  it.each([
    { ...p, sha256: 'x' },
    { ...p, size: 0 },
    { ...p, operationKey: 'x' },
    { ...p, mimeType: 'text/html' },
  ])('fails closed on malformed metadata', (value) => {
    localStorage.setItem('k', JSON.stringify(value));
    expect(() => readEvidenceIntent('k')).toThrow();
  });
});
