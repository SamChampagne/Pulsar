import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { ModuleTourDto } from './dto/desk-layout.dto';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{
    deskLayout: unknown;
    appearance: unknown;
    releaseNotesSeenAt: Date | null;
    moduleTours: unknown;
  }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return {
      deskLayout: row?.deskLayout ?? {},
      appearance: row?.appearance ?? {},
      releaseNotesSeenAt: row?.releaseNotesSeenAt ?? null,
      moduleTours: row?.moduleTours ?? {},
    };
  }

  async update(
    userId: string,
    patch: {
      deskLayout?: unknown;
      appearance?: unknown;
      releaseNotesSeenAt?: Date;
      moduleTour?: ModuleTourDto;
    },
  ): Promise<{
    deskLayout: unknown;
    appearance: unknown;
    releaseNotesSeenAt: Date | null;
    moduleTours: unknown;
  }> {
    const data: Prisma.UserPreferencesUpdateInput = {};
    if (patch.deskLayout !== undefined) data.deskLayout = patch.deskLayout as Prisma.InputJsonValue;
    if (patch.appearance !== undefined) data.appearance = patch.appearance as Prisma.InputJsonValue;
    if (patch.releaseNotesSeenAt !== undefined) data.releaseNotesSeenAt = patch.releaseNotesSeenAt;

    return this.prisma.$transaction(async (tx) => {
      // The row may not exist on a first visit. Serialize every preference writer,
      // including empty patches: Prisma can emulate an upsert when update is empty.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('preferences'), hashtext(${userId}))`;
      let row = await tx.userPreferences.upsert({
        where: { userId },
        create: {
          userId,
          deskLayout: (patch.deskLayout ?? {}) as Prisma.InputJsonValue,
          appearance: (patch.appearance ?? {}) as Prisma.InputJsonValue,
          releaseNotesSeenAt: patch.releaseNotesSeenAt,
        },
        update: data,
      });
      if (patch.moduleTour) {
        const { moduleKey, ...progress } = patch.moduleTour;
        // Update only one module, preserving simultaneous progress in another tab/module.
        await tx.$executeRaw`
        UPDATE "user_preferences"
        SET "moduleTours" = jsonb_set("moduleTours", ARRAY[${moduleKey}]::text[], ${JSON.stringify(progress)}::jsonb, true),
            "updatedAt" = NOW()
        WHERE "userId" = ${userId}
      `;
        row = await tx.userPreferences.findUniqueOrThrow({ where: { userId } });
      }
      return {
        deskLayout: row.deskLayout,
        appearance: row.appearance ?? {},
        releaseNotesSeenAt: row.releaseNotesSeenAt ?? null,
        moduleTours: row.moduleTours ?? {},
      };
    });
  }
}
