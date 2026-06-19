import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DomainEventStatus,
  NotificationLevel,
  OperationalTaskStatus,
  TaskAssigneeType,
  computeSlaDueAt,
  resolvePolicies,
  type Severity,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AgentWorkerService } from './agent-worker.service';
import { TaskAssignmentResolver } from './event-policies';
import { CustomRuleResolver } from '../automation/custom-rule.resolver';

const SEVERITY_TO_LEVEL: Record<Severity, NotificationLevel> = {
  INFO: NotificationLevel.INFO,
  WARNING: NotificationLevel.WARNING,
  CRITICAL: NotificationLevel.CRITICAL,
};

/** Max domain events processed per cron tick. */
const DOMAIN_EVENT_BATCH_SIZE = 100;

@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: TaskAssignmentResolver,
    private readonly worker: AgentWorkerService,
    private readonly sequences: SequencesService,
    private readonly customRuleResolver: CustomRuleResolver,
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
    await this.processPending(DOMAIN_EVENT_BATCH_SIZE);
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
        data: { status: DomainEventStatus.PROCESSED, attempts: { increment: 1 }, processedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      try {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const specs = resolvePolicies({ type: event.type, payload });

        // Additive layer: consult tenant-configured automation rules. Best-effort
        // (rule 24) — a failure here must never break built-in task creation.
        let customSpecs: typeof specs = [];
        try {
          customSpecs = await this.customRuleResolver.resolve(event.tenantId, event.type, payload);
        } catch (ruleErr) {
          this.logger.error(
            `customRuleResolver failed for event ${event.id} (${event.type}): ${ruleErr instanceof Error ? ruleErr.message : String(ruleErr)}`,
          );
        }

        for (const spec of [...specs, ...customSpecs]) {
          const agentId = await this.assignment.resolveAgent(event.tenantId, spec);
          const nowMs = Date.now();
          const slaDueAt = new Date(computeSlaDueAt(spec.category, nowMs));

          // Best-effort: obtain a case number, but never block task creation on failure.
          let caseNumber: string | undefined;
          try {
            caseNumber = await this.sequences.nextNumber(event.tenantId, 'exception-case');
          } catch (seqErr) {
            this.logger.error(
              `caseNumber sequence failed for tenant ${event.tenantId}: ${seqErr instanceof Error ? seqErr.message : String(seqErr)}`,
            );
          }

          try {
            const created = await this.prisma.operationalTask.create({
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
                slaDueAt,
                ...(caseNumber !== undefined ? { caseNumber } : {}),
              },
              select: { id: true },
            });
            // Phase 13: wake the always-on worker immediately (best-effort, never throws).
            if (agentId) {
              void this.worker.enqueueTask(event.tenantId, agentId, created.id);
            }
          } catch (err) {
            if (!(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002')) throw err;
          }
        }
        handled++;
      } catch (err) {
        // Failures are terminal — this is a best-effort outbox (no retry budget).
        // Guard on PROCESSED (the claim set it) so we never walk back another worker's state.
        await this.prisma.domainEvent.updateMany({
          where: { id: event.id, status: DomainEventStatus.PROCESSED },
          data: { status: DomainEventStatus.FAILED, lastError: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    return handled;
  }
}
