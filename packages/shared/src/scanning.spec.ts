import { describe, expect, it } from 'vitest';
import { normalizeScan } from './scanning';

describe('scanner input', () => {
  it.each(['\r', '\r\n', '\t', ''])(
    'strips a scanner terminator %j, preserving leading zeros and case',
    (suffix) => {
      expect(normalizeScan('0012aB' + suffix)).toBe('0012aB');
    },
  );
  it.each(['', ' ', 'a'.repeat(129), '01\x1d22', 'A\nB', 'A\x00B'])(
    'rejects invalid or composite data %j',
    (value) => {
      expect(() => normalizeScan(value)).toThrow();
    },
  );
});
