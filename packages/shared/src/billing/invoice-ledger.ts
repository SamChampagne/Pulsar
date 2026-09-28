import { ledgerAmount, ledgerCents, validateLedgerLines } from './ledger-exact';

export interface InvoiceLedgerLine {
  accountCode: string;
  accountType: string;
  debit: string;
  credit: string;
}

/** Reconcile captured carrier figures. The header remains authoritative; no tax recalculation. */
export function reconcileAcceptedCarrierAmounts(input: {
  total: string;
  tax: string;
  invoicedTotal: string;
  varianceTotal: string;
  varianceGross: string;
  lines: { amount: string; invoicedAmount: string; variance: string }[];
}) {
  const total = ledgerCents(input.total),
    tax = ledgerCents(input.tax);
  if (tax < 0n || total <= tax || !input.lines.length)
    throw Error('Montants acceptés non positifs ou lignes absentes.');
  let expected = 0n,
    received = 0n,
    variance = 0n,
    gross = 0n;
  for (const line of input.lines) {
    const e = ledgerCents(line.amount),
      r = ledgerCents(line.invoicedAmount),
      v = ledgerCents(line.variance);
    if (e < 0n || r < 0n || r - e !== v)
      throw Error('Écart de ligne différent des montants capturés.');
    expected += e;
    received += r;
    variance += v;
    gross += v < 0n ? -v : v;
  }
  if (
    expected <= 0n ||
    received !== ledgerCents(input.invoicedTotal) ||
    received !== total ||
    variance !== ledgerCents(input.varianceTotal) ||
    gross !== ledgerCents(input.varianceGross)
  )
    throw Error('Totaux du rapprochement différents du payable accepté ou des écarts capturés.');
  return {
    expectedLinesAmount: ledgerAmount(expected),
    receivedLinesAmount: ledgerAmount(received),
    expectedTotalWithFrozenTax: ledgerAmount(expected + tax),
    payableAdjustment: ledgerAmount(total - expected - tax),
    reconciliationVariance: ledgerAmount(variance),
    reconciliationGrossVariance: ledgerAmount(gross),
    net: ledgerAmount(total - tax),
  };
}

/** Captured tax amounts only: never recalculate historical rates or templates. */
export function frozenInvoiceTaxes(value: unknown, total: string) {
  if (!Array.isArray(value)) throw Error('Détail des taxes figées absent.');
  const amounts = new Map<string, bigint>();
  for (const row of value) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.accountCode !== 'string' ||
      !row.accountCode.trim()
    )
      throw Error('Compte de taxe figée invalide.');
    if (typeof row.amount !== 'string' && typeof row.amount !== 'number')
      throw Error('Montant de taxe figée invalide.');
    const amount = ledgerCents(String(row.amount));
    if (amount < 0n) throw Error('Taxe figée négative.');
    if (amount > 0n) amounts.set(row.accountCode, (amounts.get(row.accountCode) ?? 0n) + amount);
  }
  if (
    ledgerCents(total) < 0n ||
    [...amounts.values()].reduce((n, a) => n + a, 0n) !== ledgerCents(total)
  )
    throw Error('Le détail des taxes ne correspond pas au total figé.');
  return [...amounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountCode, amount]) => ({ accountCode, amount: ledgerAmount(amount) }));
}

/** Conservative standard invoice shape, determined from the posted accounts, not settings. */
export function reconcileInvoiceLedger(input: {
  customer: boolean;
  net: string;
  tax: string;
  total: string;
  taxes: unknown;
  lines: InvoiceLedgerLine[];
}) {
  const net = ledgerCents(input.net),
    tax = ledgerCents(input.tax),
    total = ledgerCents(input.total);
  if (net <= 0n || tax < 0n || net + tax !== total) throw Error('Montants de facture incohérents.');
  const taxes = frozenInvoiceTaxes(input.taxes, input.tax);
  const lines = input.lines.map((l) => ({
    ...l,
    debit: ledgerAmount(ledgerCents(l.debit)),
    credit: ledgerAmount(ledgerCents(l.credit)),
  }));
  validateLedgerLines(lines);
  const taxCodes = new Set(taxes.map((t) => t.accountCode));
  const principal = lines.filter((l) => !taxCodes.has(l.accountCode));
  const control = principal.filter((l) => ledgerCents(input.customer ? l.debit : l.credit) > 0n);
  const netLines = principal.filter((l) => ledgerCents(input.customer ? l.credit : l.debit) > 0n);
  if (
    principal.length !== 2 ||
    control.length !== 1 ||
    netLines.length !== 1 ||
    control[0].accountCode === netLines[0].accountCode ||
    control[0].accountType !== (input.customer ? 'ASSET' : 'LIABILITY') ||
    netLines[0].accountType !== (input.customer ? 'REVENUE' : 'EXPENSE') ||
    ledgerCents(input.customer ? control[0].debit : control[0].credit) !== total ||
    ledgerCents(input.customer ? netLines[0].credit : netLines[0].debit) !== net
  )
    throw Error('Comptes ou montants du journal incompatibles avec la facture.');
  for (const t of taxes) {
    const recorded = lines.filter((l) => l.accountCode === t.accountCode);
    if (
      recorded.some(
        (l) =>
          l.accountType !== (input.customer ? 'LIABILITY' : 'ASSET') ||
          ledgerCents(input.customer ? l.debit : l.credit) !== 0n,
      ) ||
      recorded.reduce((n, l) => n + ledgerCents(input.customer ? l.credit : l.debit), 0n) !==
        ledgerCents(t.amount)
    )
      throw Error('Taxes du journal incompatibles avec les taxes figées.');
  }
  return {
    net: ledgerAmount(net),
    tax: ledgerAmount(tax),
    total: ledgerAmount(total),
    controlAccount: control[0].accountCode,
    netAccount: netLines[0].accountCode,
    taxes,
  };
}

export function reconcileCustomerCreditLedger(input: {
  original: ReturnType<typeof reconcileInvoiceLedger>;
  net: string;
  tax: string;
  total: string;
  taxes: unknown;
  lines: InvoiceLedgerLine[];
}) {
  // Reverse the credit to reuse exactly the original invoice shape checks.
  const result = reconcileInvoiceLedger({
    ...input,
    customer: true,
    lines: input.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
  });
  if (
    result.controlAccount !== input.original.controlAccount ||
    result.netAccount !== input.original.netAccount ||
    ledgerCents(result.net) > ledgerCents(input.original.net) ||
    result.taxes.some(
      (t) =>
        ledgerCents(t.amount) >
        ledgerCents(
          input.original.taxes.find((o) => o.accountCode === t.accountCode)?.amount ?? '0',
        ),
    )
  )
    throw Error('L’avoir ne compense pas les comptes et montants de la facture originale.');
  return result;
}
