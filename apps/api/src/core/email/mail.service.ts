import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { EmailConfigService } from './email-config.service';
import { EmailService } from './email.service';
import { Prisma } from '@pulsar/database';

const MAX_ATTEMPTS = 5;
/** Exponential backoff in minutes: 1m, 5m, 30m, 2h, 6h */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

export interface QueueEmailInput {
  /** Internal frozen delivery mode, only for the guarded credit-note workflow. */
  deliveryChannel?: 'log' | 'smtp';
  /** Internal idempotency key, never accepted from the public email DTO. */
  dedupKey?: string;
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
  /** Thread chaining (optional — existing callers unaffected) */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
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
  private readonly deliveryGuards = new Map<
    string,
    (tenantId: string, relatedId: string) => Promise<'ALLOW' | 'HOLD' | 'CANCEL'>
  >();

  registerDeliveryGuard(
    type: string,
    guard: (tenantId: string, relatedId: string) => Promise<'ALLOW' | 'HOLD' | 'CANCEL'>,
  ) {
    this.deliveryGuards.set(type, guard);
  }

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
  async queue(
    tenantId: string,
    input: QueueEmailInput,
    context?: 'customer-credit' | 'customer-invoice',
  ) {
    if (
      ['customer-credit', 'customer-invoice'].includes(input.relatedType ?? '') &&
      (context !== input.relatedType || !input.deliveryChannel)
    )
      throw new ForbiddenException('Publiez et confirmez l’envoi du document depuis Facturation.');
    if (input.dedupKey) {
      const existing = await this.prisma.emailMessage.findUnique({
        where: { tenantId_dedupKey: { tenantId, dedupKey: input.dedupKey } },
      });
      if (existing) return existing;
    }
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
      if (!context) await this.documentsService.assertGenericAccess(tenantId, att.documentId);
    }

