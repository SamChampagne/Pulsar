import { describe, it, expect } from 'vitest';
import {
  canTransitionSms,
  E164_PATTERN,
  SmsStatus,
  SMTP_PRESETS,
  SmsDeliveryStatus,
  canTransitionSmsDelivery,
  isSmsStop,
} from './communications';
describe('Communications contracts', () => {
  it('keeps final delivery receipts terminal and distinct from send acceptance', () => {
    for (const from of Object.values(SmsDeliveryStatus))
      for (const to of Object.values(SmsDeliveryStatus))
        expect(canTransitionSmsDelivery(from, to)).toBe(from === 'PENDING' && to !== 'PENDING');
  });
  it('recognizes whole STOP keywords without treating normal text or START as consent', () => {
    for (const text of [' STOP ', 'stopall', 'Arrêt', 'UNSUBSCRIBE'])
      expect(isSmsStop(text)).toBe(true);
    for (const text of ['START', 'stop at the dock', 'end of shift', ''])
      expect(isSmsStop(text)).toBe(false);
  });
  it('only finishes a sending SMS; never retries a terminal or uncertain message', () => {
    for (const from of Object.values(SmsStatus))
      for (const to of Object.values(SmsStatus))
        expect(canTransitionSms(from, to)).toBe(
          from === SmsStatus.SENDING && to !== SmsStatus.SENDING,
        );
  });
  it('requires international numbers, not arbitrary text or extensions', () => {
    expect(E164_PATTERN.test('+15145550123')).toBe(true);
    for (const n of [
      '5145550123',
      '+01234',
      '+1514ABC0000',
      '+15145550123 poste 1',
      '+1234567890123456',
    ])
      expect(E164_PATTERN.test(n)).toBe(false);
  });
  it('does not pretend SMTP presets implement OAuth or native provider APIs', () => {
    expect(SMTP_PRESETS.find((p) => p.key === 'brevo')?.host).toBe('smtp-relay.brevo.com');
    expect(SMTP_PRESETS.every((p) => p.port === (p.secure ? 465 : 587))).toBe(true);
  });
});
