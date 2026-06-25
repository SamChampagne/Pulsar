import { describe, it, expect } from 'vitest';
import {
  normalizeSubject,
  resolveThreadDecision,
  EmailThreadStatus,
  EmailDirection,
} from './email-thread';

describe('normalizeSubject', () => {
  it('strips re:/fwd:/fw: prefixes (case-insensitive, repeated)', () => {
    expect(normalizeSubject('Re: Hello')).toBe('hello');
    expect(normalizeSubject('FWD: Re: RE: Quote')).toBe('quote');
    expect(normalizeSubject('Fw: Devis')).toBe('devis');
    expect(normalizeSubject('  Plain  ')).toBe('plain');
    expect(normalizeSubject('')).toBe('');
  });
});

describe('resolveThreadDecision', () => {
  it('reuses an existing thread when a referenced message is known', () => {
    const d = resolveThreadDecision({
      inReplyTo: '<a@x>',
      references: ['<a@x>'],
      knownMessageThreadId: 'thr_1',
      matchedContact: { id: 'c1', companyId: 'co1' },
    });
    expect(d).toEqual({ kind: 'existing', threadId: 'thr_1' });
  });

  it('creates a linked thread when the sender matches a contact', () => {
    const d = resolveThreadDecision({
      inReplyTo: null,
      references: [],
      knownMessageThreadId: null,
      matchedContact: { id: 'c1', companyId: 'co1' },
    });
    expect(d).toEqual({ kind: 'new-linked', contactId: 'c1', companyId: 'co1' });
  });

  it('creates an unlinked thread when nothing matches', () => {
    const d = resolveThreadDecision({
      inReplyTo: null,
      references: [],
      knownMessageThreadId: null,
      matchedContact: null,
    });
    expect(d).toEqual({ kind: 'new-unlinked' });
  });

  it('enums carry the expected string values', () => {
    expect(EmailThreadStatus.UNLINKED).toBe('UNLINKED');
    expect(EmailDirection.INBOUND).toBe('INBOUND');
  });
});
