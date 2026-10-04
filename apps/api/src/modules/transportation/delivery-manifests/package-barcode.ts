/**
 * Code 128, fixed code set B (not GS1-128): the payload is the exact package code.
 * The factual symbol-width table and modulo-103 checksum follow Code 128.
 * Independently checked against ReportLab's Code128 symbol table and vectors:
 * https://hg.reportlab.com/hg-public/reportlab/file/tip/src/reportlab/graphics/barcode/code128.py
 * No FNC, URL, public token, implicit uppercasing or numeric conversion is used.
 * A keyboard-wedge scanner must enable Code 128 and send Enter after the payload.
 */
export const CODE128_WIDTHS = Object.freeze(
  (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 ' +
    '112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 ' +
    '311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 ' +
    '112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
    '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 ' +
    '122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
    '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
    '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
  ).split(' '),
);

export interface PackageBarcode {
  payload: string;
  codewords: number[];
  /** Includes ten-module quiet zones on both sides. */
  moduleCount: number;
  bars: { offset: number; width: number }[];
}

export function encodePackageBarcode(code: string): PackageBarcode {
  if (typeof code !== 'string' || !/^[!-~]{1,128}$/.test(code)) {
    throw new Error(
      'Code colis non imprimable : Code 128 exige 1 à 128 caractères ASCII sans espace.',
    );
  }
  const data = Array.from(code, (char) => char.charCodeAt(0) - 32);
  const checksum = (104 + data.reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103;
  const codewords = [104, ...data, checksum, 106];
  const bars: PackageBarcode['bars'] = [];
  let offset = 10;
  for (const word of codewords) {
    for (const [index, digit] of Array.from(CODE128_WIDTHS[word]).entries()) {
      const width = Number(digit);
      if (index % 2 === 0) bars.push({ offset, width });
      offset += width;
    }
  }
  return { payload: code, codewords, moduleCount: offset + 10, bars };
}
