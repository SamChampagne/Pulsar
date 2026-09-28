/** Exact multiplicative conversion. No density inference, floating-point rounding or price conversion. */
export function packageQuantity(
  count: string,
  unitsPerPackage: string,
  wholeOnly: boolean,
  precision: 3 | 4 = 4,
): string {
  const scaled = (value: string, decimals: number) => {
    if (!new RegExp(`^(?:0|[1-9]\\d{0,9})(?:\\.\\d{1,${decimals}})?$`).test(value))
      throw new Error('Quantité décimale invalide.');
    const [whole, fraction = ''] = value.split('.');
    const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
    if (result <= 0n || result > 1_000_000_000n * 10n ** BigInt(decimals))
      throw new Error('Quantité positive, maximum 1 milliard.');
    return result;
  };
  const c = scaled(count, 4),
    factor = scaled(unitsPerPackage, 6);
  if (wholeOnly && c % 10000n !== 0n)
    throw new Error('Ce conditionnement exige un nombre entier de colis.');
  const product = c * factor,
    divisor = 10n ** BigInt(10 - precision);
  if (product % divisor !== 0n)
    throw new Error(`Conversion non exacte à ${precision} décimales. Aucun arrondi automatique.`);
  const result = product / divisor,
    scale = 10n ** BigInt(precision);
  if (result > 1_000_000_000n * scale)
    throw new Error('Quantité convertie supérieure à 1 milliard.');
  const fraction = String(result % scale)
    .padStart(precision, '0')
    .replace(/0+$/, '');
  return `${result / scale}${fraction ? `.${fraction}` : ''}`;
}
export interface CatalogPackageSnapshot {
  schemaVersion: 1;
  packageId: string;
  version: number;
  catalogItemId: string;
  code: string;
  label: string;
  barcode: string | null;
  baseUnit: string;
  unitsPerPackage: string;
  wholeOnly: boolean;
  orderedCount: string;
  baseQuantity: string;
}
