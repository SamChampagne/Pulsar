import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE, type FileStorage } from './storage/file-storage';
import { assertGenericDocumentType, PROTECTED_DOCUMENT_TYPES } from './protected-documents';
import type { ProtectedDocumentContext } from './protected-documents';

export interface UploadDocumentInput {
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  body: Buffer;
  uploadedById?: string;
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async assertGenericAccess(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { tenantId, id },
      select: { entityType: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    assertGenericDocumentType(doc.entityType);
  }

  /** Restricted center/query view: reserved business proofs never leak through generic browsing. */
  listGeneric(tenantId: string, entityType: string, entityId: string) {
    assertGenericDocumentType(entityType);
    return this.prisma.document.findMany({
      where: {
        tenantId,
        entityType,
        entityId,
        AND: { entityType: { notIn: PROTECTED_DOCUMENT_TYPES } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForEntity(tenantId: string, entityType: string, entityId: string) {
    assertGenericDocumentType(entityType);
    return this.prisma.document.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upload(
    tenantId: string,
    input: UploadDocumentInput,
    protectedContext?: ProtectedDocumentContext,
  ) {
    if (input.entityType !== protectedContext) assertGenericDocumentType(input.entityType);
    if (input.body.length > MAX_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 10 MB limit');
    }
    const safeName = input.fileName.replace(/[^\w.\-]+/g, '_').slice(-120);
    const storageKey = `${tenantId}/${input.entityType}/${input.entityId}/${randomBytes(8).toString('hex')}-${safeName}`;
    await this.storage.put(storageKey, input.body, input.mimeType);
    return this.prisma.document.create({
      data: {
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.body.length,
        storageKey,
        uploadedById: input.uploadedById,
      },
    });
  }

  async download(
    tenantId: string,
    id: string,
    protectedContext?: ProtectedDocumentContext,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.entityType !== protectedContext) assertGenericDocumentType(doc.entityType);
    return {
      stream: await this.storage.get(doc.storageKey),
      fileName: doc.fileName,
      mimeType: doc.mimeType,
    };
  }

  /** Pre-signed (or API-relative) download URL. */
  async downloadUrl(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    assertGenericDocumentType(doc.entityType);
    const expiresIn = 300;
    const presigned = await this.storage.getDownloadUrl(doc.storageKey, expiresIn);
    return presigned
      ? { url: presigned, presigned: true, expiresIn }
      : { url: `/api/v1/documents/${id}/download`, presigned: false };
  }

  /**
   * Direct-to-storage upload (S3 driver only): returns a pre-signed PUT URL;
   * the client uploads then calls confirmUpload to register the document.
   */
  async presignUpload(
    tenantId: string,
    input: { entityType: string; entityId: string; fileName: string; mimeType: string },
  ) {
    assertGenericDocumentType(input.entityType);
    const safeName = input.fileName.replace(/[^\w.\-]+/g, '_').slice(-120);
    const storageKey = `${tenantId}/${input.entityType}/${input.entityId}/${randomBytes(8).toString('hex')}-${safeName}`;
    const expiresIn = 600;
    const uploadUrl = await this.storage.getUploadUrl(storageKey, input.mimeType, expiresIn);
    if (!uploadUrl) {
      throw new BadRequestException(
        'Pre-signed uploads require the s3 storage driver — use POST /documents/upload instead',
      );
    }
    return { uploadUrl, storageKey, expiresIn };
  }

  async confirmUpload(
    tenantId: string,
    input: {
      storageKey: string;
      entityType: string;
      entityId: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedById?: string;
    },
  ) {
    assertGenericDocumentType(input.entityType);
    // The key was issued by presignUpload for this tenant — never accept foreign prefixes.
    if (
      !input.storageKey.startsWith(`${tenantId}/${input.entityType}/${input.entityId}/`) ||
      input.storageKey.includes('\\') ||
      input.storageKey.split('/').some((part) => part === '.' || part === '..') ||
      PROTECTED_DOCUMENT_TYPES.some((type) => input.storageKey.startsWith(`${tenantId}/${type}/`))
    ) {
      throw new BadRequestException('Invalid storage key');
    }
    return this.prisma.document.create({
      data: {
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        uploadedById: input.uploadedById,
      },
    });
  }

  async remove(tenantId: string, id: string, protectedContext?: ProtectedDocumentContext) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.entityType !== protectedContext) assertGenericDocumentType(doc.entityType);
    if (['customer-credit-pdf', 'customer-invoice-pdf'].includes(doc.entityType))
      throw new BadRequestException(
        'Les PDF financiers sont conservés, y compris après un échec de publication.',
      );
    if (
      doc.entityType === 'wms-stock-exit-evidence' &&
      (await this.prisma.wmsStockExitEvidence.count({ where: { tenantId, documentId: id } }))
    )
      throw new BadRequestException('Une pièce liée est conservée dans l’historique de sortie.');
    if (
      doc.entityType === 'quality-evidence' &&
      (await this.prisma.qualityEvidence.count({ where: { tenantId, documentId: id } }))
    )
      throw new BadRequestException('Une preuve liée est conservée dans l’historique.');
    if (doc.entityType === 'supplier-invoice-evidence' &&
      await this.prisma.supplierInvoiceEvidence.count({ where: { tenantId, documentId: id } }))
      throw new BadRequestException('Une pièce liée est conservée dans la facture fournisseur.');
    if (doc.entityType === 'supplier-credit-evidence' &&
      await this.prisma.supplierCreditEvidence.count({ where: { tenantId, documentId: id } }))
      throw new BadRequestException('Une pièce liée est conservée dans l’avoir fournisseur.');
    if (doc.entityType === 'ledger-currency-evidence' &&
      await this.prisma.ledgerCurrencyEvidence.count({ where: { tenantId, documentId: id } }))
      throw new BadRequestException('Une preuve liée est conservée dans le journal historique.');
    await this.storage.delete(doc.storageKey);
    await this.prisma.document.delete({ where: { id } });
    return { deleted: true };
  }
}
