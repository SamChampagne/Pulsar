import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoadStatus, NotificationLevel, TrackingEventType } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';

/**
 * Pure function — no side effects, fully testable without NestJS or Prisma.
 * Determines whether a stop is late relative to `now`.
 *
 * Deadline resolution: plannedArrivalLate ?? plannedArrivalEarly.
 * A stop is never late once it has been arrived at, and never late if no
 * deadline is defined.
 */
export function isLate(
  stop: { plannedArrivalEarly: Date | null; plannedArrivalLate: Date | null; actualArrivalAt: Date | null },
  now: Date,
): { late: boolean; deadline: Date | null } {
  const deadline = stop.plannedArrivalLate ?? stop.plannedArrivalEarly;
  if (!deadline || stop.actualArrivalAt) return { late: false, deadline };
  return { late: deadline.getTime() < now.getTime(), deadline };
}

@Injectable()
export class DelayDetectionService {
  private readonly logger = new Logger(DelayDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async detect(): Promise<void> {
    await this.tick(new Date());
  }

  /**
   * Public, clock-injected, idempotent (dedup on (stopId, deadline)).
   * E2E tests drive it directly via tick() rather than waiting for the cron.
   * Returns the number of new DELAYED events created in this pass.
   */
  async tick(now: Date): Promise<number> {
    const stops = await this.prisma.stop.findMany({
      where: {
        actualArrivalAt: null,
        OR: [
          { plannedArrivalLate: { lt: now } },
          { plannedArrivalLate: null, plannedArrivalEarly: { lt: now } },
        ],
        route: { load: { status: { in: [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT] } } },
      },
      include: {
        location: { select: { name: true } },
        route: { select: { tenantId: true, load: { select: { id: true, loadNumber: true } } } },
      },
    });

    let created = 0;
    for (const stop of stops) {
      const { late, deadline } = isLate(stop, now);
      if (!late || !deadline) continue;

      const tenantId = stop.route.tenantId;
      const load = stop.route.load;
      const minutesLate = Math.round((now.getTime() - deadline.getTime()) / 60_000);
      // Dedup on (stopId, deadline): a replanned-then-missed window re-alerts (spec).
      // Race-proof: use a unique dedupKey instead of a pre-check + create (which races under cron overlap).
      // Cheap fast-path: the findFirst below short-circuits before hitting the DB write path.
      const dedupKey = `DELAYED:${stop.id}:${deadline.toISOString()}`;
      const existing = await this.prisma.trackingEvent.findFirst({ where: { dedupKey } });
      if (existing) continue;

      try {
        await this.prisma.trackingEvent.create({
          data: {
            tenantId,
            type: TrackingEventType.DELAYED,
            loadId: load.id,
            stopId: stop.id,
            shipmentId: stop.shipmentId,
            message: `Stop ${stop.location.name} is ${minutesLate} min late (planned by ${deadline.toISOString()})`,
            payload: { stopId: stop.id, deadline: deadline.toISOString(), minutesLate },
            dedupKey,
          },
        });
      } catch (err: unknown) {
        // P2002 = unique constraint violation — a concurrent tick already created this event.
        if ((err as { code?: string }).code === 'P2002') continue;
        throw err;
      }

      await this.notifications.notify({
        tenantId,
        title: `Load ${load.loadNumber} delayed`,
        body: `Stop ${stop.location.name} is ${minutesLate} min past its arrival window.`,
        level: NotificationLevel.WARNING,
        payload: { loadId: load.id, stopId: stop.id, deadline: deadline.toISOString() },
      });
      await this.domainEvents.emit(
        tenantId,
        'stop.delayed',
        { type: 'stop', id: stop.id },
        { stopId: stop.id, loadId: load.id, deadline: deadline.toISOString(), minutesLate },
      );

      created++;
    }

    if (created > 0) this.logger.log(`Delay detection: ${created} new alert(s)`);
    return created;
  }
}
