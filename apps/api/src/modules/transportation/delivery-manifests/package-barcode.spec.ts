import { createHash } from 'node:crypto';
import { CODE128_WIDTHS, encodePackageBarcode } from './package-barcode';

describe('package Code 128 B', () => {
  it('matches the complete independent ReportLab symbol-width table', () => {
    expect(CODE128_WIDTHS).toHaveLength(107);
    expect(createHash('sha256').update(CODE128_WIDTHS.join(' ')).digest('hex')).toBe(
      'b6f88d58a2b8db74630a341807da5efa165ef1856b1f0de01ea2358ac9049ce9',
    );
    for (const widths of CODE128_WIDTHS.slice(0, 106)) {
      expect(widths).toMatch(/^[1-4]{6}$/);
      expect([...widths].reduce((sum, n) => sum + Number(n), 0)).toBe(11);
    }
    expect(CODE128_WIDTHS[106]).toBe('2331112');
  });

  it.each([
    ['PKG-000001', [104, 48, 43, 39, 13, 16, 16, 16, 16, 16, 17, 4, 106]],
    ['PKG-000002', [104, 48, 43, 39, 13, 16, 16, 16, 16, 16, 18, 14, 106]],
    ['Pulsar-09', [104, 48, 85, 76, 83, 65, 82, 13, 16, 25, 83, 106]],
    ['0000123', [104, 16, 16, 16, 16, 17, 18, 19, 75, 106]],
  ] as const)('matches the fixed-set B reference vector for %s', (code, words) => {
    const result = encodePackageBarcode(code);
    expect(result.payload).toBe(code);
    expect(result.codewords).toEqual(words);
  });

  it('preserves leading zeros and case, with exact quiet zones and stop termination', () => {
    const result = encodePackageBarcode('PKG-000001');
    expect(result.bars[0].offset).toBe(10);
    const last = result.bars[result.bars.length - 1];
    expect(last.width).toBe(2);
    expect(result.moduleCount - last.offset - last.width).toBe(10);
    expect(result.moduleCount).toBe(20 + 12 * 11 + 13);
    expect(encodePackageBarcode('a').codewords).not.toEqual(encodePackageBarcode('A').codewords);
  });

  it.each(['', ' PKG-1', 'PKG 1', 'PKG-1\n', 'é', '漢', '😀', '\u007f', 'A'.repeat(129)])(
    'rejects unsupported payload %j instead of changing it',
    (code) => {
      expect(() => encodePackageBarcode(code)).toThrow('Code colis non imprimable');
    },
  );
});
