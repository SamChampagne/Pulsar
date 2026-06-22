import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CrmActivityType, isDealOpen } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventsService } from '../../core/operating/domain-events.service';

/**
 * CRM exception detection cron (phase CRM-5).
 * Runs hourly; tick() is clock-injectable and unit-testable.
 * Best-effort — never throws (try/catch + logger like DelayDetectionService).
 *
 * Two scans per tick:
 *  1. Stale deals: open deals with lastActivityAt < now-7d (or null + createdAt < now-7d)
 *     → emit crm.deal.stale
 *  2. Overdue follow-ups: CrmActivity TASK with dueAt <= now and doneAt == null
 *     → emit crm.followup.due
 *
 * Idempotency is handled downstream by task dedupKey
 * (CRM_STALE_DEAL:<dealId>, CRM_FOLLOWUP_DUE:<activityId>).
 */
@Injectable()
export class CrmExceptionsService {
  private readonly logger = new Logger(CrmExceptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async detect(): Promise<void> {
    await this.tick(new Date());
  }

  /**
   * Public, clock-injected, unit-testable.
   * Returns [staleCount, followupCount].
   */
  async tick(now: Date): Promise<[number, number]> {
    try {
      const staleCount = await this.detectStaleDeals(now);
      const followupCount = await this.detectOverdueFollowups(now);
      if (staleCount + followupCount > 0) {
        this.logger.log(
          `CRM exceptions: ${staleCount} stale deal(s), ${followupCount} overdue follow-up(s)`,
        );
      }
      return [staleCount, followupCount];
    } catch (err) {
      this.logger.error('CrmExceptionsService.tick failed', err);
      return [0, 0];
    }
  }

  private async detectStaleDeals(now: Date): Promise<number> {
    const threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const deals = await this.prisma.crmDeal.findMany({
      where: {
        OR: [
          { lastActivityAt: { lt: threshold } },
          { lastActivityAt: null, createdAt: { lt: threshold } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        companyId: true,
        stage: true,
        lastActivityAt: true,
        createdAt: true,
      },
    });

    let count = 0;
    for (const deal of deals) {
      // Only open (non-terminal) deals qualify.
      if (!isDealOpen(deal.stage as Parameters<typeof isDealOpen>[0])) continue;

      const lastAt = deal.lastActivityAt ?? deal.createdAt;
      const daysSinceActivity = Math.floor(
        (now.getTime() - lastAt.getTime()) / (24 * 60 * 60 * 1000),
      );

      await this.domainEvents.emit(
        deal.tenantId,
        'crm.deal.stale',
        { type: 'deal', id: deal.id },
        { dealId: deal.id, companyId: deal.companyId, stage: deal.stage, daysSinceActivity },
      );
      count++;
    }
    return count;
  }

  private async detectOverdueFollowups(now: Date): Promise<number> {
    const activities = await this.prisma.crmActivity.findMany({
      where: {
        type: CrmActivityType.TASK,
        dueAt: { lte: now },
        doneAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        dealId: true,
        companyId: true,
        dueAt: true,
      },
    });

    let count = 0;
    for (const activity of activities) {
      await this.domainEvents.emit(
        activity.tenantId,
        'crm.followup.due',
        { type: 'crm-activity', id: activity.id },
        {
          activityId: activity.id,
          dealId: activity.dealId ?? null,
          companyId: activity.companyId ?? null,
          dueAt: activity.dueAt?.toISOString() ?? null,
        },
      );
      count++;
    }
    return count;
  }
}
