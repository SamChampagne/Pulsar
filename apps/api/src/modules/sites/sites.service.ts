import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LandingPageStatus, slugify, validateLandingContent } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CreateLandingPageDto, LandingPageListQueryDto, UpdateLandingPageDto } from './dto/landing-page.dto';

/**
 * Sites admin service. All operations are tenant-scoped (rule 1).
 * Slug uniqueness is GLOBAL (@@unique([slug]) on LandingPage).
 * captureListId ownership is verified via direct PrismaService query (no CrmModule import — rule R9 + cycle avoidance).
 */
@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, query: LandingPageListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.LandingPageWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status as LandingPageStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { slug: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.landingPage.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { submissions: true } } },
      }),
      this.prisma.landingPage.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const page = await this.prisma.landingPage.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { submissions: true } } },
    });
    if (!page) throw new NotFoundException('Landing page not found');
    return page;
  }

  async create(tenantId: string, userId: string, dto: CreateLandingPageDto) {
    const slug = slugify(dto.slug ?? dto.title);

    // Slug uniqueness is global (@@unique on slug column)
    const existing = await this.prisma.landingPage.findFirst({ where: { slug } });
    if (existing) throw new ConflictException(`Slug "${slug}" is already taken`);

    const content = dto.content ?? [];
    if (!validateLandingContent(content)) {
      throw new BadRequestException('Invalid landing page content: each block must have a known type');
    }

    // R9: verify captureListId is owned by this tenant
    if (dto.captureListId) {
      const list = await this.prisma.crmList.findFirst({ where: { id: dto.captureListId, tenantId } });
      if (!list) throw new NotFoundException('CRM list not found or not accessible');
    }

    const landingPage = await this.prisma.landingPage.create({
      data: {
        tenantId,
        slug,
        title: dto.title,
        content: content as Prisma.InputJsonValue,
        captureListId: dto.captureListId ?? null,
        status: LandingPageStatus.DRAFT,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'landing-page',
      entityId: landingPage.id,
      after: { title: landingPage.title, slug: landingPage.slug, status: landingPage.status },
    });

    return landingPage;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateLandingPageDto) {
    const existing = await this.prisma.landingPage.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Landing page not found');

    let slug: string | undefined;
    if (dto.slug !== undefined || dto.title !== undefined) {
      slug = slugify(dto.slug ?? dto.title ?? existing.title);
      // Collision check excluding self
      const collision = await this.prisma.landingPage.findFirst({ where: { slug, id: { not: id } } });
      if (collision) throw new ConflictException(`Slug "${slug}" is already taken`);
    }

    if (dto.content !== undefined && !validateLandingContent(dto.content)) {
      throw new BadRequestException('Invalid landing page content: each block must have a known type');
    }

    // R9: verify captureListId ownership if changed
    if (dto.captureListId !== undefined && dto.captureListId !== null) {
      const list = await this.prisma.crmList.findFirst({ where: { id: dto.captureListId, tenantId } });
      if (!list) throw new NotFoundException('CRM list not found or not accessible');
    }

    const { count } = await this.prisma.landingPage.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(dto.content !== undefined ? { content: dto.content as Prisma.InputJsonValue } : {}),
        ...(dto.captureListId !== undefined ? { captureListId: dto.captureListId } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Landing page not found');

    const updated = await this.get(tenantId, id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'landing-page',
      entityId: id,
      after: { title: updated.title, slug: updated.slug, status: updated.status },
    });

    return updated;
  }

  async publish(tenantId: string, userId: string, id: string) {
    const page = await this.prisma.landingPage.findFirst({ where: { id, tenantId } });
    if (!page) throw new NotFoundException('Landing page not found');

    const content = page.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new BadRequestException('Cannot publish a landing page with no content blocks');
    }

    const { count } = await this.prisma.landingPage.updateMany({
      where: { id, tenantId },
      data: { status: LandingPageStatus.PUBLISHED, publishedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Landing page not found');

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'landing-page',
      entityId: id,
      before: { status: page.status },
      after: { status: LandingPageStatus.PUBLISHED },
    });

    return this.get(tenantId, id);
  }

  async unpublish(tenantId: string, userId: string, id: string) {
    const page = await this.prisma.landingPage.findFirst({ where: { id, tenantId } });
    if (!page) throw new NotFoundException('Landing page not found');

    const { count } = await this.prisma.landingPage.updateMany({
      where: { id, tenantId },
      data: { status: LandingPageStatus.DRAFT },
    });
    if (count === 0) throw new NotFoundException('Landing page not found');

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'landing-page',
      entityId: id,
      before: { status: page.status },
      after: { status: LandingPageStatus.DRAFT },
    });

    return this.get(tenantId, id);
  }

  async remove(tenantId: string, userId: string, id: string) {
    const page = await this.prisma.landingPage.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!page) throw new NotFoundException('Landing page not found');

    // onDelete: Cascade removes submissions automatically
    await this.prisma.landingPage.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'landing-page',
      entityId: id,
    });

    return { ok: true };
  }

  async listSubmissions(tenantId: string, pageId: string, query: LandingPageListQueryDto) {
    // Assert page ownership
    const page = await this.prisma.landingPage.findFirst({ where: { id: pageId, tenantId }, select: { id: true } });
    if (!page) throw new NotFoundException('Landing page not found');

    const { page: pg, pageSize, skip, take } = paginationArgs(query);
    const where = { tenantId, landingPageId: pageId };
    const [items, total] = await Promise.all([
      this.prisma.landingPageSubmission.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.landingPageSubmission.count({ where }),
    ]);
    return paginated(items, total, pg, pageSize);
  }
}
