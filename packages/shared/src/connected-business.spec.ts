import { describe, it, expect } from 'vitest';
import { connectedOperationsSettings } from './connected-business';
describe('connected operations settings', () => {
  it('provides explicit stable defaults without relying on the browser timezone', () => {
    expect(connectedOperationsSettings(null)).toEqual({
      timeZone: 'America/Toronto',
      qualificationDays: 30,
      enabled: { support: true, quality: true, time: true, purchasing: true, qualifications: true },
    });
  });
  it('keeps explicit disabled sources and bounds the expiry horizon', () => {
    expect(
      connectedOperationsSettings({
        timeZone: 'invalid/zone',
        qualificationDays: -1,
        enabled: { support: false },
      }),
    ).toMatchObject({
      timeZone: 'America/Toronto',
      qualificationDays: 30,
      enabled: { support: false, quality: true },
    });
    expect(
      connectedOperationsSettings({ timeZone: 'Europe/Paris', qualificationDays: 0 })
        .qualificationDays,
    ).toBe(0);
  });
});
