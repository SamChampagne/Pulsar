/**
 * The EDI identity predicate — the single definition every gate and both
 * inbound doors share. Round 2 of the security review: keying the gates on the
 * key prefix while the public door dispatched on `config.format` left a bypass
 * (an arbitrary key + `format: 'x12'` = an ungated anonymous EDI door).
 */
import { BadRequestException } from '@nestjs/common';
import { isEdiIntegration, mentionsEdi, normalizeEdiConfig } from './edi-identity';

describe('isEdiIntegration — both halves required', () => {
  it('accepts only an edi- key carrying format x12', () => {
    expect(isEdiIntegration('edi-acme', { format: 'x12' })).toBe(true);
  });

  it('rejects each half on its own (the two bypasses)', () => {
    // The dispatch bypass: any key + the format.
    expect(isEdiIntegration('partner-acme', { format: 'x12' })).toBe(false);
    expect(isEdiIntegration('webhook-main', { format: 'x12' })).toBe(false);
    // The gate bypass: the key without the format.
    expect(isEdiIntegration('edi-acme', {})).toBe(false);
    expect(isEdiIntegration('edi-acme', { format: 'json' })).toBe(false);
    expect(isEdiIntegration('edi-acme', undefined)).toBe(false);
  });
});

describe('mentionsEdi — the guards run on EITHER half', () => {
  it('is true as soon as one half claims EDI', () => {
    expect(mentionsEdi('edi-acme', {})).toBe(true);
    expect(mentionsEdi('partner-acme', { format: 'x12' })).toBe(true);
    expect(mentionsEdi('edi-acme', { format: 'x12' })).toBe(true);
  });

  it('is false for an ordinary integration', () => {
    expect(mentionsEdi('webhook-main', { format: 'slack' })).toBe(false);
    expect(mentionsEdi('quickbooks', undefined)).toBe(false);
  });
});

describe('normalizeEdiConfig — the halves agree before anything is stored', () => {
  it('refuses format x12 outside the edi- namespace', () => {
    expect(() => normalizeEdiConfig('partner-acme', { format: 'x12', customerId: 'c1' })).toThrow(
      BadRequestException,
    );
    expect(() => normalizeEdiConfig('webhook-main', { format: 'x12' })).toThrow(/edi-/);
  });

  it('defaults an edi- key to format x12', () => {
    expect(normalizeEdiConfig('edi-acme', { customerId: 'c1' })).toEqual({
      customerId: 'c1',
      format: 'x12',
    });
  });

  it('refuses another format on an edi- key', () => {
    expect(() => normalizeEdiConfig('edi-acme', { format: 'slack' })).toThrow(BadRequestException);
  });

  it('leaves a coherent pair and an ordinary integration untouched', () => {
    const edi = { format: 'x12', customerId: 'c1' };
    expect(normalizeEdiConfig('edi-acme', edi)).toBe(edi);
    const webhook = { format: 'slack', url: 'https://hooks.example.com' };
    expect(normalizeEdiConfig('webhook-main', webhook)).toBe(webhook);
  });

  it('whatever it returns is a fully-declared EDI receiver, or not EDI at all', () => {
    for (const key of ['edi-acme', 'webhook-main', 'quickbooks']) {
      for (const config of [{}, { customerId: 'c1' }, { url: 'https://p.example.com' }]) {
        const normalized = normalizeEdiConfig(key, config);
        expect(isEdiIntegration(key, normalized)).toBe(key.startsWith('edi-'));
      }
    }
  });
});
