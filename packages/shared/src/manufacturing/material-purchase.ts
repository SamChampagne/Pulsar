export enum MaterialPurchaseStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

/** Exact stock quantity (3dp) × unit price (6dp), HALF_UP to 2dp; no double rounding. */
export function materialPurchaseSubtotal(quantity: string, unitPrice: string): string {
  const scaled = (value: string, scale: number) => {
    if (!new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value))
      throw new Error('Invalid purchase decimal');
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
  };
  const product = scaled(quantity, 3) * scaled(unitPrice, 6);
  const cents = (product + 5_000_000n) / 10_000_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** Confirmation records an order placed outside Pulsar; it never sends it. */
export function canTransitionMaterialPurchase(
  from: MaterialPurchaseStatus,
  to: MaterialPurchaseStatus,
) {
  return (
    (from === MaterialPurchaseStatus.DRAFT &&
      [MaterialPurchaseStatus.CONFIRMED, MaterialPurchaseStatus.CANCELLED].includes(to)) ||
    (from === MaterialPurchaseStatus.CONFIRMED && to === MaterialPurchaseStatus.CANCELLED)
  );
}
