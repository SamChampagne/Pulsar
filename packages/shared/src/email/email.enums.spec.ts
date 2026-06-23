import { describe, it, expect } from 'vitest';
import { EmailDriver, EmailStatus } from './email.enums';

describe('EmailDriver', () => {
  it('SMTP = "SMTP"', () => {
    expect(EmailDriver.SMTP).toBe('SMTP');
  });
});

describe('EmailStatus', () => {
  it('has all four values', () => {
    expect(EmailStatus.QUEUED).toBe('QUEUED');
    expect(EmailStatus.SENDING).toBe('SENDING');
    expect(EmailStatus.SENT).toBe('SENT');
    expect(EmailStatus.FAILED).toBe('FAILED');
  });
});
