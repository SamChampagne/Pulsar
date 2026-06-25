import { describe, it, expect } from 'vitest';
import { slugify, mapSubmissionToContact, validateLandingContent, LandingPageStatus } from './landing';

describe('slugify', () => {
  it('lowercases, strips accents, spaces→dashes, alnum+dash only', () => {
    expect(slugify('Ma Belle Page!')).toBe('ma-belle-page');
    expect(slugify('Été 2026 — Promo')).toBe('ete-2026-promo');
    expect(slugify('  multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugify('Déjà-Vu')).toBe('deja-vu');
  });
});

describe('mapSubmissionToContact', () => {
  it('extracts recognised lead fields', () => {
    expect(mapSubmissionToContact({ name: 'Jane', email: 'J@x.test', company: 'Acme', extra: 'x' }))
      .toEqual({ name: 'Jane', email: 'J@x.test', companyName: 'Acme' });
  });
  it('omits missing fields', () => {
    expect(mapSubmissionToContact({ email: 'a@b.test' })).toEqual({ email: 'a@b.test' });
    expect(mapSubmissionToContact({})).toEqual({});
  });
});

describe('validateLandingContent', () => {
  it('accepts an array of blocks with known types', () => {
    expect(validateLandingContent([{ type: 'heading', text: 'Hi' }, { type: 'form', fields: ['email'] }])).toBe(true);
  });
  it('rejects non-array or unknown block type', () => {
    expect(validateLandingContent({})).toBe(false);
    expect(validateLandingContent([{ type: 'bogus' }])).toBe(false);
  });
});

describe('LandingPageStatus', () => {
  it('has DRAFT/PUBLISHED', () => {
    expect(LandingPageStatus.DRAFT).toBe('DRAFT');
    expect(LandingPageStatus.PUBLISHED).toBe('PUBLISHED');
  });
});
