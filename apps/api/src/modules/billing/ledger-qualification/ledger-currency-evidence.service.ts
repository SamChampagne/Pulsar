import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { AuditAction, isHistoricalManualEntry, type AuthUser } from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { validateEvidenceFile } from '../../../core/documents/evidence-file';
import { lockBusinessTenant, assertServicePerson } from '../../business/business-lock';
import { LedgerEvidenceDto } from './ledger-qualification.dto';
import {
  assertQualificationSourceRead,
  assessQualificationSource,
  isQualifiableSource,
  lockQualificationSource,
} from './source-qualification';
const TYPE = 'ledger-currency-evidence';
const projection = {
  id: true,
  caption: true,
  sha256: true,
  createdAt: true,
  document: {
    select: {
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  },
} as const;
@Injectable()
export class LedgerCurrencyEvidenceService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
  ) {}
  private async lock(tx: Prisma.TransactionClient, tenantId: string) {
    await lockBusinessTenant(tx, tenantId);
  }
  private async parent(tenantId: string, id: string, tx: Prisma.TransactionClient = this.db) {
    const d = await tx.journalEntry.findFirst({
      where: { tenantId, id },
      select: { id: true, currency: true, sourceType: true, sourceId: true, sourceKind: true },
    });
    if (!d) throw new NotFoundException('Écriture introuvable.');
    return d;
  }
  async list(u: AuthUser, id: string) {
    const tenantId = u.tenantId;
    assertQualificationSourceRead(u, await this.parent(tenantId, id));
    return this.db.ledgerCurrencyEvidence.findMany({
      where: { tenantId, entryId: id },
      select: projection,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async request(u: AuthUser, id: string, key: string) {
    assertQualificationSourceRead(u, await this.parent(u.tenantId, id));
    const d = await this.db.ledgerCurrencyEvidence.findFirst({
      where: {
        tenantId: u.tenantId,
        entryId: id,
        operationKey: key,
        document: { tenantId: u.tenantId, uploadedById: u.id },
      },
      select: { id: true, sha256: true },
    });
    if (!d) throw new NotFoundException('Aucun enregistrement trouvé pour cette demande.');
    return { ...d, replayed: true };
  }
  async download(u: AuthUser, id: string, evidenceId: string) {
    const tenantId = u.tenantId;
    assertQualificationSourceRead(u, await this.parent(tenantId, id));
    const d = await this.db.ledgerCurrencyEvidence.findFirst({
      where: {
        tenantId,
        entryId: id,
        id: evidenceId,
        document: { tenantId, entityType: TYPE, entityId: id },
      },
      select: { documentId: true },
    });
    if (!d) throw new NotFoundException('Pièce justificative introuvable.');
    return this.documents.download(tenantId, d.documentId, TYPE);
  }
  private async discard(tenantId: string, id: string) {
    try {
      if (!(await this.db.ledgerCurrencyEvidence.count({ where: { tenantId, documentId: id } })))
        await this.documents.remove(tenantId, id, TYPE);
    } catch {
      await this.audit.log({
        tenantId,
        entityType: TYPE,
        entityId: id,
        action: AuditAction.UPDATE,
        after: { cleanupRequired: true },
      });
    }
  }
  async upload(u: AuthUser, id: string, d: LedgerEvidenceDto, input?: Express.Multer.File) {
    const file = validateEvidenceFile(input);
    if (d.caption.trim().length < 3)
      throw new BadRequestException('Description explicite requise.');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'ledger-currency-evidence-v1',
          u.id,
          id,
          d.caption,
          file.originalname,
          file.mimetype,
          sha256,
        ]),
      )
      .digest('hex');
    const preflight = async (tx: Prisma.TransactionClient) => {
      await assertServicePerson(tx, this.ownership, u.tenantId, u.id);
      await lockQualificationSource(tx, u, id);
      const parent = await this.parent(u.tenantId, id, tx);
      assertQualificationSourceRead(u, parent);
      const prior = await tx.ledgerCurrencyEvidence.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre pièce.');
        return { prior };
      }
      if (isQualifiableSource(parent)) await assessQualificationSource(tx, u, parent);
      else if (!isHistoricalManualEntry(parent))
        throw new ConflictException(
          'Reprenez ce dossier depuis une écriture originale historique prise en charge.',
        );
      if (
        (await tx.ledgerCurrencyEvidence.count({
          where: { tenantId: u.tenantId, entryId: id },
        })) >= 30
      )
        throw new ConflictException('Maximum de 30 pièces par dossier.');
      return { prior: null };
    };
    const initial = await this.db.$transaction(async (tx) => {
      await this.lock(tx, u.tenantId);
      return preflight(tx);
    });
    if (initial.prior) return { id: initial.prior.id, sha256, replayed: true };
    const doc = await this.documents.upload(
      u.tenantId,
      {
        entityType: TYPE,
        entityId: id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        body: file.buffer,
        uploadedById: u.id,
      },
      TYPE,
    );
    try {
      const result = await this.db.$transaction(async (tx) => {
        await this.lock(tx, u.tenantId);
        const next = await preflight(tx);
        if (next.prior) return { id: next.prior.id, sha256, replayed: true };
        const row = await tx.ledgerCurrencyEvidence.create({
          data: {
            tenantId: u.tenantId,
            entryId: id,
            documentId: doc.id,
            caption: d.caption,
            sha256,
            operationKey: d.operationKey,
            fingerprint,
          },
        });
        await this.audit.log(
          {
            tenantId: u.tenantId,
            userId: u.id,
            entityType: TYPE,
            entityId: row.id,
            action: AuditAction.CREATE,
            after: { entryId: id, sha256 },
          },
          tx,
        );
        return { id: row.id, sha256, replayed: false };
      });
      if (result.replayed) await this.discard(u.tenantId, doc.id);
      return result;
    } catch (error) {
      await this.discard(u.tenantId, doc.id);
      throw error;
    }
  }
}
