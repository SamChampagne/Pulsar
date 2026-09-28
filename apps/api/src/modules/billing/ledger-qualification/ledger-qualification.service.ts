import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  LedgerCurrencyState,
  canTransitionLedgerCurrency,
  isHistoricalManualEntry,
  validateLedgerQualification,
  validateLedgerLines,
  ledgerAmount,
  ledgerCents,
  type AuthUser,
} from '@pulsar/shared';
import { createHash } from 'node:crypto';
import {
  assertQualificationSourceRead,
  assessQualificationSource,
  isQualifiableSource,
  lockQualificationSource,
  qualificationAnchor,
} from './source-qualification';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { lockBusinessTenant, assertServicePerson } from '../../business/business-lock';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import {
  LedgerQualificationReviewDto,
  LedgerQualificationConfirmDto,
} from './ledger-qualification.dto';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const currentSelect = {
  state: true,
  currency: true,
  version: true,
  updatedAt: true,
  sourceEntryId: true,
} as const;
const sourceSelect = {
  id: true,
  date: true,
  memo: true,
  currency: true,
  sourceType: true,
  sourceId: true,
  sourceKind: true,
} as const;
function eligibility(e: Parameters<typeof isHistoricalManualEntry>[0] & { id: string }) {
  return isHistoricalManualEntry(e) || isQualifiableSource(e)
    ? null
    : e.currency !== null
      ? 'Cette écriture possède déjà une devise originale.'
      : 'Cette écriture provient d’un workflow métier. Sa reprise doit aussi rapprocher le dossier source; qualification manuelle indisponible.';
}
@Injectable()
export class LedgerQualificationService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}
  async list(u: AuthUser, q: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.JournalEntryWhereInput = {
      tenantId: u.tenantId,
      currency: null,
      ...(q.search ? { memo: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.journalEntry.findMany({
          where,
          skip,
          take,
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          select: { ...sourceSelect, currencyQualification: { select: currentSelect } },
        }),
        this.db.journalEntry.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return paginated(
      items.map((e) => ({ ...e, blockedReason: eligibility(e) })),
      total,
      page,
      pageSize,
    );
  }
  private async entry(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const e = await tx.journalEntry.findFirst({
      where: { tenantId, id },
      select: {
        ...sourceSelect,
        currencyQualification: { select: currentSelect },
        _count: { select: { lines: true } },
        lines: {
          where: { tenantId, account: { tenantId } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            tenantId: true,
            memo: true,
            debit: true,
            credit: true,
            account: { select: { id: true, tenantId: true, code: true, name: true, type: true } },
          },
        },
      },
    });
    if (!e) throw new NotFoundException('Écriture introuvable.');
    // Reject malformed historical ownership instead of exposing partial/foreign lines.
    if (e._count.lines !== e.lines.length)
      throw new ConflictException('Historique incohérent : revue de propriété requise.');
    const { _count: _integrityCount, ...owned } = e;
    return {
      ...owned,
      lines: e.lines.map(({ tenantId: _tenant, ...l }) => ({
        ...l,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        account: {
          id: l.account.id,
          code: l.account.code,
          name: l.account.name,
          type: l.account.type,
        },
      })),
    };
  }
  async get(u: AuthUser, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const e = await this.entry(tx, u.tenantId, id);
        assertQualificationSourceRead(u, e);
        let source: Awaited<ReturnType<typeof assessQualificationSource>> | null = null;
        let blockedReason = eligibility(e);
        if (isQualifiableSource(e)) {
          try {
            source = await assessQualificationSource(tx, u, e);
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            blockedReason = error.message;
          }
        }
        const history = await tx.ledgerCurrencyRevision.findMany({
          where: { tenantId: u.tenantId, entryId: id },
          orderBy: { version: 'desc' },
          take: 30,
          select: {
            version: true,
            createdAt: true,
            snapshot: true,
            actor: { select: { firstName: true, lastName: true } },
          },
        });
        const anchor = await qualificationAnchor(tx, u, e);
        return {
          ...e,
          blockedReason,
          source,
          history,
          anchorEntryId: anchor,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async request(u: AuthUser, key: string) {
    const r = await this.db.ledgerCurrencyRevision.findFirst({
      where: { tenantId: u.tenantId, actorId: u.id, operationKey: key },
      select: { snapshot: true, entry: { select: { sourceType: true } } },
    });
    if (!r) throw new NotFoundException('Aucune confirmation pour cette demande.');
    assertQualificationSourceRead(u, r.entry);
    return { snapshot: r.snapshot, replayed: true };
  }
  private async assess(
    tx: Prisma.TransactionClient,
    u: AuthUser,
    id: string,
    d: LedgerQualificationReviewDto,
  ) {
    try {
      validateLedgerQualification(d);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const entry = await this.entry(tx, u.tenantId, id),
      blocked = eligibility(entry);
    assertQualificationSourceRead(u, entry);
    if (blocked) throw new ConflictException(blocked);
    const source = isQualifiableSource(entry)
      ? await assessQualificationSource(tx, u, entry)
      : null;
    if (
      d.action === 'WITHDRAW' &&
      source &&
      'withdrawBlockedReason' in source &&
      source.withdrawBlockedReason
    )
      throw new ConflictException(source.withdrawBlockedReason);
    if (source?.currency && d.action === 'QUALIFY' && d.currency !== source.currency)
      throw new ConflictException(
        'La devise attestée doit correspondre à la devise du dossier source.',
      );
    const before = entry.currencyQualification;
    if ((before?.version ?? 0) !== d.expectedVersion)
      throw new ConflictException('La qualification a changé. Rechargez et refaites la revue.');
    const state =
      d.action === 'QUALIFY' ? LedgerCurrencyState.QUALIFIED : LedgerCurrencyState.WITHDRAWN;
    if (!canTransitionLedgerCurrency((before?.state as LedgerCurrencyState) ?? null, state))
      throw new ConflictException(
        'Transition interdite. Retirez la qualification actuelle avant d’en confirmer une nouvelle.',
      );
    try {
      validateLedgerLines(
        entry.lines.map((l) => ({
          accountCode: l.account.code,
          debit: ledgerAmount(ledgerCents(l.debit)),
          credit: ledgerAmount(ledgerCents(l.credit)),
        })),
      );
    } catch (e) {
      throw new ConflictException('Historique non qualifiable : ' + (e as Error).message);
    }
    const evidence = await tx.ledgerCurrencyEvidence.findFirst({
      where: {
        tenantId: u.tenantId,
        entryId: id,
        id: d.evidenceId,
        document: { tenantId: u.tenantId, entityType: 'ledger-currency-evidence', entityId: id },
      },
      select: {
        id: true,
        sha256: true,
        caption: true,
        document: { select: { fileName: true, mimeType: true, sizeBytes: true } },
      },
    });
    if (!evidence)
      throw new NotFoundException('Choisissez une preuve appartenant à cette écriture.');
    const snapshot = {
      schemaVersion: 6,
      entry,
      source,
      state,
      currency: state === LedgerCurrencyState.QUALIFIED ? d.currency : null,
      version: d.expectedVersion + 1,
      reason: d.reason,
      evidence,
      impact: {
        previousCurrency: before?.state === 'QUALIFIED' ? before.currency : null,
        nextCurrency: state === LedgerCurrencyState.QUALIFIED ? d.currency : null,
        totalDebit: ledgerAmount(entry.lines.reduce((n, l) => n + ledgerCents(l.debit), 0n)),
        originalUnchanged: true,
        reportBasis: 'CURRENT_CONFIRMED',
        entryCount: source?.entryIds.length ?? 1,
        ...(source?.kind === 'FIXED_ASSET' ? { groupTotal: source.accumulatedAmount } : {}),
      },
    };
    return { snapshot, reviewToken: hash([u.tenantId, u.id, snapshot]) };
  }
  async review(u: AuthUser, id: string, d: LedgerQualificationReviewDto) {
    return this.db.$transaction((tx) => this.assess(tx, u, id, d), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  async confirm(u: AuthUser, id: string, d: LedgerQualificationConfirmDto) {
    const fingerprint = hash([
      'ledger-currency-v1',
      u.id,
      id,
      d.action,
      d.currency,
      d.reason,
      d.expectedVersion,
      d.evidenceId,
      d.reviewToken,
      d.confirmed,
    ]);
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, u.tenantId);
      // Source writers (payment cancellation, credit issuance) lock their source before the GL.
      await lockQualificationSource(tx, u, id);
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        'pulsar:ledger:' + u.tenantId,
      );
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      const prior = await tx.ledgerCurrencyRevision.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.actorId !== u.id || prior.fingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre confirmation.');
        return { snapshot: prior.snapshot, replayed: true };
      }
      const { snapshot, reviewToken } = await this.assess(tx, u, id, d);
      if (reviewToken !== d.reviewToken)
        throw new ConflictException('La revue ne correspond plus aux données. Refaites-la.');
      const data = {
        state: snapshot.state,
        currency: snapshot.currency,
        version: snapshot.version,
        sourceEntryId: snapshot.source ? id : null,
      };
      if (d.expectedVersion === 0)
        await tx.ledgerCurrencyQualification.create({
          data: { tenantId: u.tenantId, entryId: id, ...data },
        });
      else {
        const changed = await tx.ledgerCurrencyQualification.updateMany({
          where: { tenantId: u.tenantId, entryId: id, version: d.expectedVersion },
          data,
        });
        if (changed.count !== 1) throw new ConflictException('Version concurrente.');
      }
      if (snapshot.source?.kind === 'FIXED_ASSET') {
        const children = snapshot.source.entryIds.filter((e) => e !== id);
        if (children.length) {
          await tx.ledgerCurrencyQualification.createMany({
            data: children.map((entryId) => ({ tenantId: u.tenantId, entryId, ...data })),
            skipDuplicates: true,
          });
          await tx.ledgerCurrencyQualification.updateMany({
            where: { tenantId: u.tenantId, entryId: { in: children } },
            data,
          });
        }
      } else if (snapshot.source) {
        for (const entryId of snapshot.source.entryIds.filter((e) => e !== id)) {
          await tx.ledgerCurrencyQualification.upsert({
            where: { tenantId_entryId: { tenantId: u.tenantId, entryId } },
            create: { tenantId: u.tenantId, entryId, ...data },
            update: data,
          });
        }
      }
      const json = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
      await tx.ledgerCurrencyRevision.create({
        data: {
          tenantId: u.tenantId,
          entryId: id,
          actorId: u.id,
          evidenceId: d.evidenceId,
          version: snapshot.version,
          operationKey: d.operationKey,
          fingerprint,
          snapshot: json,
        },
      });
      await this.audit.log(
        {
          tenantId: u.tenantId,
          userId: u.id,
          entityType: 'ledger-currency-qualification',
          entityId: id,
          action: AuditAction.UPDATE,
          before: snapshot.entry.currencyQualification ?? undefined,
          after: {
            ...data,
            evidenceId: d.evidenceId,
            reason: d.reason,
            operationKey: d.operationKey,
            affectedEntryIds: snapshot.source?.entryIds ?? [id],
          },
        },
        tx,
      );
      return { snapshot: json, replayed: false };
    });
  }
}
