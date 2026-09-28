import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { createHash } from 'node:crypto';
import { CURRENCIES, reconcilePaymentLedger, type AuthUser } from '@pulsar/shared';

type Source = {
  id: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  currency: string | null;
};
export const isPaymentOriginal = (e: Source) =>
  e.currency === null && e.sourceType === 'payment' && !!e.sourceId && e.sourceKind === null;
export function assertPaymentRead(u: AuthUser, e: { sourceType: string | null }) {
  if (e.sourceType === 'payment' && !u.permissions.includes('billing.payments.read'))
    throw new ForbiddenException(
      'Le droit de lecture des paiements est requis pour ce dossier et ses preuves.',
    );
}
export async function lockQualificationPayment(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  id: string,
) {
  const e = await tx.journalEntry.findFirst({
    where: { tenantId: u.tenantId, id },
    select: { sourceType: true, sourceId: true },
  });
  if (!e) return;
  assertPaymentRead(u, e);
  if (e.sourceType === 'payment' && e.sourceId)
    await tx.$queryRaw`SELECT id FROM payments WHERE "tenantId" = ${u.tenantId} AND id = ${e.sourceId} FOR UPDATE`;
}

/** No amounts paid, source status or journal is rewritten by this source assessment. */
export async function assessPaymentSource(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  entry: Source,
) {
  assertPaymentRead(u, entry);
  function fail(message: string): never {
    throw new ConflictException(message);
  }
  if (!isPaymentOriginal(entry))
    fail('La contrepassation se qualifie avec le paiement original, jamais séparément.');
  const tenantId = u.tenantId;
  const p = await tx.payment.findFirst({
    where: { tenantId, id: entry.sourceId! },
    select: {
      id: true,
      paymentNumber: true,
      type: true,
      status: true,
      partyType: true,
      partyId: true,
      date: true,
      currency: true,
      totalAmount: true,
      reconciledAt: true,
      updatedAt: true,
      _count: { select: { allocations: true } },
      allocations: {
        where: { tenantId },
        orderBy: { id: 'asc' },
        select: { id: true, targetType: true, targetId: true, amount: true },
      },
    },
  });
  if (!p) fail('Dossier de paiement absent dans cette entreprise.');
  if (!['SUBMITTED', 'CANCELLED'].includes(p.status))
    fail('Seul un paiement comptabilisé ou annulé peut être repris.');
  if (!CURRENCIES.some((c) => c.code === p.currency)) fail('Devise source non prise en charge.');
  if (
    p.reconciledAt ||
    (await tx.bankTransaction.count({ where: { tenantId, matchedPaymentId: p.id } }))
  )
    fail('Retirez le rapprochement bancaire avant de modifier la qualification.');
  if (p._count.allocations !== p.allocations.length)
    fail('Propriété des affectations incohérente.');
  const receive = p.type === 'RECEIVE';
  if (p.partyType !== (receive ? 'CUSTOMER' : 'CARRIER'))
    fail('Sens et tiers du paiement incohérents.');
  const party = receive
    ? await tx.customer.findFirst({ where: { tenantId, id: p.partyId }, select: { id: true } })
    : await tx.carrier.findFirst({ where: { tenantId, id: p.partyId }, select: { id: true } });
  if (!party) fail('Tiers source absent de cette entreprise.');
  const targetIds = [...new Set(p.allocations.map((a) => a.targetId))];
  const invoices = receive
    ? await tx.customerInvoice.findMany({
        where: { tenantId, id: { in: targetIds }, customerId: p.partyId },
        select: { id: true, currency: true, totalAmount: true },
      })
    : await tx.invoice.findMany({
        where: { tenantId, id: { in: targetIds }, carrierId: p.partyId },
        select: { id: true, currency: true, totalAmount: true },
      });
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const targetTotals = new Map<string, Prisma.Decimal>();
  const targetProof: unknown[] = [];
  for (const a of p.allocations) {
    if (a.targetType !== (receive ? 'CUSTOMER_INVOICE' : 'CARRIER_INVOICE'))
      fail('Type d’affectation incohérent.');
    const invoice = invoiceById.get(a.targetId);
    const cumulative = (targetTotals.get(a.targetId) ?? new Prisma.Decimal(0)).plus(a.amount);
    targetTotals.set(a.targetId, cumulative);
    if (!invoice || invoice.currency !== p.currency || invoice.totalAmount.lt(cumulative))
      fail('Une facture affectée ne correspond pas au tiers, au montant ou à la devise source.');
    targetProof.push([a.targetId, invoice.currency, invoice.totalAmount.toString()]);
  }
  const entries = await tx.journalEntry.findMany({
    where: { tenantId, sourceType: 'payment', sourceId: p.id },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      date: true,
      currency: true,
      sourceKind: true,
      currencyQualification: {
        select: { state: true, currency: true, version: true, sourceEntryId: true },
      },
      _count: { select: { lines: true } },
      lines: {
        where: { tenantId, account: { tenantId } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          debit: true,
          credit: true,
          account: { select: { code: true, type: true } },
        },
      },
    },
  });
  const original = entries.filter((e) => e.sourceKind === null),
    reversal = entries.filter((e) => e.sourceKind === 'reversal');
  if (
    original.length !== 1 ||
    original[0].id !== entry.id ||
    entries.length !== (p.status === 'CANCELLED' ? 2 : 1) ||
    reversal.length !== (p.status === 'CANCELLED' ? 1 : 0)
  )
    fail('Écritures source absentes, dupliquées ou incompatibles avec le statut du paiement.');
  if (entries.some((e) => e.currency !== null || e._count.lines !== e.lines.length))
    fail('Devise originale ou propriété des lignes incohérente.');
  if (original[0].date.getTime() !== p.date.getTime() || reversal.some((e) => e.date < p.date))
    fail('Dates source et journal incohérentes.');
  const lines = original[0].lines;
  if (
    lines.length !== 2 ||
    new Set(lines.map((l) => l.account.code)).size !== 2 ||
    lines.some((l) => l.account.type !== (receive || l.credit.gt(0) ? 'ASSET' : 'LIABILITY'))
  )
    fail('Structure de comptes incompatible avec ce paiement.');
  const mapped = (e: (typeof entries)[number]) =>
    e.lines.map((l) => ({
      accountCode: l.account.code,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    }));
  let reconciliation: ReturnType<typeof reconcilePaymentLedger>;
  try {
    reconciliation = reconcilePaymentLedger({
      total: p.totalAmount.toString(),
      allocations: p.allocations.map((a) => a.amount.toString()),
      lines: mapped(original[0]),
      ...(reversal[0] ? { reversal: mapped(reversal[0]) } : {}),
    });
  } catch (e) {
    fail((e as Error).message);
  }
  const parent = original[0].currencyQualification;
  if (parent && parent.sourceEntryId !== entry.id)
    fail('Annotation originale sans provenance de paiement.');
  for (const e of reversal) {
    const child = e.currencyQualification;
    if (
      child &&
      (!parent ||
        child.sourceEntryId !== entry.id ||
        child.state !== parent.state ||
        child.currency !== parent.currency ||
        child.version !== parent.version)
    )
      fail('Qualification de contrepassation incohérente.');
    if (parent?.state === 'QUALIFIED' && !child)
      fail('Qualification de contrepassation manquante.');
  }
  // Invoice identifiers/amounts are not returned: no implicit invoice-read permission.
  return {
    kind: 'PAYMENT' as const,
    id: p.id,
    number: p.paymentNumber,
    status: p.status,
    type: p.type,
    currency: p.currency,
    ...reconciliation!,
    qualificationScope: 'ALLOCATIONS_ONLY' as const,
    updatedAt: p.updatedAt,
    date: p.date,
    entryIds: entries.map((e) => e.id),
    reversalId: reversal[0]?.id ?? null,
    // Allocation revisions are bound to the review without disclosing invoice contents.
    allocationProof: createHash('sha256')
      .update(
        JSON.stringify([
          p.allocations.map((a) => [a.id, a.targetType, a.targetId, a.amount.toString()]),
          targetProof,
        ]),
      )
      .digest('hex'),
    entries: entries.map(({ _count, lines, ...e }) => ({
      ...e,
      lines: mapped({ ...e, _count, lines }),
    })),
  };
}
