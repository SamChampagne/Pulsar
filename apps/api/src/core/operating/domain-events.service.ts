import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DOMAIN_EVENT_MAX_CATCHUP_BATCHES,
  DomainEventStatus,
  NotificationLevel,
  OperationalTaskStatus,
  TaskAssigneeType,
  computeSlaDueAt,
  drainInBatches,
  resolvePolicies,
  type Severity,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AgentWorkerService } from './agent-worker.service';
import { TaskAssignmentResolver } from './event-policies';
import { CustomRuleResolver } from '../automation/custom-rule.resolver';
import {
  currentReactionRuleId,
  ReactionExecutorService,
} from '../automation/reaction-executor.service';

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
    private readonly reactionExecutor: ReactionExecutorService,
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
          reactionRuleId: currentReactionRuleId(),
        },
      });
    } catch (err) {
      this.logger.error(
        `emit(${type}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processCron(): Promise<void> {
    // Bounded catch-up: drain up to N batches this run so a backlog doesn't take
    // N minutes to clear, while never looping unboundedly. Best-effort — never
    // throws (rule 24). This stays a single-process, in-memory-orchestrated,
    // DB-durable outbox (NOT a distributed queue) — see docs/runbook.md.
    try {
      await drainInBatches(() => this.processPending(DOMAIN_EVENT_BATCH_SIZE), {
        maxBatches: DOMAIN_EVENT_MAX_CATCHUP_BATCHES,
      });
    } catch {
      // drainInBatches never throws by construction; this keeps the cron bulletproof.
    }
  }

  /** Claim PENDING events, run policies, create tasks (idempotent), mark PROCESSED/FAILED. */
  async processPending(limit: number): Promise<number> {
    const pending = await this.prisma.domainEvent.findMany({
      where: { status: DomainEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        tenantId: true,
        type: true,
        payload: true,
        status: true,
        reactionRuleId: true,
      },
    });

    let handled = 0;
    for (const event of pending) {
      const claimed = await this.prisma.domainEvent.updateMany({
        where: { id: event.id, status: DomainEventStatus.PENDING },
        data: {
          status: DomainEventStatus.PROCESSED,
          attempts: { increment: 1 },
          processedAt: new Date(),
        },
      });
      if (claimed.count === 0) continue;

      try {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const specs = resolvePolicies({ type: event.type, payload });

        // Additive layer: consult tenant-configured automation rules. Best-effort
        // (rule 24) — a failure here must never break built-in task creation.
        let customSpecs: ReturnType<typeof resolvePolicies> = [];
        let reactionCommands: Awaited<
          ReturnType<CustomRuleResolver['resolve']>
        >['reactionCommands'] = [];
        try {
          const customResult = await this.customRuleResolver.resolve(
            event.tenantId,
            event.type,
            payload,
          );
          customSpecs = customResult.taskSpecs;
          reactionCommands = customResult.reactionCommands;
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
            if (!(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002'))
              throw err;
          }
        }
        // Reactions: skip entirely for reaction-originated events (anti-loop, single hop).
        // CREATE_TASK rules above still ran for tagged events — only RUN_ACTION execution is skipped.
        if (!event.reactionRuleId) {
          try {
            for (const command of reactionCommands) {
              // executeCommand is idempotent and never throws — defensive guard anyway.
              await this.reactionExecutor.executeCommand(event.tenantId, event.id, command);
            }
          } catch (rxErr) {
            this.logger.error(
              `reaction loop failed for event ${event.id}: ${rxErr instanceof Error ? rxErr.message : String(rxErr)}`,
            );
          }
        }

        handled++;
      } catch (err) {
        // Failures are terminal — this is a best-effort outbox (no retry budget).
        // Guard on PROCESSED (the claim set it) so we never walk back another worker's state.
        await this.prisma.domainEvent.updateMany({
          where: { id: event.id, status: DomainEventStatus.PROCESSED },
          data: {
            status: DomainEventStatus.FAILED,
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
    return handled;
  }
}
