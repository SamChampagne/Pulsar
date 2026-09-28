import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { reconcileAssetHistory, type AuthUser } from '@pulsar/shared';
import { createHash } from 'node:crypto';

type Source = {
  id: string;
  currency: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceKind: string | null;
};
export const isAssetDepreciation = (e: Source) =>
  e.currency === null && e.sourceType === 'depreciation' && !!e.sourceId && e.sourceKind === null;
export function assertAssetRead(u: AuthUser, e: { sourceType: string | null }) {
  if (e.sourceType === 'depreciation' && !u.permissions.includes('billing.assets.read'))
    throw new ForbiddenException(
      'Le droit de lecture des immobilisations est requis pour ce dossier et ses preuves.',
    );
}
function fail(message: string): never {
  throw new ConflictException(message);
}

export async function historicalAssetAnchor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  assetId: string,
) {
  const first = await tx.depreciationEntry.findFirst({
    where: { tenantId, assetId, asset: { tenantId, currency: null, version: 0 } },
    orderBy: [{ period: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!first) return null;
  const entries = await tx.journalEntry.findMany({
    where: {
      tenantId,
      sourceType: 'depreciation',
      sourceId: first.id,
      sourceKind: null,
      currency: null,
    },
    take: 2,
    select: { id: true },
  });
  return entries.length === 1 ? entries[0].id : null;
}
export async function assetQualificationAnchor(
  tx: Prisma.TransactionClient,
  u: AuthUser,
  e: Source,
) {
  assertAssetRead(u, e);
  const d = await tx.depreciationEntry.findFirst({
    where: { tenantId: u.tenantId, id: e.sourceId!, asset: { tenantId: u.tenantId } },
    select: { assetId: true },
  });
  if (!d) return null;
  const anchor = await historicalAssetAnchor(tx, u.tenantId, d.assetId);
  return anchor === e.id ? null : anchor;
}

export async function assessAssetSource(tx: Prisma.TransactionClient, u: AuthUser, entry: Source) {
  assertAssetRead(u, entry);
  if (!isAssetDepreciation(entry)) fail('Source de dotation historique invalide.');
  const tenantId = u.tenantId;
  const d = await tx.depreciationEntry.findFirst({
    where: { tenantId, id: entry.sourceId!, asset: { tenantId } },
    select: { assetId: true },
  });
  if (!d) fail('Dotation ou immobilisation absente de cette entreprise.');
  const asset = await tx.fixedAsset.findFirst({
    where: { tenantId, id: d.assetId },
    include: { _count: { select: { depreciations: true } } },
  });
  if (
    !asset ||
    asset.currency !== null ||
    asset.version !== 0 ||
    asset.planSnapshot !== null ||
    asset.planHash !== null ||
    asset.depreciationStartDate !== null ||
    !['ACTIVE', 'DISPOSED'].includes(asset.status)
  )
    fail('Seule une immobilisation historique sans plan qualifié peut suivre cette reprise.');
  const depreciations = await tx.depreciationEntry.findMany({
    where: { tenantId, assetId: asset.id },
    orderBy: [{ period: 'asc' }, { id: 'asc' }],
    take: 1201,
  });
  if (
    !depreciations.length ||
    depreciations.length > 1200 ||
    depreciations.length !== asset._count.depreciations ||
    depreciations.some(
      (p) =>
        p.currency !== null ||
        p.ordinal !== null ||
        p.journalEntryId !== null ||
        p.period.toISOString() !== p.period.toISOString().slice(0, 7) + '-01T00:00:00.000Z',
    )
  )
    fail('Dotations historiques absentes, mixtes, trop nombreuses ou de propriété incohérente.');
  const entries = await tx.journalEntry.findMany({
    where: {
      tenantId,
      sourceType: 'depreciation',
      sourceId: { in: depreciations.map((p) => p.id) },
    },
    orderBy: { id: 'asc' },
    take: 1201,
    select: {
      id: true,
      sourceId: true,
      sourceKind: true,
      date: true,
      currency: true,
      currencyQualification: {
        select: { state: true, currency: true, version: true, sourceEntryId: true },
      },
      _count: { select: { lines: true } },
      lines: {
        where: { tenantId, account: { tenantId } },
        orderBy: { id: 'asc' },
        take: 3,
        select: { debit: true, credit: true, account: { select: { code: true, type: true } } },
      },
    },
  });
  if (
    entries.length !== depreciations.length ||
    entries.some(
      (e) =>
        e.currency !== null ||
        e.sourceKind !== null ||
        e._count.lines !== 2 ||
        e.lines.length !== 2,
    )
  )
    fail('Journaux de dotations absents, mixtes, dupliqués ou de structure incohérente.');
  const rows = depreciations.map((p) => {
    const matches = entries.filter((e) => e.sourceId === p.id);
    if (matches.length !== 1 || matches[0].date.getTime() !== p.period.getTime())
      fail('Chaque dotation doit correspondre à une seule écriture à sa date historique.');
    return {
      period: p.period.toISOString().slice(0, 7),
      amount: p.amount.toString(),
      entry: matches[0],
      lines: matches[0].lines.map((l) => ({
        accountCode: l.account.code,
        accountType: l.account.type,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
      })),
    };
  });
  const anchor = rows[0].entry,
    parent = anchor.currencyQualification;
  if (anchor.id !== entry.id)
    fail('Les dotations se qualifient ensemble depuis la première écriture de l’immobilisation.');
  for (const e of entries) {
    const q = e.currencyQualification;
    if (
      !!q !== !!parent ||
      (q &&
        (q.sourceEntryId !== anchor.id ||
          q.state !== parent!.state ||
          q.version !== parent!.version ||
          q.currency !== parent!.currency))
    )
      fail('Qualifications des dotations incohérentes : aucune reprise partielle du groupe.');
  }
  let amounts: ReturnType<typeof reconcileAssetHistory>;
  try {
    amounts = reconcileAssetHistory({
      cost: asset.cost.toString(),
      salvage: asset.salvageValue.toString(),
      accumulated: asset.accumulatedDepreciation.toString(),
      acquisitionDate: asset.acquisitionDate.toISOString().slice(0, 10),
      throughMonth: new Date().toISOString().slice(0, 7),
      periods: rows,
    });
  } catch (e) {
    fail('Historique non qualifiable : ' + (e as Error).message);
  }
  return {
    kind: 'FIXED_ASSET' as const,
    id: asset.id,
    number: asset.assetCode,
    name: asset.name,
    status: asset.status,
    currency: null,
    total: amounts!.accumulatedAmount,
    ...amounts!,
    scope: 'RECORDED_DEPRECIATIONS_ONLY' as const,
    futurePlanBlocked: true,
    entryIds: rows.map((r) => r.entry.id),
    periods: rows.map((r) => ({
      period: r.period,
      amount: r.amount,
      entryId: r.entry.id,
      lines: r.lines,
    })),
    sourceProof: createHash('sha256')
      .update(JSON.stringify([asset, depreciations, entries]))
      .digest('hex'),
  };
}
