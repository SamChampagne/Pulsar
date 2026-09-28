import { describe, expect, it } from 'vitest';
import { isTimeZone } from './time-zone';
describe('IANA time zones', () => {
  it('accepts civil zones and UTC, not arbitrary labels', () => {
    for (const zone of ['America/Toronto', 'America/Vancouver', 'Asia/Kolkata', 'UTC'])
      expect(isTimeZone(zone)).toBe(true);
    for (const zone of ['', null, 3, 'Toronto', 'America/Invented', 'x'.repeat(101)])
      expect(isTimeZone(zone)).toBe(false);
  });
});
