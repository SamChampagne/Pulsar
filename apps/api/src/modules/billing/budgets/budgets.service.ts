import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { createHash } from 'node:crypto';
import {
  AuditAction,
  type AuthUser,
  validateBudgetPeriod,
  validateBudgetLines,
  exactBudgetVariance,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { assertServicePerson, lockBusinessTenant } from '../../business/business-lock';
import { readLedger } from '../ledger/ledger-read';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}
  list(tenantId: string) {
    return this.db.budget.findMany({
      where: { tenantId },
      include: { lines: { where: { tenantId }, orderBy: { accountCode: 'asc' } } },
      orderBy: [{ fiscalYear: 'desc' }, { name: 'asc' }],
    });
  }
  async get(tenantId: string, id: string) {
    const row = await this.db.budget.findFirst({
      where: { tenantId, id },
      include: { lines: { where: { tenantId }, orderBy: { accountCode: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Budget introuvable.');
    return row;
  }
  async history(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.db.budgetRevision.findMany({
      where: { tenantId, budgetId: id },
      orderBy: { version: 'desc' },
      take: 20,
      select: { version: true, createdAt: true, snapshot: true },
    });
  }
  create(user: AuthUser, dto: CreateBudgetDto) {
    return this.write(user, dto);
  }
  update(user: AuthUser, id: string, dto: UpdateBudgetDto) {
    return this.write(user, dto, id);
  }
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    throw new ConflictException('Les budgets sont conservés. Archivez le budget par une révision.');
  }
  private async write(user: AuthUser, dto: CreateBudgetDto | UpdateBudgetDto, id?: string) {
    let lines: { accountCode: string; amount: string }[];
    try {
      if (!dto.name.trim()) throw Error('Le nom est requis.');
      lines = validateBudgetLines(dto.lines);
      if (!id) {
        const d = dto as CreateBudgetDto;
        validateBudgetPeriod(d.periodFrom, d.periodTo, d.fiscalYear);
      }
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          user.id,
          id ?? null,
          dto.name,
          dto.isActive,
          dto.lines,
          id
            ? (dto as UpdateBudgetDto).expectedVersion
            : [
                (dto as CreateBudgetDto).fiscalYear,
                (dto as CreateBudgetDto).currency,
                (dto as CreateBudgetDto).periodFrom,
                (dto as CreateBudgetDto).periodTo,
              ],
        ]),
      )
      .digest('hex');
    try {
      return await this.db.$transaction(async (tx) => {
        await lockBusinessTenant(tx, user.tenantId);
        await assertServicePerson(tx, this.ownership, user.tenantId, user.id);
        const replay = await tx.budgetRevision.findFirst({
          where: { tenantId: user.tenantId, operationKey: dto.operationKey },
        });
        if (replay) {
          if (replay.actorId !== user.id || replay.fingerprint !== fingerprint)
            throw new ConflictException('Clé déjà utilisée pour une autre demande.');
          return replay.snapshot;
        }
        const before = id
          ? await tx.budget.findFirst({ where: { id, tenantId: user.tenantId } })
          : null;
        if (id && !before) throw new NotFoundException('Budget introuvable.');
        if (before && (!before.currency || !before.periodFrom || !before.periodTo))
          throw new ConflictException(
            'Budget historique non qualifié : créez un nouveau budget avec devise et période explicites.',
          );
        if (before && before.version !== (dto as UpdateBudgetDto).expectedVersion)
          throw new ConflictException('Le budget a changé. Rechargez-le avant de modifier.');
        const codes = lines.map((l) => l.accountCode);
        // Coordinate with ordinary account updates as well as budget writers.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM chart_of_accounts WHERE "tenantId"=${user.tenantId} AND code IN (${Prisma.join(codes)}) FOR SHARE`,
        );
        const accounts = await tx.chartOfAccount.findMany({
          where: { tenantId: user.tenantId, code: { in: codes }, active: true },
        });
        if (accounts.length !== codes.length)
          throw new BadRequestException('Choisissez des comptes actifs de cette entreprise.');
        const data = {
          name: dto.name.trim(),
          isActive: dto.isActive,
          version: (before?.version ?? 0) + 1,
        };
        let budgetId = id;
        if (before) {
          await tx.budgetLine.deleteMany({ where: { tenantId: user.tenantId, budgetId: id } });
          await tx.budget.updateMany({ where: { tenantId: user.tenantId, id }, data });
          await tx.budgetLine.createMany({
            data: lines.map((l) => ({ ...l, tenantId: user.tenantId, budgetId: id! })),
          });
        } else {
          const d = dto as CreateBudgetDto;
          const row = await tx.budget.create({
            data: {
              ...data,
              tenantId: user.tenantId,
              fiscalYear: d.fiscalYear,
              currency: d.currency,
              periodFrom: new Date(d.periodFrom + 'T00:00:00Z'),
              periodTo: new Date(d.periodTo + 'T00:00:00Z'),
              lines: { create: lines.map((l) => ({ ...l, tenantId: user.tenantId })) },
            },
          });
          budgetId = row.id;
        }
        const row = await tx.budget.findFirstOrThrow({
          where: { tenantId: user.tenantId, id: budgetId },
          include: {
            lines: { where: { tenantId: user.tenantId }, orderBy: { accountCode: 'asc' } },
          },
        });
        const snapshot = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
        await tx.budgetRevision.create({
          data: {
            tenantId: user.tenantId,
            budgetId: row.id,
            version: row.version,
            actorId: user.id,
            operationKey: dto.operationKey,
            fingerprint,
            snapshot,
          },
        });
        await this.audit.log(
          {
            tenantId: user.tenantId,
            userId: user.id,
            entityType: 'budget',
            entityId: row.id,
            action: before ? AuditAction.UPDATE : AuditAction.CREATE,
            before: before ?? undefined,
            after: snapshot,
          },
          tx,
        );
        return snapshot;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Un budget de ce nom existe déjà pour cet exercice.');
      throw e;
    }
  }
  async variance(tenantId: string, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const budget = await tx.budget.findFirst({
          where: { tenantId, id },
          include: { lines: { where: { tenantId }, orderBy: { accountCode: 'asc' } } },
        });
        if (!budget) throw new NotFoundException('Budget introuvable.');
        if (!budget.currency || !budget.periodFrom || !budget.periodTo)
          throw new ConflictException(
            'Budget historique non qualifié : créez un nouveau budget avec devise et période explicites.',
          );
        const codes = budget.lines.map((l) => l.accountCode);
        const ledger = await readLedger(
          tx,
          tenantId,
          budget.currency,
          budget.periodFrom,
          budget.periodTo,
          codes,
        );
        const accounts = await tx.chartOfAccount.findMany({
          where: { tenantId, code: { in: codes } },
        });
        if (accounts.length !== codes.length)
          throw new ConflictException('Un compte budgétaire est introuvable.');
        const result = exactBudgetVariance(
          budget.lines.map((l) => ({ accountCode: l.accountCode, amount: l.amount.toString() })),
          accounts.map(
            (a) =>
              ledger.rows.find((r) => r.accountId === a.id) ?? {
                accountId: a.id,
                code: a.code,
                name: a.name,
                type: a.type,
                debit: '0.00',
                credit: '0.00',
              },
          ),
        );
        return {
          ...result,
          budgetId: id,
          budgetVersion: budget.version,
          currency: budget.currency,
          periodFrom: budget.periodFrom.toISOString().slice(0, 10),
          periodTo: budget.periodTo.toISOString().slice(0, 10),
          coverage: ledger.coverage,
          coverageScope: 'BUDGET_ACCOUNTS',
          basis: ledger.basis,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
