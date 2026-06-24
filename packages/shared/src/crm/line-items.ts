/** Round a number to 2 decimals (half-up on the cent). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LineItemAmounts {
  quantity: number;
  unitPrice: number;
  discountPct: number;
}

/** Line total = quantity × unitPrice × (1 − discountPct/100), rounded to 2 decimals. */
export function computeLineTotal(line: LineItemAmounts): number {
  const gross = line.quantity * line.unitPrice;
  const net = gross * (1 - line.discountPct / 100);
  return round2(net);
}

/** Sum of line totals, rounded to 2 decimals. */
export function sumLineItems(lines: LineItemAmounts[]): number {
  return round2(lines.reduce((acc, l) => acc + computeLineTotal(l), 0));
}
