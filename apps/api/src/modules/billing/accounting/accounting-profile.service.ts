import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditAction, type AuthUser, validateAccountingTarget } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { assertServicePerson, lockBusinessTenant } from '../../business/business-lock';
import { AccountingProfileDto } from './accounting-profile.dto';

@Injectable()
export class AccountingProfileService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}
  async get(tenantId: string) {
    const history = await this.db.accountingProfileRevision.findMany({
      where: { tenantId },
      orderBy: { version: 'desc' },
      take: 20,
      select: {
        id: true,
        version: true,
        target: true,
        targetCurrency: true,
        externalSystem: true,
        reason: true,
        createdAt: true,
      },
    });
    return {
      current: history[0] ?? null,
      history,
      historyLimit: 20,
      capabilities: { officialAccounting: false, exchangeConversion: false, externalSync: false },
    };
  }
  async save(user: AuthUser, dto: AccountingProfileDto) {
    try {
      validateAccountingTarget(dto.target, dto.targetCurrency, dto.externalSystem);
      if (dto.reason.trim().length < 3) throw Error('Expliquez le changement.');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          user.id,
          dto.expectedVersion,
          dto.target,
          dto.targetCurrency,
          dto.externalSystem,
          dto.reason,
        ]),
      )
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, user.tenantId);
      await assertServicePerson(tx, this.ownership, user.tenantId, user.id);
      const replay = await tx.accountingProfileRevision.findFirst({
        where: { tenantId: user.tenantId, operationKey: dto.operationKey },
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint || replay.actorId !== user.id)
          throw new ConflictException('Clé déjà utilisée pour une autre demande.');
        return { id: replay.id, version: replay.version, replayed: true };
      }
      const current = await tx.accountingProfileRevision.findFirst({
        where: { tenantId: user.tenantId },
        orderBy: { version: 'desc' },
      });
      if ((current?.version ?? 0) !== dto.expectedVersion)
        throw new ConflictException('Le profil a changé. Rechargez-le.');
      const row = await tx.accountingProfileRevision.create({
        data: {
          tenantId: user.tenantId,
          version: dto.expectedVersion + 1,
          target: dto.target,
          targetCurrency: dto.targetCurrency,
          externalSystem: dto.externalSystem.trim(),
          reason: dto.reason.trim(),
          actorId: user.id,
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      await this.audit.log(
        {
          tenantId: user.tenantId,
          userId: user.id,
          entityType: 'accounting-profile',
          entityId: row.id,
          action: AuditAction.UPDATE,
          before: current ?? undefined,
          after: row,
        },
        tx,
      );
      return { id: row.id, version: row.version, replayed: false };
    });
  }
}
