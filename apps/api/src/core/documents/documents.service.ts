import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE, type FileStorage } from './storage/file-storage';

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

  listForEntity(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.document.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upload(tenantId: string, input: UploadDocumentInput) {
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
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    return {
      stream: await this.storage.get(doc.storageKey),
      fileName: doc.fileName,
      mimeType: doc.mimeType,
    };
  }

  async remove(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.storage.delete(doc.storageKey);
    await this.prisma.document.delete({ where: { id } });
    return { deleted: true };
  }
}
