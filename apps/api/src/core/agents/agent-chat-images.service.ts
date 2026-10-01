import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';

export const CHAT_IMAGE_TYPE = 'agent-chat-image';
export const CHAT_IMAGE_BYTES = 512 * 1024;

/** Header/dimension validation, not antivirus. No URLs, SVG or filesystem input. */
export function validateChatImages(files: Express.Multer.File[]) {
  if (files.length > 4) throw new BadRequestException('Maximum 4 images par message.');
  for (const file of files) {
    const b = file.buffer;
    let width = 0,
      height = 0;
    if (!b?.length || b.length > CHAT_IMAGE_BYTES)
      throw new BadRequestException('Chaque image doit faire au maximum 512 Ko.');
    if (
      file.mimetype === 'image/png' &&
      b.length >= 45 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.readUInt32BE(8) === 13 &&
      b.toString('ascii', 12, 16) === 'IHDR' &&
      b.toString('ascii', b.length - 8, b.length - 4) === 'IEND'
    ) {
      width = b.readUInt32BE(16);
      height = b.readUInt32BE(20);
    } else if (
      file.mimetype === 'image/jpeg' &&
      b[0] === 255 &&
      b[1] === 216 &&
      b[b.length - 2] === 255 &&
      b[b.length - 1] === 217
    ) {
      let at = 2;
      while (at + 4 < b.length) {
        if (b[at++] !== 255) break;
        while (b[at] === 255) at++;
        const marker = b[at++];
        if (marker === 218 || marker === 217 || at + 2 > b.length) break;
        const length = b.readUInt16BE(at);
        if (length < 2 || at + length > b.length) break;
        if ([192, 193, 194].includes(marker) && length >= 8) {
          height = b.readUInt16BE(at + 3);
          width = b.readUInt16BE(at + 5);
          break;
        }
        at += length;
      }
    }
    if (!width || !height || width > 2048 || height > 2048)
      throw new BadRequestException('Image PNG/JPEG valide requise, maximum 2048 × 2048 pixels.');
  }
  return files.map((f) => ({
    type: 'image' as const,
    mimeType: f.mimetype,
    data: f.buffer.toString('base64'),
  }));
}

@Injectable()
export class AgentChatImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async save(tenantId: string, userId: string, messageId: string, files: Express.Multer.File[]) {
    // Check the source as well as the caller; no arbitrary document entityId.
    const message = await this.prisma.agentMessage.findFirst({
      where: { id: messageId, role: 'user', conversation: { tenantId, userId } },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message introuvable.');
    const saved: string[] = [];
    try {
      for (const file of files) {
        const doc = await this.documents.upload(
          tenantId,
          {
            entityType: CHAT_IMAGE_TYPE,
            entityId: messageId,
            fileName:
              file.originalname.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 100) || 'image',
            mimeType: file.mimetype,
            body: file.buffer,
            uploadedById: userId,
          },
          CHAT_IMAGE_TYPE,
        );
        saved.push(doc.id);
      }
    } catch (error) {
      // No model call on partial upload. Keep an explicit historical marker.
      await Promise.allSettled(
        saved.map((id) => this.documents.remove(tenantId, id, CHAT_IMAGE_TYPE)),
      );
      await this.prisma.agentMessage.updateMany({
        where: { id: messageId, conversation: { tenantId, userId } },
        data: { content: '[Message non transmis : échec de sauvegarde des images]' },
      });
      throw error;
    }
  }

  metadata(tenantId: string, messageIds: string[]) {
    if (!messageIds.length) return Promise.resolve([]);
    return this.prisma.document.findMany({
      where: { tenantId, entityType: CHAT_IMAGE_TYPE, entityId: { in: messageIds } },
      select: { id: true, entityId: true, fileName: true, mimeType: true, sizeBytes: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async download(tenantId: string, userId: string, conversationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId, entityType: CHAT_IMAGE_TYPE },
      select: { entityId: true },
    });
    const message =
      doc &&
      (await this.prisma.agentMessage.findFirst({
        where: { id: doc.entityId, conversationId, conversation: { tenantId, userId } },
        select: { id: true },
      }));
    if (!message) throw new NotFoundException('Image introuvable.');
    return this.documents.download(tenantId, id, CHAT_IMAGE_TYPE);
  }
}
