import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  CURRENCIES,
  frozenInvoiceTaxes,
  ledgerAmount,
  ledgerCents,
  reconcileInvoiceLedger,
  reconcileCustomerCreditLedger,
  reconcileAcceptedCarrierAmounts,
  type AuthUser,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';

type Source = {
  id: string;
  currency: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceKind: string | null;
};
export const isInvoiceOriginal = (e: Source) =>
  e.currency === null &&
  ['customer-invoice', 'invoice'].includes(e.sourceType ?? '') &&
  !!e.sourceId &&
  e.sourceKind === 'approved';
export function assertInvoiceRead(u: AuthUser, e: { sourceType: string | null }) {
  const permission =
    e.sourceType === 'invoice'
      ? 'billing.invoices.read'
      : ['customer-invoice', 'customer-credit'].includes(e.sourceType ?? '')
        ? 'billing.customer-invoices.read'
        : null;
  if (permission && !u.permissions.includes(permission))
    throw new ForbiddenException(
      'Le droit de lecture de la facture source est requis pour ce dossier et ses preuves.',
    );
}
function fail(message: string): never {
  throw new ConflictException(message);
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function assessInvoiceSource(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  entry: Source,
) {
  assertInvoiceRead(u, entry);
  if (!isInvoiceOriginal(entry))
    fail('Un avoir se qualifie avec sa facture originale, jamais séparément.');
  const tenantId = u.tenantId,
    customer = entry.sourceType === 'customer-invoice';
  const common = {
    id: true,
    invoiceNumber: true,
    status: true,
    currency: true,
    totalAmount: true,
    taxAmount: true,
    taxDetail: true,
    approvedAt: true,
    updatedAt: true,
    _count: { select: { lines: true } },
  } as const;
  const invoice = customer
    ? await tx.customerInvoice.findFirst({
        where: { tenantId, id: entry.sourceId! },
        select: {
          ...common,
          customerId: true,
          creditedAmount: true,
          creditVersion: true,
          lines: {
            orderBy: { id: 'asc' },
            take: 501,
            select: { id: true, amount: true, quantity: true },
          },
        },
      })
    : await tx.invoice.findFirst({
        where: { tenantId, id: entry.sourceId! },
        select: {
          ...common,
          carrierId: true,
          invoicedTotal: true,
          varianceTotal: true,
          varianceGross: true,
          carrierInvoiceNumber: true,
          reconciledAt: true,
          disputeReasonCode: true,
          lines: {
            where: { load: { tenantId } },
            orderBy: { id: 'asc' },
            take: 501,
            select: { id: true, amount: true, invoicedAmount: true, variance: true },
          },
        },
      });
  if (!invoice) fail('Facture source absente de cette entreprise.');
  if (!(customer ? ['APPROVED', 'SENT', 'PAID'] : ['APPROVED', 'PAID']).includes(invoice.status))
    fail('La facture source doit être approuvée.');
  if (!CURRENCIES.some((c) => c.code === invoice.currency))
    fail('Devise source non prise en charge.');
  if (
    !invoice.lines.length ||
    invoice.lines.length > 500 ||
    invoice._count.lines !== invoice.lines.length
  )
    fail('Lignes source absentes, trop nombreuses ou de propriété incohérente.');
  const party =
    'customerId' in invoice
      ? await tx.customer.findFirst({
          where: { tenantId, id: invoice.customerId },
          select: { id: true },
        })
      : await tx.carrier.findFirst({
          where: { tenantId, id: invoice.carrierId },
          select: { id: true },
        });
  if (!party) fail('Tiers source absent de cette entreprise.');
  const notes = customer
    ? await tx.customerCreditNote.findMany({
        where: { tenantId, invoiceId: invoice.id },
        orderBy: { id: 'asc' },
        take: 201,
        select: {
          id: true,
          number: true,
          status: true,
          currency: true,
          netAmount: true,
          taxAmount: true,
          totalAmount: true,
          issuedAt: true,
          _count: { select: { lines: true } },
          lines: {
            where: { tenantId },
            orderBy: { id: 'asc' },
            take: 101,
            select: {
              id: true,
              invoiceLineId: true,
              quantity: true,
              netAmount: true,
              taxAmount: true,
              totalAmount: true,
              taxDetail: true,
            },
          },
        },
      })
    : [];
  if (notes.length > 200) fail('Plus de 200 avoirs : reprise spécialisée requise.');
  const entries = await tx.journalEntry.findMany({
    where: {
      tenantId,
      OR: [
        { sourceType: entry.sourceType, sourceId: invoice.id },
        ...(notes.length
          ? [{ sourceType: 'customer-credit', sourceId: { in: notes.map((n) => n.id) } }]
          : []),
      ],
    },
    orderBy: { id: 'asc' },
    take: 402,
    select: {
      id: true,
      date: true,
      currency: true,
      sourceType: true,
      sourceId: true,
      sourceKind: true,
      currencyQualification: {
        select: { state: true, currency: true, version: true, sourceEntryId: true },
      },
      _count: { select: { lines: true } },
      lines: {
        where: { tenantId, account: { tenantId } },
        orderBy: { id: 'asc' },
        take: 201,
        select: { debit: true, credit: true, account: { select: { code: true, type: true } } },
      },
    },
  });
  const originals = entries.filter((e) => e.sourceType === entry.sourceType),
    issued = notes.filter((n) => n.status === 'ISSUED');
  if (
    originals.length !== 1 ||
    originals[0].id !== entry.id ||
    originals[0].sourceKind !== 'approved' ||
    entries.length !== 1 + issued.length
  )
    fail('Écritures originales/avoirs absentes, dupliquées ou incompatibles avec les statuts.');
  const original = originals[0];
  if (entries.some((e) => e._count.lines !== e.lines.length || e.lines.length > 200))
    fail('Propriété ou nombre de lignes du journal incohérent.');
  const mapped = (e: typeof original) =>
    e.lines.map((l) => ({
      accountCode: l.account.code,
      accountType: l.account.type,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    }));
  const parent = original.currencyQualification;
  if (
    parent &&
    (parent.sourceEntryId !== original.id ||
      (parent.state === 'QUALIFIED' && parent.currency !== invoice.currency))
  )
    fail('Annotation originale sans provenance ou devise source cohérente.');
  let reconciled: ReturnType<typeof reconcileInvoiceLedger>;
  let adjustment:
    | (ReturnType<typeof reconcileAcceptedCarrierAmounts> & {
        resolution: 'ACCEPT_INVOICED';
        acceptedAt: Date;
        carrierInvoiceNumber: string;
      })
    | null = null;
  let acceptanceProof: string | null = null;
  try {
    const net = invoice.lines.reduce((n, l) => {
      const amount = ledgerCents(l.amount.toString());
      if (amount < 0n) throw Error('Ligne de facture négative.');
      return n + amount;
    }, 0n);
    const taxes =
      invoice.taxDetail === null ? [] : (invoice.taxDetail as { lines?: unknown }).lines;
    if (
      'carrierId' in invoice &&
      net + ledgerCents(invoice.taxAmount.toString()) !==
        ledgerCents(invoice.totalAmount.toString())
    ) {
      const prefix = 'Facture transporteur ajustée : ';
      if (
        !invoice.approvedAt ||
        !invoice.reconciledAt ||
        invoice.reconciledAt > invoice.approvedAt ||
        !invoice.carrierInvoiceNumber?.trim() ||
        !invoice.disputeReasonCode ||
        invoice.invoicedTotal === null ||
        invoice.varianceTotal === null ||
        invoice.varianceGross === null
      )
        fail(prefix + 'données de rapprochement ou décision historique incomplètes.');
      // Resolution is not stored on Invoice. Never infer acceptance merely from matching totals.
      const decisions = await tx.auditLog.findMany({
        where: {
          tenantId,
          entityType: 'invoice',
          entityId: invoice.id,
          action: 'STATUS_CHANGE',
          OR: ['ACCEPT_INVOICED', 'KEEP_EXPECTED'].map((resolution) => ({
            after: { path: ['resolution'], equals: resolution },
          })),
        },
        orderBy: { id: 'asc' },
        take: 2,
        select: { id: true, userId: true, createdAt: true, before: true, after: true },
      });
      const decision = decisions[0];
      const before = decision?.before as { status?: string } | null;
      const after = decision?.after as {
        status?: string;
        resolution?: string;
        reasonCode?: string;
      } | null;
      if (
        decisions.length !== 1 ||
        !decision.userId ||
        decision.createdAt < invoice.approvedAt ||
        before?.status !== 'DISPUTED' ||
        after?.status !== 'APPROVED' ||
        after?.resolution !== 'ACCEPT_INVOICED' ||
        after?.reasonCode !== invoice.disputeReasonCode ||
        !(await tx.user.findFirst({
          where: { tenantId, id: decision.userId },
          select: { id: true },
        }))
      )
        fail(
          prefix + 'acceptation ACCEPT_INVOICED absente, ambiguë ou incohérente dans l’historique.',
        );
      adjustment = {
        ...reconcileAcceptedCarrierAmounts({
          total: invoice.totalAmount.toString(),
          tax: invoice.taxAmount.toString(),
          invoicedTotal: invoice.invoicedTotal.toString(),
          varianceTotal: invoice.varianceTotal.toString(),
          varianceGross: invoice.varianceGross.toString(),
          lines: invoice.lines.map((line) => {
            if (
              !('invoicedAmount' in line) ||
              line.invoicedAmount === null ||
              line.variance === null
            )
              fail(prefix + 'montants reçus ou écarts de ligne manquants.');
            return {
              amount: line.amount.toString(),
              invoicedAmount: line.invoicedAmount.toString(),
              variance: line.variance.toString(),
            };
          }),
        }),
        resolution: 'ACCEPT_INVOICED',
        acceptedAt: decision.createdAt,
        carrierInvoiceNumber: invoice.carrierInvoiceNumber,
      };
      acceptanceProof = digest(decision);
    }
    reconciled = reconcileInvoiceLedger({
      customer,
      net: adjustment?.net ?? ledgerAmount(net),
      tax: invoice.taxAmount.toString(),
      total: invoice.totalAmount.toString(),
      taxes,
      lines: mapped(original),
    });
    let credited = 0n,
      creditedNet = 0n;
    const creditedTax = new Map<string, bigint>(),
      creditedLines = new Map<string, { net: bigint; quantity: Prisma.Decimal }>();
    for (const note of notes) {
      const linked = entries.filter(
        (e) => e.sourceType === 'customer-credit' && e.sourceId === note.id,
      );
      if (note.status !== 'ISSUED') {
        if (linked.length) throw Error('Un avoir non émis possède une écriture.');
        continue;
      }
      if (
        linked.length !== 1 ||
        linked[0].sourceKind !== 'issued' ||
        note.currency !== invoice.currency ||
        !note.issuedAt
      )
        throw Error('Avoir émis sans écriture, date ou devise cohérente.');
      const child = linked[0];
      if (child.currency !== null && child.currency !== invoice.currency)
        throw Error('Devise de l’avoir différente de la facture.');
      if (child.currency === null) {
        const q = child.currencyQualification;
        if (
          !!parent !== !!q ||
          (q &&
            (q.sourceEntryId !== original.id ||
              q.state !== parent!.state ||
              q.version !== parent!.version ||
              q.currency !== parent!.currency))
        )
          throw Error('Qualification de l’avoir incohérente avec sa facture.');
      } else if (child.currencyQualification)
        throw Error('Une écriture à devise connue porte une annotation inattendue.');
      if (!note.lines.length || note.lines.length > 100 || note._count.lines !== note.lines.length)
        throw Error('Lignes de l’avoir absentes ou de propriété incohérente.');
      let net = 0n,
        tax = 0n,
        gross = 0n;
      const taxDetails: { accountCode: string; amount: string }[] = [];
      for (const line of note.lines) {
        const sourceLine = invoice.lines.find((l) => l.id === line.invoiceLineId);
        if (!sourceLine || line.quantity.lte(0))
          throw Error('Ligne d’avoir sans origine cohérente.');
        const n = ledgerCents(line.netAmount.toString()),
          t = ledgerCents(line.taxAmount.toString()),
          g = ledgerCents(line.totalAmount.toString());
        if (n < 0n || t < 0n || n + t !== g) throw Error('Montants de ligne d’avoir incohérents.');
        taxDetails.push(...frozenInvoiceTaxes(line.taxDetail, line.taxAmount.toString()));
        net += n;
        tax += t;
        gross += g;
        const prior = creditedLines.get(sourceLine.id) ?? {
          net: 0n,
          quantity: new Prisma.Decimal(0),
        };
        prior.net += n;
        prior.quantity = prior.quantity.plus(line.quantity);
        creditedLines.set(sourceLine.id, prior);
        const maxQty =
          'quantity' in sourceLine &&
          sourceLine.quantity instanceof Prisma.Decimal &&
          sourceLine.quantity.gt(0) &&
          sourceLine.quantity.decimalPlaces() <= 4
            ? sourceLine.quantity
            : new Prisma.Decimal(1);
        if (prior.net > ledgerCents(sourceLine.amount.toString()) || prior.quantity.gt(maxQty))
          throw Error('Les avoirs dépassent les lignes de facture.');
      }
      if (
        net !== ledgerCents(note.netAmount.toString()) ||
        tax !== ledgerCents(note.taxAmount.toString()) ||
        gross !== ledgerCents(note.totalAmount.toString())
      )
        throw Error('Totaux d’avoir différents de ses lignes.');
      const result = reconcileCustomerCreditLedger({
        original: reconciled,
        net: ledgerAmount(net),
        tax: ledgerAmount(tax),
        total: ledgerAmount(gross),
        taxes: taxDetails,
        lines: mapped(child),
      });
      credited += gross;
      creditedNet += net;
      for (const t of result.taxes)
        creditedTax.set(
          t.accountCode,
          (creditedTax.get(t.accountCode) ?? 0n) + ledgerCents(t.amount),
        );
    }
    if (
      'creditedAmount' in invoice &&
      (credited !== ledgerCents(invoice.creditedAmount.toString()) ||
        creditedNet > ledgerCents(reconciled.net) ||
        [...creditedTax].some(
          ([code, amount]) =>
            amount >
            ledgerCents(reconciled.taxes.find((t) => t.accountCode === code)?.amount ?? '0'),
        ))
    )
      throw Error('Cumul des avoirs incompatible avec la facture figée.');
  } catch (error) {
    fail('Historique non qualifiable : ' + (error as Error).message);
  }
  const knownCreditCount = entries.filter(
    (e) => e.id !== original.id && e.currency !== null,
  ).length;
  return {
    kind: customer ? ('CUSTOMER_INVOICE' as const) : ('CARRIER_INVOICE' as const),
    id: invoice.id,
    number: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    total: reconciled!.total,
    netAmount: reconciled!.net,
    taxAmount: reconciled!.tax,
    adjustment,
    issuedCreditCount: issued.length,
    knownCreditCount,
    withdrawBlockedReason: knownCreditCount
      ? 'Retrait impossible : un avoir émis à devise connue compense cette facture. Une correction comptable coordonnée est requise.'
      : null,
    updatedAt: invoice.updatedAt,
    approvedAt: invoice.approvedAt,
    entryIds: entries.filter((e) => e.currency === null).map((e) => e.id),
    sourceProof: digest([invoice, notes, acceptanceProof]),
    entries: entries.map((e) => ({
      id: e.id,
      date: e.date,
      currency: e.currency,
      sourceKind: e.sourceKind,
      currencyQualification: e.currencyQualification,
      lines: mapped(e),
    })),
  };
}
