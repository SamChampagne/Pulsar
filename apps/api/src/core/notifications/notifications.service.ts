import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationLevel } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

export interface NotifyInput {
  tenantId: string;
  userId?: string;
  title: string;
  body: string;
  level?: NotificationLevel;
  payload?: unknown;
}

/**
 * In-app notifications only for now.
 * TODO(phase-2): delivery channels (email, webhooks) behind the same notify() API.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  notify(input: NotifyInput) {
    return this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        title: input.title,
        body: input.body,
        level: input.level ?? NotificationLevel.INFO,
        payload: input.payload === undefined ? undefined : (input.payload as Prisma.InputJsonValue),
      },
    });
  }

  listMine(tenantId: string, userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { userId: null }],
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(tenantId: string, userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, tenantId, OR: [{ userId }, { userId: null }] },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    // Tenant-wide notifications: read-by-one = read-for-all (v1 — see phase 8 spec).
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }
}
