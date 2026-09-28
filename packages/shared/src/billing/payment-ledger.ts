import { ledgerAmount, ledgerCents, validateLedgerLines } from './ledger-exact';

export interface PaymentLedgerLine {
  accountCode: string;
  debit: string;
  credit: string;
}

/** Reverse the posted facts, never today's payment-mode or AR/AP configuration. */
export function reversePaymentLedger(lines: PaymentLedgerLine[]): PaymentLedgerLine[] {
  const checked = validateLedgerLines(lines);
  return checked.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit }));
}

/** Declared remainder is not posted and is NOT an advance, credit or bank balance. */
export function paymentAllocationAmounts(totalAmount: string, amounts: string[]) {
  const total = ledgerCents(totalAmount),
    allocations = amounts.map(ledgerCents);
  if (total <= 0n || !allocations.length || allocations.some((v) => v <= 0n))
    throw Error('Montant et affectations strictement positifs requis.');
  const allocated = allocations.reduce((sum, amount) => sum + amount, 0n);
  if (allocated > total) throw Error('Les affectations dépassent le montant déclaré du paiement.');
  return {
    total: ledgerAmount(total),
    allocatedAmount: ledgerAmount(allocated),
    unallocatedAmount: ledgerAmount(total - allocated),
    allocationState: allocated === total ? ('FULL' as const) : ('PARTIAL' as const),
    allocationCount: allocations.length,
  };
}

/** Qualify only the existing allocation-sized journal. Never fill its unposted remainder. */
export function reconcilePaymentLedger(input: {
  total: string;
  allocations: string[];
  lines: PaymentLedgerLine[];
  reversal?: PaymentLedgerLine[];
}) {
  const amounts = paymentAllocationAmounts(input.total, input.allocations);
  const reversed = reversePaymentLedger(input.lines);
  if (
    input.lines.reduce((s, l) => s + ledgerCents(l.debit), 0n) !==
    ledgerCents(amounts.allocatedAmount)
  )
    throw Error('Le journal ne correspond pas au total affecté du paiement.');
  if (input.reversal) {
    validateLedgerLines(input.reversal);
    const signature = (lines: PaymentLedgerLine[]) => {
      const sums = new Map<string, [bigint, bigint]>();
      for (const l of lines) {
        const sum = sums.get(l.accountCode) ?? [0n, 0n];
        sums.set(l.accountCode, [sum[0] + ledgerCents(l.debit), sum[1] + ledgerCents(l.credit)]);
      }
      return JSON.stringify(
        [...sums]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([a, [d, c]]) => [a, d.toString(), c.toString()]),
      );
    };
    if (signature(reversed) !== signature(input.reversal))
      throw Error('La contrepassation ne neutralise pas les comptes originaux.');
  }
  return amounts;
}
