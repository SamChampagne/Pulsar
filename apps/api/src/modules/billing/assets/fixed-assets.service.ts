import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ASSET_PLAN_ALGORITHM,
  FixedAssetStatus,
  FixedAssetOperationKind as Kind,
  buildExactAssetPlan,
  canTransitionFixedAsset,
  ledgerCents,
  type AssetPlan,
  type AuthUser,
} from '@pulsar/shared';
import { Prisma, type FixedAsset, type DepreciationEntry } from '@pulsar/database';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { assertServicePerson, lockBusinessTenant } from '../../business/business-lock';
import { LedgerService } from '../ledger/ledger.service';
import { historicalAssetAnchor } from '../ledger-qualification/asset-qualification';
import {
  ActivateAssetDto,
  CreateFixedAssetDto,
  DepreciateDto,
  RetireAssetDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';

// JSONB does not preserve property order. Hash a canonical structure on every path.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
function publicAsset(a: FixedAsset) {
  const { planSnapshot, ...row } = a;
  return row;
}
const civil = (d: Date) => d.toISOString().slice(0, 10);
type WriteDto =
  | CreateFixedAssetDto
  | UpdateFixedAssetDto
  | ActivateAssetDto
  | DepreciateDto
  | RetireAssetDto;

@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly ledger: LedgerService,
    private readonly ownership: OwnershipService,
  ) {}
  async list(tenantId: string) {
    return this.prisma.fixedAsset.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      omit: { planSnapshot: true },
    });
  }
  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const asset = await tx.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Immobilisation introuvable.');
    return asset;
  }
  async get(tenantId: string, id: string) {
    return publicAsset(await this.find(this.prisma, tenantId, id));
  }
  async accounts(tenantId: string) {
    // Same initial chart as the ledger, without requiring ledger-reading privileges.
    await this.ledger.ensureChart(tenantId);
    return this.prisma.chartOfAccount.findMany({
      where: { tenantId, active: true, type: { in: ['EXPENSE', 'ASSET'] } },
      select: { code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    });
  }
  async history(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.fixedAssetOperation.findMany({
      where: { tenantId, assetId: id },
      orderBy: { version: 'desc' },
      take: 20,
      select: { kind: true, version: true, reason: true, createdAt: true, result: true },
    });
  }
  private plan(asset: FixedAsset): AssetPlan {
    if (!asset.currency || !asset.depreciationStartDate || asset.version === 0)
      throw new ConflictException(
        'Dossier historique non qualifié : lecture seule. Aucune devise ne peut être supposée.',
      );
    if (asset.planSnapshot) {
      const plan = asset.planSnapshot as unknown as AssetPlan;
      if (
        plan.algorithm !== ASSET_PLAN_ALGORITHM ||
        !Array.isArray(plan.rows) ||
        hash(plan) !== asset.planHash
      )
        throw new ConflictException('Intégrité du plan figé à vérifier.');
      return plan; // Never recalculate a frozen plan using a future algorithm.
    }
    if (asset.status === 'ACTIVE') throw new ConflictException('Plan actif manquant.');
    return buildExactAssetPlan({
      currency: asset.currency,
      cost: asset.cost.toFixed(2),
      salvageValue: asset.salvageValue.toFixed(2),
      usefulLifeMonths: asset.usefulLifeMonths,
      acquisitionDate: civil(asset.acquisitionDate),
      depreciationStartMonth: civil(asset.depreciationStartDate).slice(0, 7),
      depreciationExpenseAccountCode: asset.depreciationExpenseAccountCode,
      accumulatedDepreciationAccountCode: asset.accumulatedDepreciationAccountCode,
    });
  }
  private verifyPosted(asset: FixedAsset, plan: AssetPlan, entries: DepreciationEntry[]) {
    if (entries.length > plan.rows.length)
      throw new ConflictException('Historique des dotations incohérent.');
    entries.forEach((entry, i) => {
      const row = plan.rows[i];
      if (
        entry.ordinal !== row.ordinal ||
        civil(entry.period) !== row.period + '-01' ||
        entry.currency !== plan.input.currency ||
        entry.amount.toFixed(2) !== row.amount ||
        (row.amount === '0.00') !== !entry.journalEntryId
      )
        throw new ConflictException('Historique des dotations incohérent.');
    });
    if (
      asset.accumulatedDepreciation.toFixed(2) !==
      (entries.at(-1) ? plan.rows[entries.length - 1].accumulated : '0.00')
    )
      throw new ConflictException('Cumul des dotations incohérent.');
  }
  async schedule(tenantId: string, id: string, canReadLedger = false) {
    return this.prisma.$transaction(
      async (tx) => {
        const asset = await this.find(tx, tenantId, id);
        const depreciations = await tx.depreciationEntry.findMany({
          where: { tenantId, assetId: id },
          orderBy: { period: 'asc' },
        });
        const qualified = Boolean(
          asset.currency && asset.depreciationStartDate && asset.version > 0,
        );
        if (!qualified)
          return {
            asset: publicAsset(asset),
            qualified: false,
            rows: [],
            depreciations,
            next: null,
            reviewToken: null,
            ...(canReadLedger
              ? { historicalAnchorEntryId: await historicalAssetAnchor(tx, tenantId, id) }
              : {}),
          };
        const plan = this.plan(asset);
        this.verifyPosted(asset, plan, depreciations);
        const next = asset.status === 'ACTIVE' ? (plan.rows[depreciations.length] ?? null) : null;
        return {
          asset: publicAsset(asset),
          qualified: true,
          rows: plan.rows,
          depreciations,
          next,
          nextDue: Boolean(next && next.date <= civil(new Date())),
          reviewToken: asset.status === 'DRAFT' ? hash([tenantId, id, asset.version, plan]) : null,
          algorithm: plan.algorithm,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  create(user: AuthUser, dto: CreateFixedAssetDto) {
    return this.write(user, Kind.CREATE, dto);
  }
  update(user: AuthUser, id: string, dto: UpdateFixedAssetDto) {
    return this.write(user, Kind.UPDATE, dto, id);
  }
  activate(user: AuthUser, id: string, dto: ActivateAssetDto) {
    return this.write(user, Kind.ACTIVATE, dto, id);
  }
  depreciate(user: AuthUser, id: string, dto: DepreciateDto) {
    return this.write(user, Kind.DEPRECIATE, dto, id);
  }
  dispose(user: AuthUser, id: string, dto: RetireAssetDto) {
    return this.write(user, Kind.RETIRE, dto, id);
  }
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    throw new ConflictException(
      'Les dossiers sont conservés. Utilisez « Retirer du suivi » avec un motif.',
    );
  }
  private async checkAccounts(tx: Prisma.TransactionClient, tenantId: string, plan: AssetPlan) {
    const codes = [
      plan.input.depreciationExpenseAccountCode,
      plan.input.accumulatedDepreciationAccountCode,
    ];
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM chart_of_accounts WHERE "tenantId"=${tenantId} AND code IN (${Prisma.join(codes)}) FOR SHARE`,
    );
    const rows = await tx.chartOfAccount.findMany({
      where: { tenantId, code: { in: codes }, active: true },
    });
    if (
      !rows.some((a) => a.code === codes[0] && a.type === 'EXPENSE') ||
      !rows.some((a) => a.code === codes[1] && a.type === 'ASSET')
    )
      throw new BadRequestException(
        'Choisissez un compte de charge et un compte de cumul de type Actif, actifs dans cette entreprise.',
      );
  }
  private async change(
    tx: Prisma.TransactionClient,
    before: FixedAsset,
    data: Prisma.FixedAssetUpdateManyMutationInput,
  ) {
    const result = await tx.fixedAsset.updateMany({
      where: {
        tenantId: before.tenantId,
        id: before.id,
        version: before.version,
        status: before.status,
      },
      data,
    });
    if (result.count !== 1)
      throw new ConflictException('Le dossier a changé. Rechargez-le avant de poursuivre.');
  }
  private async write(user: AuthUser, kind: Kind, dto: WriteDto, id?: string) {
    // Every writer holds the same tenant lock; conditional claims remain a second guard.
    const tenantId = user.tenantId,
      fingerprint = hash([tenantId, user.id, kind, id ?? null, dto]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockBusinessTenant(tx, tenantId);
        await assertServicePerson(tx, this.ownership, tenantId, user.id);
        const replay = await tx.fixedAssetOperation.findFirst({
          where: { tenantId, operationKey: dto.operationKey },
        });
        if (replay) {
          if (replay.actorId !== user.id || replay.fingerprint !== fingerprint)
            throw new ConflictException('Clé déjà utilisée pour une autre demande.');
          return replay.result;
        }
        const before = id ? await this.find(tx, tenantId, id) : null;
        if (before) {
          if (!before.currency || !before.depreciationStartDate || before.version === 0)
            throw new ConflictException('Dossier historique non qualifié : lecture seule.');
          if (before.version !== (dto as UpdateFixedAssetDto).expectedVersion)
            throw new ConflictException('Le dossier a changé. Rechargez-le avant de poursuivre.');
        }
        let assetId = id,
          reason: string | null = null;
        const version = (before?.version ?? 0) + 1;
        if (kind === Kind.CREATE || kind === Kind.UPDATE) {
          if (before && before.status !== 'DRAFT')
            throw new ConflictException('Le plan est figé après activation.');
          const d = dto as CreateFixedAssetDto;
          if (!d.name.trim() || !d.assetCode.trim())
            throw new BadRequestException('Code et nom requis.');
          let plan: AssetPlan;
          try {
            plan = buildExactAssetPlan({
              currency: d.currency,
              cost: d.cost,
              salvageValue: d.salvageValue,
              usefulLifeMonths: d.usefulLifeMonths,
              acquisitionDate: d.acquisitionDate,
              depreciationStartMonth: d.depreciationStartMonth,
              depreciationExpenseAccountCode: d.depreciationExpenseAccountCode,
              accumulatedDepreciationAccountCode: d.accumulatedDepreciationAccountCode,
            });
          } catch (e) {
            throw new BadRequestException((e as Error).message);
          }
          await this.checkAccounts(tx, tenantId, plan);
          const data = {
            assetCode: d.assetCode.trim(),
            name: d.name.trim(),
            category: d.category.trim() || null,
            acquisitionReference: d.acquisitionReference.trim() || null,
            currency: d.currency,
            acquisitionDate: new Date(d.acquisitionDate + 'T00:00:00Z'),
            depreciationStartDate: new Date(d.depreciationStartMonth + '-01T00:00:00Z'),
            cost: plan.input.cost,
            salvageValue: plan.input.salvageValue,
            usefulLifeMonths: d.usefulLifeMonths,
            depreciationExpenseAccountCode: d.depreciationExpenseAccountCode,
            accumulatedDepreciationAccountCode: d.accumulatedDepreciationAccountCode,
            version,
          };
          if (before) await this.change(tx, before, data);
          else assetId = (await tx.fixedAsset.create({ data: { ...data, tenantId } })).id;
        } else {
          if (!before || !(dto as ActivateAssetDto).confirmed)
            throw new BadRequestException('Confirmation explicite obligatoire.');
          if (kind === Kind.ACTIVATE) {
            if (
              before.status !== 'DRAFT' ||
              !canTransitionFixedAsset(before.status as FixedAssetStatus, FixedAssetStatus.ACTIVE)
            )
              throw new ConflictException('Seul un brouillon peut être activé.');
            const plan = this.plan(before);
            if (
              (dto as ActivateAssetDto).reviewToken !== hash([tenantId, id, before.version, plan])
            )
              throw new ConflictException('Revoyez le plan à jour avant activation.');
            await this.checkAccounts(tx, tenantId, plan);
            await this.change(tx, before, {
              version,
              status: 'ACTIVE',
              planSnapshot: json(plan),
              planHash: hash(plan),
            });
          } else if (kind === Kind.RETIRE) {
            reason = (dto as RetireAssetDto).reason.trim();
            if (reason.length < 3) throw new BadRequestException('Expliquez le motif du retrait.');
            if (
              !canTransitionFixedAsset(before.status as FixedAssetStatus, FixedAssetStatus.DISPOSED)
            )
              throw new ConflictException('Ce dossier est déjà retiré.');
            await this.change(tx, before, { version, status: 'DISPOSED', disposedAt: new Date() });
          } else {
            if (before.status !== 'ACTIVE')
              throw new ConflictException('Seul un actif activé peut être amorti.');
            const plan = this.plan(before);
            const entries = await tx.depreciationEntry.findMany({
              where: { tenantId, assetId: id },
              orderBy: { period: 'asc' },
            });
            this.verifyPosted(before, plan, entries);
            const row = plan.rows[entries.length];
            if (!row) throw new ConflictException('Toutes les périodes ont été enregistrées.');
            if (row.period !== (dto as DepreciateDto).period)
              throw new ConflictException('Seul le prochain mois du plan peut être enregistré.');
            if (row.date > civil(new Date()))
              throw new ConflictException('La fin du mois doit être atteinte (date civile UTC).');
            await this.checkAccounts(tx, tenantId, plan);
            const entryId = randomUUID();
            let journalEntryId: string | null = null;
            if (ledgerCents(row.amount) > 0n) {
              const posted = await this.ledger.postTx(
                tx,
                tenantId,
                {
                  date: new Date(row.date + 'T00:00:00Z'),
                  currency: plan.input.currency,
                  memo: `Dotation ${before.assetCode} ${row.period}`,
                  sourceType: 'depreciation',
                  sourceId: entryId,
                  lines: [
                    { accountCode: plan.input.depreciationExpenseAccountCode, debit: row.amount },
                    {
                      accountCode: plan.input.accumulatedDepreciationAccountCode,
                      credit: row.amount,
                    },
                  ],
                },
                user.id,
              );
              if (!posted.journalEntryId)
                throw new ConflictException('Écriture comptable manquante.');
              journalEntryId = posted.journalEntryId;
            }
            await tx.depreciationEntry.create({
              data: {
                id: entryId,
                tenantId,
                assetId: id!,
                period: new Date(row.period + '-01T00:00:00Z'),
                ordinal: row.ordinal,
                currency: plan.input.currency,
                amount: row.amount,
                journalEntryId,
              },
            });
            await this.change(tx, before, { version, accumulatedDepreciation: row.accumulated });
          }
        }
        const after = publicAsset(await this.find(tx, tenantId, assetId!)),
          result = json(after);
        await tx.fixedAssetOperation.create({
          data: {
            tenantId,
            assetId: after.id,
            actorId: user.id,
            kind,
            version,
            operationKey: dto.operationKey,
            fingerprint,
            result,
            reason,
          },
        });
        await this.audit.log(
          {
            tenantId,
            userId: user.id,
            entityType: 'fixed-asset',
            entityId: after.id,
            action:
              kind === Kind.CREATE
                ? AuditAction.CREATE
                : kind === Kind.ACTIVATE || kind === Kind.RETIRE
                  ? AuditAction.STATUS_CHANGE
                  : AuditAction.UPDATE,
            before: before ? json(publicAsset(before)) : undefined,
            after: { kind, asset: result, reason },
          },
          tx,
        );
        return result;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException(
          'Ce code, cette période ou cette clé existe déjà. Rechargez le dossier.',
        );
      throw e;
    }
  }
}
