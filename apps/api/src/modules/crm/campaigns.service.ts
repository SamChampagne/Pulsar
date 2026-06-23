import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { interpolateTemplate } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../core/email/mail.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { CampaignListQueryDto, CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

/**
 * CRM campaigns service. All operations are tenant-scoped (rule 1).
 * send() uses a claim-safe updateMany to transition DRAFT→SENDING (TOCTOU).
 * Email is queued per-recipient via MailService.queue (best-effort, rule 6).
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async list(tenantId: string, query: CampaignListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = { tenantId };
    const [items, total] = await Promise.all([
      this.prisma.crmCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { list: { select: { id: true, name: true } } },
      }),
      this.prisma.crmCampaign.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id, tenantId },
      include: { list: { select: { id: true, name: true } } },
    });
    if (!campaign) throw new NotFoundException('CRM campaign not found');
    return campaign;
  }

  async create(tenantId: string, dto: CreateCampaignDto) {
    // Validate listId belongs to this tenant.
    const listExists = await this.prisma.crmList.findFirst({
      where: { id: dto.listId, tenantId },
      select: { id: true },
    });
    if (!listExists) throw new BadRequestException(`Unknown crm-list "${dto.listId}"`);

    return this.prisma.crmCampaign.create({
      data: {
        tenantId,
        name: dto.name,
        listId: dto.listId,
        subject: dto.subject,
        html: dto.html,
        templateKey: dto.templateKey ?? null,
        ownerUserId: dto.ownerUserId ?? null,
      },
      include: { list: { select: { id: true, name: true } } },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCampaignDto) {
    if (dto.listId) {
      const listExists = await this.prisma.crmList.findFirst({
        where: { id: dto.listId, tenantId },
        select: { id: true },
      });
      if (!listExists) throw new BadRequestException(`Unknown crm-list "${dto.listId}"`);
    }

    const { count } = await this.prisma.crmCampaign.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.listId !== undefined ? { listId: dto.listId } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.html !== undefined ? { html: dto.html } : {}),
        ...(dto.templateKey !== undefined ? { templateKey: dto.templateKey } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM campaign not found');
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    const { count } = await this.prisma.crmCampaign.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('CRM campaign not found');
    return { deleted: true };
  }

  /**
   * Send a campaign to all list members with a non-empty email.
   * Claim-safe: updateMany DRAFT→SENDING (TOCTOU). Best-effort per recipient.
   */
  async send(tenantId: string, id: string, userId: string) {
    // Claim: atomically transition DRAFT→SENDING.
    const claim = await this.prisma.crmCampaign.updateMany({
      where: { id, tenantId, status: 'DRAFT' },
      data: { status: 'SENDING' },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Campaign is not in DRAFT');
    }

    // Load the campaign + list members' contacts (with company for interpolation).
    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id, tenantId },
      include: {
        list: {
          include: {
            members: {
              include: {
                list: false,
              },
            },
          },
        },
      },
    });
    if (!campaign) {
      // Unlikely (we just claimed it), but guard.
      throw new NotFoundException('CRM campaign not found');
    }

    // Fetch full contact details (with company) for each member that has an email.
    const memberContactIds = campaign.list.members.map((m) => m.contactId);
    const contacts = await this.prisma.crmContact.findMany({
      where: {
        id: { in: memberContactIds },
        tenantId,
        email: { not: null },
      },
      include: { company: { select: { id: true, name: true } } },
    });

    // Filter out contacts whose email is an empty string (belt-and-suspenders).
    const eligible = contacts.filter((c) => c.email && c.email.trim().length > 0);

    let queued = 0;
    for (const contact of eligible) {
      const payload: Record<string, string> = {
        name: contact.name,
        email: contact.email!,
        title: contact.title ?? '',
        company: contact.company?.name ?? '',
      };
      const renderedSubject = interpolateTemplate(campaign.subject, payload);
      const renderedHtml = interpolateTemplate(campaign.html, payload);

      try {
        await this.mail.queue(tenantId, {
          toAddresses: [contact.email!],
          subject: renderedSubject,
          html: renderedHtml,
          relatedType: 'crm-campaign',
          relatedId: id,
          createdByUserId: userId,
        });
        queued++;
      } catch {
        // Best-effort: one recipient failing must not abort the batch.
      }
    }

    // Mark campaign as SENT regardless of individual recipient failures.
    await this.prisma.crmCampaign.updateMany({
      where: { id, tenantId },
      data: { status: 'SENT', sentAt: new Date() },
    });

    return { queued };
  }

  /**
   * Stats: group EmailMessage rows by status for this campaign.
   */
  async stats(tenantId: string, id: string) {
    // Verify campaign exists and belongs to tenant.
    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('CRM campaign not found');

    const groups = await this.prisma.emailMessage.groupBy({
      by: ['status'],
      where: { tenantId, relatedType: 'crm-campaign', relatedId: id },
      _count: { status: true },
    });

    let sent = 0;
    let failed = 0;
    let queuedCount = 0;

    for (const g of groups) {
      const n = g._count.status;
      if (g.status === 'SENT') sent = n;
      else if (g.status === 'FAILED') failed = n;
      else if (g.status === 'QUEUED' || g.status === 'SENDING') queuedCount += n;
    }

    const total = sent + failed + queuedCount;
    return { total, sent, failed, queued: queuedCount };
  }
}
