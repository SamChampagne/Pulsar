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

  it('accepts a valid cta block', () => {
    expect(
      validateLandingContent([{ type: 'cta', label: 'En savoir plus', href: '/contact' }]),
    ).toBe(true);
    expect(
      validateLandingContent([{ type: 'cta', label: 'Visiter', href: 'https://example.com' }]),
    ).toBe(true);
    expect(
      validateLandingContent([{ type: 'cta', label: 'Visiter', href: 'http://example.com' }]),
    ).toBe(true);
  });

  it('rejects a cta block with a javascript: href', () => {
    expect(
      validateLandingContent([{ type: 'cta', label: 'Cliquez', href: 'javascript:alert(1)' }]),
    ).toBe(false);
  });

  it('rejects a cta block with an empty label', () => {
    expect(validateLandingContent([{ type: 'cta', label: '', href: '/contact' }])).toBe(false);
  });

  it('rejects a cta block with a label over 80 chars', () => {
    expect(
      validateLandingContent([{ type: 'cta', label: 'x'.repeat(81), href: '/contact' }]),
    ).toBe(false);
  });

  it('rejects a cta block with a missing or empty href', () => {
    expect(validateLandingContent([{ type: 'cta', label: 'Cliquez' }])).toBe(false);
    expect(validateLandingContent([{ type: 'cta', label: 'Cliquez', href: '' }])).toBe(false);
  });

  it('rejects a protocol-relative cta href (open redirect)', () => {
    expect(
      validateLandingContent([{ type: 'cta', label: 'Cliquez', href: '//evil.com' }]),
    ).toBe(false);
  });

  it('accepts a single-leading-slash relative cta href', () => {
    expect(
      validateLandingContent([{ type: 'cta', label: 'Connexion', href: '/portal/login' }]),
    ).toBe(true);
  });

  it('accepts a full https cta href', () => {
    expect(
      validateLandingContent([{ type: 'cta', label: 'Visiter', href: 'https://x.y' }]),
    ).toBe(true);
  });
});

describe('LandingPageStatus', () => {
  it('has DRAFT/PUBLISHED', () => {
    expect(LandingPageStatus.DRAFT).toBe('DRAFT');
    expect(LandingPageStatus.PUBLISHED).toBe('PUBLISHED');
  });
});
