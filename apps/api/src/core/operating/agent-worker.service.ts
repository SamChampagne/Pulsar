import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AgentRunStatus,
  AgentRunTrigger,
  AgentStatus,
  OperationalTaskStatus,
  classifyRunError,
  buildWakePrompt,
  type WakeAutonomy,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps } from '../agents/agent-principal';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { AgentRunsService } from './agent-runs.service';
import { OperationalTasksService } from './operational-tasks.service';

const MAX_TASKS_PER_CRON_TICK = 10;
const MAX_ATTEMPTS = 2; // total tries on connectivity errors
const PER_AGENT_CONCURRENCY = 1; // an agent processes its tasks serially
/**
 * Retry backoff is 0: the in-band retry is immediate (a single extra attempt per
 * MAX_ATTEMPTS). Holding the concurrency slot during a sleep would stall other
 * runs, and durable longer-term backoff is the 5-min cron safety-net's job.
 */
const RETRY_BACKOFF_MS = 0;

interface QueuedRun {
  runId: string;
  tenantId: string;
  agentId: string;
  taskId: string;
  trigger: AgentRunTrigger;
  attempt: number;
}

interface AgentRow {
  id: string;
  tenantId: string;
  model: string | null;
  persona: string | null;
  serviceUserId: string;
}

/**
 * Always-on agent dispatcher (phase 13, rule 28). Owns an in-memory run queue +
 * concurrency semaphores. Wakeups come from events (enqueueTask) and a cron
 * safety-net sweep. Best-effort and isolated: Hermes absent => run SKIPPED,
 * never throws into the caller, never crashes the core.
 */
@Injectable()
export class AgentWorkerService {
  private readonly logger = new Logger(AgentWorkerService.name);

  private readonly queue: QueuedRun[] = [];
  private readonly inFlightTasks = new Set<string>(); // taskIds queued or running (dedup)
  private globalActive = 0;
  private readonly perTenantActive = new Map<string, number>();
  private readonly perAgentActive = new Map<string, number>();
  private mcpUrl: string;

