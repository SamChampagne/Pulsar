import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  EmailDirection,
  EmailThreadStatus,
  normalizeSubject,
  resolveThreadDecision,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocumentsService } from '../../documents/documents.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { DomainEventsService } from '../../operating/domain-events.service';
import type { RawInboundEmail } from './inbound-driver';

@Injectable()
export class InboundIngestService {
  private readonly logger = new Logger(InboundIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
    private readonly events: DomainEventsService,
  ) {}

  /**
   * Ingest one inbound email: idempotent on messageId, threads via RFC headers
   * then sender→contact match, persists the message + attachments, audits, emits.
   */
  async ingest(
    tenantId: string,
    raw: RawInboundEmail,
  ): Promise<{ threadId: string; messageId: string; deduped: boolean }> {
    // 1. Idempotence on messageId.
    const existing = await this.prisma.emailMessage.findFirst({
      where: { tenantId, messageId: raw.messageId },
      select: { id: true, threadId: true },
    });
    if (existing) {
      return { threadId: existing.threadId ?? '', messageId: existing.id, deduped: true };
    }

    // 2a. Known referenced message → existing thread.
    const refIds = [raw.inReplyTo, ...raw.references].filter(Boolean) as string[];
    let knownMessageThreadId: string | null = null;
    if (refIds.length > 0) {
      const ref = await this.prisma.emailMessage.findFirst({
        where: { tenantId, messageId: { in: refIds }, threadId: { not: null } },
        select: { threadId: true },
        orderBy: { createdAt: 'desc' },
      });
      knownMessageThreadId = ref?.threadId ?? null;
    }

    // 2b. Sender → contact match (case-insensitive) — only when RFC threading yields nothing.
    let matchedContact: { id: string; companyId: string | null } | null = null;
    if (!knownMessageThreadId && raw.from) {
      const contact = await this.prisma.crmContact.findFirst({
        where: { tenantId, email: { equals: raw.from, mode: 'insensitive' } },
        select: { id: true, companyId: true },
      });
      matchedContact = contact ? { id: contact.id, companyId: contact.companyId } : null;
    }

    const decision = resolveThreadDecision({
      inReplyTo: raw.inReplyTo,
      references: raw.references,
      knownMessageThreadId,
      matchedContact,
    });

    const subjectNorm = normalizeSubject(raw.subject);

    // 3. Persist thread (or reuse) + message in one transaction.
    const result = await this.prisma.$transaction(async (tx) => {
      let threadId: string;
      let newThread = false;

      if (decision.kind === 'existing') {
        threadId = decision.threadId;
      } else if (decision.kind === 'new-linked') {
        const t = await tx.emailThread.create({
          data: {
            tenantId,
            subject: raw.subject,
            subjectNorm,
            contactId: decision.contactId,
            companyId: decision.companyId,
            status: EmailThreadStatus.LINKED,
            lastMessageAt: raw.receivedAt,
          },
        });
        threadId = t.id;
        newThread = true;
      } else {
        const t = await tx.emailThread.create({
          data: {
            tenantId,
            subject: raw.subject,
            subjectNorm,
            status: EmailThreadStatus.UNLINKED,
            lastMessageAt: raw.receivedAt,
          },
        });
        threadId = t.id;
        newThread = true;
      }

      const msg = await tx.emailMessage.create({
        data: {
          tenantId,
          threadId,
          direction: EmailDirection.INBOUND,
          status: 'SENT', // inbound = already delivered; not an outbox queue item
          toAddresses: raw.to,
          subject: raw.subject,
          html: raw.html,
          text: raw.text,
          messageId: raw.messageId,
          inReplyTo: raw.inReplyTo ?? null,
          references: raw.references.join(' ') || null,
          fromAddress: raw.from,
        },
      });

      await tx.emailThread.update({
        where: { id: threadId },
        data: { lastMessageAt: raw.receivedAt, messageCount: { increment: 1 } },
      });

      return { threadId, messageId: msg.id, newThread };
    });

    // 4. Attachments via DocumentsService (rule 12) — best-effort, outside the tx.
    for (const att of raw.attachments) {
      try {
        const doc = await this.documents.upload(tenantId, {
          entityType: 'email-inbound',
          entityId: result.messageId,
          fileName: att.filename,
          mimeType: att.mimeType,
          body: att.content,
          uploadedById: undefined,
        });
        await this.prisma.emailAttachment.create({
          data: {
            tenantId,
            emailMessageId: result.messageId,
            documentId: doc.id,
            filename: att.filename,
          },
        });
      } catch (err) {
        this.logger.warn(`inbound attachment failed (${att.filename}): ${String(err)}`);
      }
    }

    // 5. Audit (rule 6) — AuditLogsService.log is already fire-and-forget internally,
    //    but we still await so failures are silently swallowed at the call site too.
    try {
      await this.audit.log({
        tenantId,
        action: AuditAction.CREATE,
        entityType: 'email-thread',
        entityId: result.threadId,
        after: {
          direction: 'INBOUND',
          from: raw.from,
          subject: raw.subject,
          newThread: result.newThread,
        },
      });
    } catch {
      // best-effort
    }

    // 6. Domain event — best-effort.
    await this.events.emit(
      tenantId,
      'crm.email.received',
      { type: 'email-thread', id: result.threadId },
      { messageId: result.messageId, from: raw.from },
    );

    return { threadId: result.threadId, messageId: result.messageId, deduped: false };
  }
}
