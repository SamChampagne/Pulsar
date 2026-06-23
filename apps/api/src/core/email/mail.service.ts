import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { EmailConfigService } from './email-config.service';
import { EmailService } from './email.service';

const MAX_ATTEMPTS = 5;
/** Exponential backoff in minutes: 1m, 5m, 30m, 2h, 6h */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

export interface QueueEmailInput {
  toAddresses: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  relatedType?: string;
  relatedId?: string;
  templateKey?: string;
  /** Author: exactly one of createdByUserId or agentId */
  createdByUserId?: string;
  agentId?: string;
  attachments?: { documentId: string; filename: string }[];
}

/**
 * Durable email outbox: queue() persists a message, then tries to deliver
 * immediately. Failed messages are retried by a 1-minute cron with exponential
 * backoff until SENT or the attempt budget is exhausted (FAILED).
 *
 * Mirrors the webhooks.service.ts worker pattern.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly emailConfigService: EmailConfigService,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Persist an EmailMessage + EmailAttachment rows in one transaction,
   * then fire-and-forget deliver(). Returns the persisted message.
   */
  async queue(tenantId: string, input: QueueEmailInput) {
    const { attachments = [], ...rest } = input;

    // Validate each documentId is tenant-owned before persisting.
    for (const att of attachments) {
      const doc = await this.prisma.document.findFirst({
        where: { id: att.documentId, tenantId },
        select: { id: true },
      });
      if (!doc) {
        throw new Error(`Document ${att.documentId} not found or not owned by tenant`);
      }
    }

    const msg = await this.prisma.$transaction(async (tx) => {
      const created = await tx.emailMessage.create({
        data: {
          tenantId,
          toAddresses: rest.toAddresses,
          cc: rest.cc ?? [],
          subject: rest.subject,
          html: rest.html,
          text: rest.text,
          relatedType: rest.relatedType,
          relatedId: rest.relatedId,
          templateKey: rest.templateKey,
          createdByUserId: rest.createdByUserId,
          agentId: rest.agentId,
        },
      });

      if (attachments.length > 0) {
        await tx.emailAttachment.createMany({
          data: attachments.map((att) => ({
            tenantId,
            emailMessageId: created.id,
            documentId: att.documentId,
            filename: att.filename,
          })),
        });
      }

      return created;
    });

    // Fire-and-forget — best-effort, never throws out of queue().
    void this.deliver(msg.id).catch(() => undefined);

    return msg;
  }

  /**
   * Attempt delivery of a single message. Claim-safe: uses updateMany to
   * claim QUEUED|FAILED → SENDING before work begins. Never throws.
   */
  async deliver(messageId: string): Promise<void> {
    try {
      const msg = await this.prisma.emailMessage.findUnique({
        where: { id: messageId },
        include: { attachments: true },
      });
      if (!msg) return;
      if (msg.status !== 'QUEUED' && msg.status !== 'FAILED') return;

      // Claim atomically — skip if already claimed by another runner.
      const claimed = await this.prisma.emailMessage.updateMany({
        where: { id: messageId, status: { in: ['QUEUED', 'FAILED'] } },
        data: { status: 'SENDING' },
      });
      if (claimed.count === 0) return;

      // Resolve tenant SMTP transport (may be null → env/log fallback).
      const transport = await this.emailConfigService.resolve(msg.tenantId);

      // Fetch attachment bytes from DocumentsService.
      const attachments: { filename: string; content: Buffer }[] = [];
      for (const att of msg.attachments) {
        try {
          const { stream } = await this.documentsService.download(msg.tenantId, att.documentId);
          const content = await streamToBuffer(stream);
          attachments.push({ filename: att.filename, content });
        } catch (err) {
          this.logger.warn(
            `MailService: could not fetch attachment ${att.documentId} for message ${messageId}: ${String(err)}`,
          );
          // Continue without this attachment — best-effort.
        }
      }

      const ok = await this.emailService.send(
        {
          to: msg.toAddresses.join(', '),
          cc: msg.cc.length > 0 ? msg.cc : undefined,
          subject: msg.subject,
          html: msg.html,
          text: msg.text ?? undefined,
          from: transport?.from,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        transport ?? undefined,
      );

      if (ok) {
        await this.prisma.emailMessage.update({
          where: { id: messageId },
          data: { status: 'SENT', sentAt: new Date(), lastError: null },
        });
      } else {
        throw new Error('EmailService.send returned false');
      }
    } catch (err) {
      // Re-fetch to get current attempts count after the claim update.
      const current = await this.prisma.emailMessage
        .findUnique({ where: { id: messageId }, select: { attempts: true } })
        .catch(() => null);

      const attempts = (current?.attempts ?? 0) + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;

      if (exhausted) {
        this.logger.warn(
          `MailService: message ${messageId} failed permanently after ${attempts} attempts: ${String(err)}`,
        );
      }

      await this.prisma.emailMessage
        .update({
          where: { id: messageId },
          data: {
            status: 'FAILED',
            attempts,
            lastError: String(err).slice(0, 500),
            nextAttemptAt: exhausted
              ? null
              : new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 360) * 60_000),
          },
        })
        .catch((updateErr) =>
          this.logger.error(`MailService: failed to update message ${messageId}: ${String(updateErr)}`),
        );
    }
  }

  /**
   * Cron: retry FAILED messages whose nextAttemptAt is due, plus any
   * stuck QUEUED messages. Best-effort, never throws.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processQueue(): Promise<void> {
    try {
      const now = new Date();
      const due = await this.prisma.emailMessage.findMany({
        where: {
          OR: [
            { status: 'FAILED', nextAttemptAt: { lte: now } },
            { status: 'QUEUED', createdAt: { lte: new Date(now.getTime() - 60_000) } },
          ],
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: 50,
        select: { id: true },
      });

      for (const msg of due) {
        await this.deliver(msg.id);
      }
    } catch (err) {
      this.logger.error(`MailService.processQueue error: ${String(err)}`);
    }
  }
}

/** Read a Readable stream into a Buffer. */
function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