  private readonly maxGlobal: number;
  private readonly maxPerTenant: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentRuntimeService))
    private readonly runtime: AgentRuntimeService,
    private readonly tasks: OperationalTasksService,
    private readonly ledger: AgentRunsService,
    @Optional() private readonly config?: ConfigService,
  ) {
    const base = this.config?.get<string>('APP_URL') ?? 'http://localhost:3000';
    this.mcpUrl = `${base}/api/v1/mcp`;
    this.maxGlobal = Number(this.config?.get('AGENT_WORKER_MAX_CONCURRENT') ?? 4);
    this.maxPerTenant = Number(this.config?.get('AGENT_WORKER_MAX_PER_TENANT') ?? 2);
  }

  /** Event entry point: enqueue an immediate run for an agent-assigned task. Best-effort. */
  async enqueueTask(tenantId: string, agentId: string, taskId: string): Promise<void> {
    try {
      if (this.inFlightTasks.has(taskId)) return;
      const agent = await this.prisma.agent.findFirst({
        where: { id: agentId, tenantId, status: AgentStatus.ACTIVE },
        select: { id: true, model: true },
      });
      if (!agent) return;
      const runId = await this.ledger.createQueued({
        tenantId, agentId, taskId, trigger: AgentRunTrigger.EVENT, model: agent.model,
      });
      this.inFlightTasks.add(taskId);
      this.queue.push({ runId, tenantId, agentId, taskId, trigger: AgentRunTrigger.EVENT, attempt: 1 });
      void this.dispatch();
    } catch (err) {
      this.logger.warn(`enqueueTask(${taskId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Manual "Run now": enqueue the agent's oldest OPEN task, if any. Returns whether one was enqueued. */
  async runNow(tenantId: string, agentId: string): Promise<boolean> {
    const open = await this.prisma.operationalTask.findMany({
      where: { tenantId, assigneeAgentId: agentId, status: OperationalTaskStatus.OPEN },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    if (open.length === 0) return false;
    const task = open[0];
    if (this.inFlightTasks.has(task.id)) return false;
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { model: true } });
    const runId = await this.ledger.createQueued({
      tenantId, agentId, taskId: task.id, trigger: AgentRunTrigger.MANUAL, model: agent?.model ?? null,
    });
    this.inFlightTasks.add(task.id);
    this.queue.push({ runId, tenantId, agentId, taskId: task.id, trigger: AgentRunTrigger.MANUAL, attempt: 1 });
    void this.dispatch();
    return true;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runCron(): Promise<void> {
    try {
      await this.tick(this.mcpUrl, MAX_TASKS_PER_CRON_TICK);
    } catch (err) {
      this.logger.error(`runCron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Safety-net sweep + synchronous drain. Enqueues OPEN tasks for all ACTIVE
   * always-on agents (idempotent via inFlightTasks), drains the queue to
   * completion, returns the number of runs that SUCCEEDED. Backoff is 0 here.
   */
  async tick(mcpUrl: string, max: number): Promise<number> {
    this.mcpUrl = mcpUrl;
    // Cross-tenant system sweep (NOT request-scoped): load every ACTIVE agent, then
    // scope each task query by the agent's own tenantId (rule 1). `max` bounds tasks
    // PER agent so a large backlog on one agent never starves the others this tick.
    const agents = await this.prisma.agent.findMany({ where: { status: AgentStatus.ACTIVE } });
    const alwaysOn = agents.filter((a) => ((a.caps ?? {}) as AgentCaps).alwaysOn === true);
    for (const agent of alwaysOn) {
      const open = await this.prisma.operationalTask.findMany({
        where: { tenantId: agent.tenantId, assigneeAgentId: agent.id, status: OperationalTaskStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        take: max,
      });
      for (const task of open) {
        if (this.inFlightTasks.has(task.id)) continue;
        const runId = await this.ledger.createQueued({
          tenantId: agent.tenantId,
          agentId: agent.id,
          taskId: task.id,
          trigger: AgentRunTrigger.CRON,
          model: agent.model,
        });
        this.inFlightTasks.add(task.id);
        this.queue.push({
          runId,
          tenantId: agent.tenantId,
          agentId: agent.id,
          taskId: task.id,
          trigger: AgentRunTrigger.CRON,
          attempt: 1,
        });
      }
    }
    return this.drain(RETRY_BACKOFF_MS);
  }

  /** Drains the queue respecting concurrency caps. Returns count of SUCCEEDED runs. */
  private async drain(backoffMs: number): Promise<number> {
    let succeeded = 0;
    while (true) {
      const running: Promise<boolean>[] = [];
      let item: QueuedRun | undefined;
      while ((item = this.pickEligible()) !== undefined) {
        const claimed = item;
        this.acquire(claimed);
        running.push(this.executeRun(claimed, backoffMs).finally(() => this.release(claimed)));
      }
      if (running.length === 0) break;
      const results = await Promise.all(running);
      succeeded += results.filter(Boolean).length;
      // loop again: retries may have re-pushed items onto the queue
    }
    return succeeded;
  }

  /** Background dispatch (event/manual path) — fire-and-forget, never throws. */
  private async dispatch(): Promise<void> {
    try {
      await this.drain(RETRY_BACKOFF_MS);
    } catch (err) {
      this.logger.warn(`dispatch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private pickEligible(): QueuedRun | undefined {
    if (this.globalActive >= this.maxGlobal) return undefined;
    const idx = this.queue.findIndex(
      (r) =>
        (this.perTenantActive.get(r.tenantId) ?? 0) < this.maxPerTenant &&
        (this.perAgentActive.get(r.agentId) ?? 0) < PER_AGENT_CONCURRENCY,
    );
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  private acquire(r: QueuedRun): void {
    this.globalActive++;
    this.perTenantActive.set(r.tenantId, (this.perTenantActive.get(r.tenantId) ?? 0) + 1);
    this.perAgentActive.set(r.agentId, (this.perAgentActive.get(r.agentId) ?? 0) + 1);
  }

  private release(r: QueuedRun): void {
    this.globalActive--;
    this.perTenantActive.set(r.tenantId, (this.perTenantActive.get(r.tenantId) ?? 0) - 1);
    this.perAgentActive.set(r.agentId, (this.perAgentActive.get(r.agentId) ?? 0) - 1);
  }

  /** Returns true iff the run SUCCEEDED. Never throws. */
  private async executeRun(item: QueuedRun, backoffMs: number): Promise<boolean> {
    const { tenantId, agentId, taskId, runId } = item;
    // Tracks whether THIS run successfully claimed the task (tasks.start resolved).
    // Only a run that owns the task may revert it on failure — otherwise a redundant
    // trigger that loses the claim race would clobber the winning run's IN_PROGRESS.
    let claimed = false;
    try {
      const agent = (await this.prisma.agent.findFirst({
        where: { id: agentId, tenantId },
        select: {
          id: true,
          tenantId: true,
          model: true,
          persona: true,
          serviceUserId: true,
          status: true,
          autonomyLevel: true,
        },
      })) as (AgentRow & { status: AgentStatus; autonomyLevel: WakeAutonomy }) | null;

      // Hot kill switch: refuse to start for a non-ACTIVE agent.
      if (!agent || agent.status !== AgentStatus.ACTIVE) {
        await this.ledger.finish(runId, AgentRunStatus.KILLED);
        this.inFlightTasks.delete(taskId);
        return false;
      }

      await this.ledger.markRunning(runId);
      await this.prisma.agent.update({ where: { id: agentId }, data: { lastRunAt: new Date() } }).catch(() => undefined);
      await this.tasks.start(tenantId, taskId, agent.serviceUserId);
      claimed = true;

      const sessionId = await this.runtime.openSession({
        tenantId,
        agent: { id: agent.id, model: agent.model, persona: agent.persona },
        pulsarMcpUrl: this.mcpUrl,
        triggeredByRef: `task:${taskId}`,
      });
      // Runtime reachable => heartbeat.
      await this.prisma.agent.update({ where: { id: agentId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
      try {
        const prompt = await this.buildPrompt(tenantId, taskId, agent.autonomyLevel);
        for await (const _ev of this.runtime.sendTurn(sessionId, prompt)) void _ev;
      } finally {
        await this.runtime.closeSession(sessionId).catch(() => undefined);
      }

      const proposedActionCount = await this.prisma.proposedAction.count({
        where: { tenantId, triggeredByRef: `task:${taskId}` },
      });
      await this.ledger.finish(runId, AgentRunStatus.SUCCEEDED, { proposedActionCount });
      this.inFlightTasks.delete(taskId);
      return true;
    } catch (err) {
      return this.handleFailure(item, err, backoffMs, claimed);
    }
  }

  private async handleFailure(
    item: QueuedRun,
    err: unknown,
    backoffMs: number,
    claimed: boolean,
  ): Promise<boolean> {
    const { tenantId, agentId, taskId, runId } = item;
    const name = err instanceof Error ? err.constructor.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`agent ${agentId} task ${taskId}: ${message}`);

    // Failed to even claim the task (tasks.start rejected) — typically because
    // another worker already owns it (task no longer OPEN). This is a redundant
    // trigger, not a real failure: finish SKIPPED and NEVER revert (reverting would
    // clobber the IN_PROGRESS state the run that won the claim is relying on).
    if (!claimed) {
      await this.ledger.finish(runId, AgentRunStatus.SKIPPED, { error: message });
      this.inFlightTasks.delete(taskId);
      return false;
    }

    // If the agent was paused/revoked mid-run, this is a kill, not a failure.
    const fresh = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { status: true } });
    if (fresh && fresh.status !== AgentStatus.ACTIVE) {
      await this.revertTask(taskId);
      await this.ledger.finish(runId, AgentRunStatus.KILLED, { error: message });
      this.inFlightTasks.delete(taskId);
      return false;
    }

    const cls = classifyRunError(name);
    if (cls === 'skip') {
      await this.revertTask(taskId);
      await this.ledger.finish(runId, AgentRunStatus.SKIPPED, { error: message });
      this.inFlightTasks.delete(taskId);
      return false;
    }
    if (cls === 'retry' && item.attempt < MAX_ATTEMPTS) {
      const nextAttempt = item.attempt + 1;
      await this.ledger.bumpAttempt(runId, nextAttempt);
      await this.revertTask(taskId);
      await this.sleep(backoffMs);
      this.queue.push({ ...item, attempt: nextAttempt });
      return false;
    }
    // terminal, or retries exhausted
    await this.revertTask(taskId);
    await this.ledger.finish(runId, AgentRunStatus.FAILED, { error: message });
    this.inFlightTasks.delete(taskId);
    return false;
  }

  /** Revert IN_PROGRESS -> OPEN, guarded (never reopen a task the agent resolved mid-turn). */
  private async revertTask(taskId: string): Promise<void> {
    await this.prisma.operationalTask
      .updateMany({
        where: { id: taskId, status: OperationalTaskStatus.IN_PROGRESS },
        data: { status: OperationalTaskStatus.OPEN },
      })
      .catch(() => undefined);
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build the wake prompt for a task: full context + category playbook + an
   * autonomy-aware directive (PROPOSE → propose only, don't close; ACT_LOW/
   * AUTONOMOUS → act then resolve_task). Tenant-scoped read. Falls back to a
   * minimal prompt if the task vanished between dispatch and execution.
   */
  private async buildPrompt(tenantId: string, taskId: string, autonomy: WakeAutonomy): Promise<string> {
    const task = await this.prisma.operationalTask.findFirst({
      where: { id: taskId, tenantId },
      select: {
        id: true,
        category: true,
        title: true,
        severity: true,
        subjectType: true,
        subjectId: true,
        slaDueAt: true,
      },
    });
    if (!task) {
      return `Tâche opérationnelle ${taskId} introuvable. Aucune action requise.`;
    }
    return buildWakePrompt(
      {
        id: task.id,
        category: task.category,
        title: task.title,
        description: null,
        severity: String(task.severity),
        subjectType: task.subjectType,
        subjectId: task.subjectId,
        slaDueAt: task.slaDueAt == null ? null : task.slaDueAt.toISOString(),
      },
      autonomy,
    );
  }
}
