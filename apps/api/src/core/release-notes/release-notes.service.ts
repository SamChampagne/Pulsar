import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReleaseNote, ReleaseNoteStatus } from '@pulsar/database';
import { renderReleaseNoteBody, type Paginated } from '@pulsar/shared';
import { paginated, paginationArgs } from '../../common/pagination';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PreferencesService } from '../preferences/preferences.service';
import { CreateReleaseNoteDto, UpdateReleaseNoteDto } from './dto/release-note.dto';

export interface ReleaseNoteView {
  id: string;
  title: string;
  body: string;
  bodyHtml: string;
  kind: ReleaseNote['kind'];
  version: string | null;
  publishedAt: Date | null;
}

export type ReleaseNoteAdminView = ReleaseNoteView & {
  status: ReleaseNoteStatus;
  createdByEmail: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ReleaseNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: PreferencesService,
  ) {}

  // --- Tenant plane (read + seen state) --------------------------------------

  async listPublished(query: ListQueryDto): Promise<Paginated<ReleaseNoteView>> {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = { status: ReleaseNoteStatus.PUBLISHED };
    const [rows, total] = await Promise.all([
      this.prisma.releaseNote.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.releaseNote.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toView(row)),
      total,
      page,
      pageSize,
    );
  }

  async unseenCount(userId: string): Promise<{ count: number }> {
    const prefs = await this.preferences.get(userId);
    const seenAt = (prefs as { releaseNotesSeenAt?: Date | null }).releaseNotesSeenAt ?? null;
    const where: Prisma.ReleaseNoteWhereInput = { status: ReleaseNoteStatus.PUBLISHED };
    if (seenAt) {
      where.publishedAt = { gt: seenAt };
    }
    const count = await this.prisma.releaseNote.count({ where });
    return { count };
  }

  async markSeen(userId: string): Promise<{ seenAt: Date }> {
    const seenAt = new Date();
    await this.preferences.update(userId, { releaseNotesSeenAt: seenAt });
    return { seenAt };
  }

  // --- Platform plane (authoring) ---------------------------------------------

  async listAll(): Promise<ReleaseNoteAdminView[]> {
    const rows = await this.prisma.releaseNote.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.toAdminView(row));
  }

  async create(actorEmail: string, dto: CreateReleaseNoteDto): Promise<ReleaseNoteAdminView> {
    const row = await this.prisma.releaseNote.create({
      data: {
        title: dto.title,
        body: dto.body,
        kind: dto.kind,
        version: dto.version,
        createdByEmail: actorEmail,
      },
    });
    return this.toAdminView(row);
  }

  async update(id: string, dto: UpdateReleaseNoteDto): Promise<ReleaseNoteAdminView> {
    await this.assertExists(id);
    const row = await this.prisma.releaseNote.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        kind: dto.kind,
        version: dto.version,
      },
    });
    return this.toAdminView(row);
  }

  async publish(id: string): Promise<ReleaseNoteAdminView> {
    const note = await this.assertExists(id);
    const row = await this.prisma.releaseNote.update({
      where: { id },
      data: {
        status: ReleaseNoteStatus.PUBLISHED,
        publishedAt: note.publishedAt ?? new Date(),
      },
    });
    return this.toAdminView(row);
  }

  async unpublish(id: string): Promise<ReleaseNoteAdminView> {
    await this.assertExists(id);
    const row = await this.prisma.releaseNote.update({
      where: { id },
      data: { status: ReleaseNoteStatus.DRAFT },
    });
    return this.toAdminView(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    const note = await this.assertExists(id);
    if (note.status === ReleaseNoteStatus.PUBLISHED) {
      throw new BadRequestException('Cannot delete a published release note; unpublish it first');
    }
    await this.prisma.releaseNote.delete({ where: { id } });
    return { id };
  }

  // --- helpers -----------------------------------------------------------------

  private async assertExists(id: string): Promise<ReleaseNote> {
    const note = await this.prisma.releaseNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Release note not found');
    return note;
  }

  private toView(row: ReleaseNote): ReleaseNoteView {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      bodyHtml: renderReleaseNoteBody(row.body),
      kind: row.kind,
      version: row.version,
      publishedAt: row.publishedAt,
    };
  }

  private toAdminView(row: ReleaseNote): ReleaseNoteAdminView {
    return {
      ...this.toView(row),
      status: row.status,
      createdByEmail: row.createdByEmail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
