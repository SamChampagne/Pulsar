import { Prisma } from '@pulsar/database';
import { type AuthUser } from '@pulsar/shared';
import {
  assertPaymentRead,
  assessPaymentSource,
  isPaymentOriginal,
  lockQualificationPayment,
} from './payment-qualification';
import { assertInvoiceRead, assessInvoiceSource, isInvoiceOriginal } from './invoice-qualification';
import {
  assertAssetRead,
  assessAssetSource,
  isAssetDepreciation,
  assetQualificationAnchor,
} from './asset-qualification';

export function assertQualificationSourceRead(u: AuthUser, e: { sourceType: string | null }) {
  assertPaymentRead(u, e);
  assertInvoiceRead(u, e);
  assertAssetRead(u, e);
}
export const isQualifiableSource = (e: Parameters<typeof isPaymentOriginal>[0]) =>
  isPaymentOriginal(e) || isInvoiceOriginal(e) || isAssetDepreciation(e);
export async function assessQualificationSource(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  e: Parameters<typeof isPaymentOriginal>[0],
) {
  return isPaymentOriginal(e)
    ? assessPaymentSource(tx, u, e)
    : isAssetDepreciation(e)
      ? assessAssetSource(tx, u, e)
      : assessInvoiceSource(tx, u, e);
}
export async function lockQualificationSource(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  id: string,
) {
  await lockQualificationPayment(tx, u, id);
  const e = await tx.journalEntry.findFirst({
    where: { tenantId: u.tenantId, id },
    select: { sourceType: true, sourceId: true },
  });
  if (!e) return;
  assertQualificationSourceRead(u, e);
  if (e.sourceType === 'customer-invoice' && e.sourceId)
    await tx.$queryRaw`SELECT id FROM customer_invoices WHERE "tenantId" = ${u.tenantId} AND id = ${e.sourceId} FOR UPDATE`;
  if (e.sourceType === 'invoice' && e.sourceId)
    await tx.$queryRaw`SELECT id FROM invoices WHERE "tenantId" = ${u.tenantId} AND id = ${e.sourceId} FOR UPDATE`;
  if (e.sourceType === 'depreciation' && e.sourceId)
    await tx.$queryRaw`SELECT a.id FROM fixed_assets a JOIN depreciation_entries d ON d."assetId"=a.id AND d."tenantId"=a."tenantId" WHERE a."tenantId"=${u.tenantId} AND d.id=${e.sourceId} FOR UPDATE OF a`;
}
export async function qualificationAnchor(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  e: Parameters<typeof isPaymentOriginal>[0],
) {
  assertQualificationSourceRead(u, e);
  if (isAssetDepreciation(e)) return assetQualificationAnchor(tx, u, e);
  let sourceId = e.sourceId,
    sourceType = e.sourceType;
  if (e.sourceType === 'customer-credit' && sourceId) {
    const note = await tx.customerCreditNote.findFirst({
      where: { tenantId: u.tenantId, id: sourceId },
      select: { invoiceId: true },
    });
    sourceId = note?.invoiceId ?? null;
    sourceType = 'customer-invoice';
  } else if (!(e.sourceType === 'payment' && e.sourceKind === 'reversal')) return null;
  if (!sourceId) return null;
  const rows = await tx.journalEntry.findMany({
    where: {
      tenantId: u.tenantId,
      sourceType,
      sourceId,
      sourceKind: sourceType === 'payment' ? null : 'approved',
    },
    select: { id: true },
    take: 2,
  });
  return rows.length === 1 ? rows[0].id : null;
}
