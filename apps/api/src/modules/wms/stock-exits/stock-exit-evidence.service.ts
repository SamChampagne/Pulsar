import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { AuditAction, type AuthUser } from '@pulsar/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { validateEvidenceFile } from '../../../core/documents/evidence-file';
import { lockBusinessTenant, assertServicePerson } from '../../business/business-lock';
import { StockExitEvidenceDto } from './stock-exits.dto';
const TYPE = 'wms-stock-exit-evidence';
const projection = {
  id: true,
  caption: true,
  sha256: true,
  recordedStatus: true,
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
export class StockExitEvidenceService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
  ) {}
  private async lock(tx: Prisma.TransactionClient, tenantId: string) {
    await lockBusinessTenant(tx, tenantId);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  }
  private async parent(tenantId: string, id: string, tx: Prisma.TransactionClient = this.db) {
    const d = await tx.wmsStockExit.findFirst({
      where: { tenantId, id },
      select: { status: true },
    });
    if (!d) throw new NotFoundException('Dossier de sortie introuvable.');
    return d;
  }
  async list(tenantId: string, id: string) {
    await this.parent(tenantId, id);
    return this.db.wmsStockExitEvidence.findMany({
      where: { tenantId, stockExitId: id },
      select: projection,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async request(u: AuthUser, id: string, key: string) {
    await this.parent(u.tenantId, id);
    const d = await this.db.wmsStockExitEvidence.findFirst({
      where: {
        tenantId: u.tenantId,
        stockExitId: id,
        operationKey: key,
        document: { tenantId: u.tenantId, uploadedById: u.id },
      },
      select: { id: true, sha256: true },
    });
    if (!d) throw new NotFoundException('Aucun enregistrement trouvé pour cette demande.');
    return { ...d, replayed: true };
  }
  async download(tenantId: string, id: string, evidenceId: string) {
    const d = await this.db.wmsStockExitEvidence.findFirst({
      where: {
        tenantId,
        stockExitId: id,
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
      if (!(await this.db.wmsStockExitEvidence.count({ where: { tenantId, documentId: id } })))
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
  async upload(u: AuthUser, id: string, d: StockExitEvidenceDto, input?: Express.Multer.File) {
    const file = validateEvidenceFile(input);
    if (d.caption.trim().length < 3)
      throw new BadRequestException('Description explicite requise.');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'stock-exit-evidence-v1',
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
      const prior = await tx.wmsStockExitEvidence.findFirst({
        where: { tenantId: u.tenantId, operationKey: d.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException('Clé déjà utilisée pour une autre pièce.');
        return { prior, status: prior.recordedStatus };
      }
      const parent = await this.parent(u.tenantId, id, tx);
      if (parent.status === 'CANCELLED')
        throw new ConflictException('Un dossier annulé ne reçoit plus de pièces.');
      if (
        (await tx.wmsStockExitEvidence.count({
          where: { tenantId: u.tenantId, stockExitId: id },
        })) >= 30
      )
        throw new ConflictException('Maximum de 30 pièces par dossier.');
      return { prior: null, status: parent.status };
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
        const row = await tx.wmsStockExitEvidence.create({
          data: {
            tenantId: u.tenantId,
            stockExitId: id,
            documentId: doc.id,
            caption: d.caption,
            sha256,
            recordedStatus: next.status,
            operationKey: d.operationKey,
            fingerprint,
          },
        });
        return { id: row.id, sha256, replayed: false };
      });
      if (result.replayed) await this.discard(u.tenantId, doc.id);
      else
        await this.audit.log({
          tenantId: u.tenantId,
          userId: u.id,
          entityType: TYPE,
          entityId: result.id,
          action: AuditAction.CREATE,
          after: { stockExitId: id, sha256 },
        });
      return result;
    } catch (error) {
      await this.discard(u.tenantId, doc.id);
      throw error;
    }
  }
}
