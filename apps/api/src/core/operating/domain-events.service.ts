import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DomainEventStatus,
  NotificationLevel,
  OperationalTaskStatus,
  TaskAssigneeType,
  resolvePolicies,
  type Severity,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskAssignmentResolver } from './event-policies';

const SEVERITY_TO_LEVEL: Record<Severity, NotificationLevel> = {
  INFO: NotificationLevel.INFO,
  WARNING: NotificationLevel.WARNING,
  CRITICAL: NotificationLevel.CRITICAL,
};

@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: TaskAssignmentResolver,
  ) {}

  /** Persist a domain event. Best-effort: a failure is logged, never thrown into the caller. */
  async emit(
    tenantId: string,
    type: string,
    subject: { type: string; id: string } | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.domainEvent.create({
        data: {
          tenantId,
          type,
          subjectType: subject?.type ?? null,
          subjectId: subject?.id ?? null,
          payload: payload as Prisma.InputJsonValue,
          status: DomainEventStatus.PENDING,
        },
      });
    } catch (err) {
      this.logger.error(`emit(${type}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processCron(): Promise<void> {
    await this.processPending(100);
  }

  /** Claim PENDING events, run policies, create tasks (idempotent), mark PROCESSED/FAILED. */
  async processPending(limit: number): Promise<number> {
    const pending = await this.prisma.domainEvent.findMany({
      where: { status: DomainEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let handled = 0;
    for (const event of pending) {
      const claimed = await this.prisma.domainEvent.updateMany({
        where: { id: event.id, status: DomainEventStatus.PENDING },
        data: { status: DomainEventStatus.PROCESSED, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      try {
        const specs = resolvePolicies({ type: event.type, payload: (event.payload ?? {}) as Record<string, unknown> });
        for (const spec of specs) {
          const agentId = await this.assignment.resolveAgent(event.tenantId, spec);
          try {
            await this.prisma.operationalTask.create({
              data: {
                tenantId: event.tenantId,
                type: spec.type,
                category: spec.category,
                status: OperationalTaskStatus.OPEN,
                severity: SEVERITY_TO_LEVEL[spec.severity],
                title: spec.title,
                details: spec.details as Prisma.InputJsonValue,
                subjectType: spec.subjectType,
                subjectId: spec.subjectId,
                assigneeType: agentId ? TaskAssigneeType.AGENT : TaskAssigneeType.UNASSIGNED,
                assigneeAgentId: agentId,
                dedupKey: spec.dedupKey,
                sourceEventId: event.id,
              },
            });
          } catch (err) {
            if (!(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002')) throw err;
          }
        }
        handled++;
      } catch (err) {
        await this.prisma.domainEvent.updateMany({
          where: { id: event.id },
          data: { status: DomainEventStatus.FAILED, lastError: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    return handled;
  }
}
