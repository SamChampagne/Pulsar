/** Explicit commercial ratio, not a physical-unit/density inference. Browser-safe.
 * Reject rather than round when the result cannot fit the MRP's 3 decimals. */
export function convertMrpCommercialQuantity(
  quantity: string,
  numerator: string,
  denominator: string,
): string {
  const scaled = (value: string, precision: number) => {
    if (!new RegExp(`^\\d{1,10}(\\.\\d{1,${precision}})?$`).test(value))
      throw new Error('Valeur décimale invalide.');
    const [whole, fraction = ''] = value.split('.');
    const result =
      BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'));
    if (result <= 0n || result > 1_000_000_000n * 10n ** BigInt(precision))
      throw new Error('Valeur positive, maximum 1 milliard.');
    return result;
  };
  const total = scaled(quantity, 3) * scaled(numerator, 6);
  const divisor = scaled(denominator, 6);
  if (total % divisor !== 0n)
    throw new Error('Conversion non exacte à 3 décimales. Aucun arrondi automatique.');
  const result = total / divisor;
  if (result > 1_000_000_000_000n) throw new Error('Quantité convertie supérieure à 1 milliard.');
  return `${result / 1000n}.${String(result % 1000n).padStart(3, '0')}`.replace(/\.?0+$/, '');
}
