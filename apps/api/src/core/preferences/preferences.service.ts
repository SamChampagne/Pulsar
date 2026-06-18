import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{ deskLayout: unknown; appearance: unknown }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return { deskLayout: row?.deskLayout ?? {}, appearance: row?.appearance ?? {} };
  }

  async update(
    userId: string,
    patch: { deskLayout?: unknown; appearance?: unknown },
  ): Promise<{ deskLayout: unknown; appearance: unknown }> {
    const data: Prisma.UserPreferencesUpdateInput = {};
    if (patch.deskLayout !== undefined) data.deskLayout = patch.deskLayout as Prisma.InputJsonValue;
    if (patch.appearance !== undefined) data.appearance = patch.appearance as Prisma.InputJsonValue;

    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        deskLayout: (patch.deskLayout ?? {}) as Prisma.InputJsonValue,
        appearance: (patch.appearance ?? {}) as Prisma.InputJsonValue,
      },
      update: data,
    });
    return { deskLayout: row.deskLayout, appearance: row.appearance ?? {} };
  }
}
