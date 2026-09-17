import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    userId: string,
  ): Promise<{ deskLayout: unknown; appearance: unknown; releaseNotesSeenAt: Date | null }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return {
      deskLayout: row?.deskLayout ?? {},
      appearance: row?.appearance ?? {},
      releaseNotesSeenAt: row?.releaseNotesSeenAt ?? null,
    };
  }

  async update(
    userId: string,
    patch: { deskLayout?: unknown; appearance?: unknown; releaseNotesSeenAt?: Date },
  ): Promise<{ deskLayout: unknown; appearance: unknown; releaseNotesSeenAt: Date | null }> {
    const data: Prisma.UserPreferencesUpdateInput = {};
    if (patch.deskLayout !== undefined) data.deskLayout = patch.deskLayout as Prisma.InputJsonValue;
    if (patch.appearance !== undefined) data.appearance = patch.appearance as Prisma.InputJsonValue;
    if (patch.releaseNotesSeenAt !== undefined) data.releaseNotesSeenAt = patch.releaseNotesSeenAt;

    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        deskLayout: (patch.deskLayout ?? {}) as Prisma.InputJsonValue,
        appearance: (patch.appearance ?? {}) as Prisma.InputJsonValue,
        releaseNotesSeenAt: patch.releaseNotesSeenAt,
      },
      update: data,
    });
    return {
      deskLayout: row.deskLayout,
      appearance: row.appearance ?? {},
      releaseNotesSeenAt: row.releaseNotesSeenAt ?? null,
    };
  }
}