    const msg = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.emailMessage.create({
          data: {
            tenantId,
            dedupKey: rest.dedupKey,
            deliveryChannel: rest.deliveryChannel,
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
            messageId: `<${randomUUID()}@pulsar.local>`,
            direction: 'OUTBOUND',
            threadId: rest.threadId,
            inReplyTo: rest.inReplyTo,
            references: rest.references,
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
      })
      .catch(async (err) => {
        if (
          input.dedupKey &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const existing = await this.prisma.emailMessage.findUnique({
            where: { tenantId_dedupKey: { tenantId, dedupKey: input.dedupKey } },
          });
          if (existing) return existing;
        }
        throw err;
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
      if (msg.relatedType === 'customer-invoice' && !msg.deliveryChannel) {
        // Legacy automatic/summary messages have no reviewed PDF or delivery mode. Never retry them.
        await this.prisma.emailMessage.updateMany({
          where: { tenantId: msg.tenantId, id: msg.id, status: { in: ['QUEUED', 'FAILED'] } },
          data: {
            status: 'FAILED',
            nextAttemptAt: null,
            lastError: 'INVOICE_LEGACY_REVIEW_REQUIRED',
          },
        });
        return;
      }
      if (msg.relatedType === 'customer-credit' || msg.relatedType === 'customer-invoice') {
        await this.deliverCredit(msg);
        return;
      }
      if (msg.status !== 'QUEUED' && msg.status !== 'FAILED') return;
      if (msg.status === 'FAILED' && !msg.nextAttemptAt) return;
      const guard = msg.relatedType ? this.deliveryGuards.get(msg.relatedType) : undefined;
      let ownsClaim = false;
      // Fail closed if a CRM worker is unavailable during application startup.
      if (msg.relatedType === 'crm-sequence-step' && !guard) return;
      const checkGuard = async () => {
        if (!guard || !msg.relatedId) return true;
        const verdict = await guard(msg.tenantId, msg.relatedId);
        if (verdict === 'ALLOW') return true;
        await this.prisma.emailMessage.updateMany({
          where: {
            id: msg.id,
            tenantId: msg.tenantId,
            status: { in: ownsClaim ? ['SENDING'] : ['QUEUED', 'FAILED'] },
          },
          data:
            verdict === 'HOLD'
              ? { status: 'QUEUED' }
              : {
                  status: 'FAILED',
                  nextAttemptAt: null,
                  lastError: 'CANCELLED_BY_COMMUNICATION_GUARD',
                },
        });
        return false;
      };
      if (!(await checkGuard())) return;

      // Claim atomically — skip if already claimed by another runner.
      const claimed = await this.prisma.emailMessage.updateMany({
        where: { id: messageId, status: { in: ['QUEUED', 'FAILED'] } },
        data: { status: 'SENDING' },
      });
      if (claimed.count === 0) return;
      ownsClaim = true;

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

      if (!(await checkGuard())) return;
      const ok = await this.emailService.send(
        {
          to: msg.toAddresses.join(', '),
          cc: msg.cc.length > 0 ? msg.cc : undefined,
          subject: msg.subject,
          html: msg.html,
          text: msg.text ?? undefined,
          from: transport?.from,
          attachments: attachments.length > 0 ? attachments : undefined,
          messageId: msg.messageId ?? undefined,
          headers: msg.inReplyTo
            ? { 'In-Reply-To': msg.inReplyTo, References: msg.references ?? msg.inReplyTo }
            : undefined,
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
          this.logger.error(
            `MailService: failed to update message ${messageId}: ${String(updateErr)}`,
          ),
        );
    }
  }

  /** Financial document delivery: required exact PDF, frozen mode, no automatic replay. */
  private async deliverCredit(
    msg: Prisma.EmailMessageGetPayload<{ include: { attachments: true } }>,
  ): Promise<void> {
    if (msg.status !== 'QUEUED') return;
    const invoiceDelivery = msg.relatedType === 'customer-invoice';
    const guard = this.deliveryGuards.get(msg.relatedType!);
    if (!guard || !msg.relatedId) return;
    let ownsClaim = false;
    let handoff = false;
    try {
      const initial = await guard(msg.tenantId, msg.relatedId);
      if (initial === 'HOLD') return;
      const claim = await this.prisma.emailMessage.updateMany({
        where: { tenantId: msg.tenantId, id: msg.id, status: 'QUEUED' },
        data: { status: 'SENDING' },
      });
      if (!claim.count) return;
      ownsClaim = true;
      if (initial !== 'ALLOW') throw new Error('CREDIT_NOT_AVAILABLE');
      const note = invoiceDelivery
        ? await this.prisma.customerInvoice.findFirst({
            where: { tenantId: msg.tenantId, id: msg.relatedId, status: { not: 'DRAFT' } },
            select: { documentId: true, documentHash: true },
          })
        : await this.prisma.customerCreditNote.findFirst({
            where: { tenantId: msg.tenantId, id: msg.relatedId, status: 'ISSUED' },
            select: { documentId: true, documentHash: true },
          });
      if (
        !note?.documentId ||
        !note.documentHash ||
        msg.attachments.length !== 1 ||
        msg.attachments[0].documentId !== note.documentId
      )
        throw new Error('CREDIT_PDF_REQUIRED');
      const transport = await this.emailConfigService.resolve(msg.tenantId);
      const channel = transport ? 'smtp' : this.emailService.channel;
      if (channel !== msg.deliveryChannel) throw new Error('CREDIT_DELIVERY_CHANNEL_CHANGED');
      const file = await this.documentsService.download(
        msg.tenantId,
        note.documentId,
        invoiceDelivery ? 'customer-invoice-pdf' : 'customer-credit-pdf',
      );
      const content = await streamToBuffer(file.stream);
      if (createHash('sha256').update(content).digest('hex') !== note.documentHash)
        throw new Error('CREDIT_PDF_INTEGRITY');
      if ((await guard(msg.tenantId, msg.relatedId)) !== 'ALLOW')
        throw new Error('CREDIT_DELIVERY_DISABLED');
      // Persist uncertainty BEFORE handoff: a process crash can never justify a resend.
      await this.prisma.emailMessage.update({
        where: { id: msg.id, tenantId: msg.tenantId },
        data: { deliveryUncertain: channel === 'smtp', nextAttemptAt: null },
      });
      handoff = true;
      const ok = await this.emailService.send(
        {
          to: msg.toAddresses.join(', '),
          subject: msg.subject,
          html: msg.html,
          text: msg.text ?? undefined,
          from: transport?.from,
          messageId: msg.messageId ?? undefined,
          attachments: [{ filename: msg.attachments[0].filename, content }],
        },
        transport ?? undefined,
      );
      if (!ok) throw new Error('CREDIT_PROVIDER_RESULT_UNCERTAIN');
      await this.prisma.emailMessage.update({
        where: { id: msg.id, tenantId: msg.tenantId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          deliveryUncertain: false,
          lastError: null,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      if (!ownsClaim) return;
      await this.prisma.emailMessage
        .updateMany({
          where: { tenantId: msg.tenantId, id: msg.id, status: 'SENDING' },
          data: {
            status: 'FAILED',
            attempts: { increment: 1 },
            nextAttemptAt: null,
            deliveryUncertain: handoff && msg.deliveryChannel === 'smtp',
            lastError: String(error).slice(0, 500),
          },
        })
        .catch(() => undefined);
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
    stream.on('data', (chunk: Buffer) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
