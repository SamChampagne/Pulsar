import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EmailThreadStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../core/email/mail.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { LinkThreadDto, ReplyThreadDto, ThreadListQueryDto } from './dto/thread.dto';

/**
 * CRM threads service. All operations are tenant-scoped (rule 1).
 * FK references (contactId/companyId/dealId) are validated tenant-scoped before persist (rule 9).
 * Audit logs on reply/link/archive (rule 6).
 * reply() chains to the latest INBOUND message in the thread (threadId + inReplyTo + references).
 */
@Injectable()
export class ThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditLogsService,
    private readonly documentsService: DocumentsService,
  ) {}

  async list(tenantId: string, query: ThreadListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.status ? { status: query.status as EmailThreadStatus } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.search
        ? { subject: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.emailThread.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.emailThread.count({ where }),
    ]);

    // Resolve contact/company display names in two bulk queries (no N+1).
    const contactIds = [...new Set(items.map((t) => t.contactId).filter((id): id is string => id != null))];
    const companyIds = [...new Set(items.map((t) => t.companyId).filter((id): id is string => id != null))];

    const [contacts, companies] = await Promise.all([
      contactIds.length
        ? this.prisma.crmContact.findMany({ where: { tenantId, id: { in: contactIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      companyIds.length
        ? this.prisma.crmCompany.findMany({ where: { tenantId, id: { in: companyIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    const contactMap = new Map(contacts.map((c) => [c.id, c.name]));
    const companyMap = new Map(companies.map((c) => [c.id, c.name]));

    const enriched = items.map((t) => ({
      ...t,
      contactName: t.contactId ? (contactMap.get(t.contactId) ?? null) : null,
      companyName: t.companyId ? (companyMap.get(t.companyId) ?? null) : null,
    }));

    return paginated(enriched, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const thread = await this.prisma.emailThread.findFirst({ where: { id, tenantId } });
    if (!thread) throw new NotFoundException('Thread not found');
    const messages = await this.prisma.emailMessage.findMany({
      where: { tenantId, threadId: id },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });

    // Enrich each attachment with a presigned download URL (best-effort: missing doc → null).
    const enrichedMessages = await Promise.all(
      messages.map(async (msg) => {
        const attachments = await Promise.all(
          msg.attachments.map(async (att) => {
            if (!att.documentId) return { ...att, downloadUrl: null };
            try {
              const { url } = await this.documentsService.downloadUrl(tenantId, att.documentId);
              return { ...att, downloadUrl: url };
            } catch {
              return { ...att, downloadUrl: null };
            }
          }),
        );
        return { ...msg, attachments };
      }),
    );

    return { ...thread, messages: enrichedMessages };
  }

  /** Queue an outbound reply, chained to the latest INBOUND message of the thread. */
  async reply(
    tenantId: string,
    id: string,
    dto: ReplyThreadDto,
    author: { userId?: string; agentId?: string },
  ) {
    const thread = await this.prisma.emailThread.findFirst({ where: { id, tenantId } });
    if (!thread) throw new NotFoundException('Thread not found');

    // Recipient: the contact email, else the latest inbound fromAddress.
    let to: string | null = null;
    if (thread.contactId) {
      const c = await this.prisma.crmContact.findFirst({
        where: { id: thread.contactId, tenantId },
        select: { email: true },
      });
      to = c?.email ?? null;
    }

    const lastInbound = await this.prisma.emailMessage.findFirst({
      where: { tenantId, threadId: id, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { messageId: true, references: true, fromAddress: true },
    });

    to = to ?? lastInbound?.fromAddress ?? null;
    if (!to) throw new BadRequestException('No recipient address for this thread');

    const references =
      [lastInbound?.references, lastInbound?.messageId].filter(Boolean).join(' ') || undefined;

    const msg = await this.mail.queue(tenantId, {
      toAddresses: [to],
      subject: dto.subject ?? `Re: ${thread.subject}`,
      html: dto.html,
      threadId: id,
      inReplyTo: lastInbound?.messageId ?? undefined,
      references,
      relatedType: 'email-thread',
      relatedId: id,
      createdByUserId: author.userId,
      agentId: author.agentId,
    });

    await this.prisma.emailThread.updateMany({
      where: { id, tenantId },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
    });

    await this.audit.log({
      tenantId,
      userId: author.userId,
      action: AuditAction.CREATE,
      entityType: 'email-thread',
      entityId: id,
      after: { direction: 'OUTBOUND', to, agentId: author.agentId },
    });

    return msg;
  }

  /** Link the thread to a contact/company/deal (or create a contact inline), → LINKED. Rule 9 + 6. */
  async link(tenantId: string, id: string, dto: LinkThreadDto, userId?: string) {
    const thread = await this.prisma.emailThread.findFirst({ where: { id, tenantId } });
    if (!thread) throw new NotFoundException('Thread not found');

    let contactId = dto.contactId ?? null;
    let companyId = dto.companyId ?? null;

    if (dto.createContact) {
      const created = await this.prisma.crmContact.create({
        data: { tenantId, name: dto.createContact.name, email: dto.createContact.email },
      });
      contactId = created.id;
    } else if (contactId) {
      const c = await this.prisma.crmContact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true, companyId: true },
      });
      if (!c) throw new BadRequestException(`Unknown crm-contact "${contactId}"`);
      companyId = companyId ?? c.companyId;
    }

    if (companyId) {
      const co = await this.prisma.crmCompany.findFirst({
        where: { id: companyId, tenantId },
        select: { id: true },
      });
      if (!co) throw new BadRequestException(`Unknown crm-company "${companyId}"`);
    }

    if (dto.dealId) {
      const d = await this.prisma.crmDeal.findFirst({
        where: { id: dto.dealId, tenantId },
        select: { id: true },
      });
      if (!d) throw new BadRequestException(`Unknown crm-deal "${dto.dealId}"`);
    }

    const updated = await this.prisma.emailThread.update({
      where: { id },
      data: {
        contactId,
        companyId,
        dealId: dto.dealId ?? thread.dealId,
        status: EmailThreadStatus.LINKED,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'email-thread',
      entityId: id,
      after: { contactId, companyId, dealId: updated.dealId, status: 'LINKED' },
    });

    return updated;
  }

  async archive(tenantId: string, id: string, userId?: string) {
    const { count } = await this.prisma.emailThread.updateMany({
      where: { id, tenantId },
      data: { status: EmailThreadStatus.ARCHIVED },
    });
    if (count === 0) throw new NotFoundException('Thread not found');

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'email-thread',
      entityId: id,
      after: { status: 'ARCHIVED' },
    });

    return this.prisma.emailThread.findFirst({ where: { id, tenantId } });
  }
}
