import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{ deskLayout: unknown }> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return { deskLayout: row?.deskLayout ?? {} };
  }

  async update(userId: string, deskLayout: unknown): Promise<{ deskLayout: unknown }> {
    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, deskLayout: (deskLayout ?? {}) as Prisma.InputJsonValue },
      update: { deskLayout: (deskLayout ?? {}) as Prisma.InputJsonValue },
    });
    return { deskLayout: row.deskLayout };
  }
}
