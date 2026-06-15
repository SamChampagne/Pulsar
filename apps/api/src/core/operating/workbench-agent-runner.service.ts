import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgentStatus, OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps } from '../agents/agent-principal';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { OperationalTasksService } from './operational-tasks.service';

/** Max operating tasks the headless runner drives per cron tick (bounded best-effort). */
const MAX_TASKS_PER_CRON_TICK = 10;

/**
 * Headless agent runner for always-on dispatch agents (phase 12, task 10).
 *
 * `tick()` wakes every ACTIVE agent whose caps.alwaysOn === true, finds their
 * OPEN operational tasks (tenant-scoped per agent), drives one Hermes turn each
 * (best-effort), and links proposed actions to the task via triggeredByRef = 'task:<id>'.
 *
 * Hard rules:
 * - Never throws — failures are logged and the task is reverted to OPEN.
 * - Bounded by `maxTasksPerTick` to avoid runaway work.
 * - Uses forwardRef to break the AgentsModule ↔ OperatingModule cycle.
 * - Task query is always scoped by tenantId + assigneeAgentId (hard rule 1).
 */
@Injectable()
export class WorkbenchAgentRunner {
  private readonly logger = new Logger(WorkbenchAgentRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentRuntimeService))
    private readonly runtime: AgentRuntimeService,
    private readonly tasks: OperationalTasksService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runCron(): Promise<void> {
    try {
      const base = this.config?.get<string>('APP_URL') ?? 'http://localhost:3000';
      await this.tick(`${base}/api/v1/mcp`, MAX_TASKS_PER_CRON_TICK);
    } catch (err) {
      this.logger.error(`runCron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Drives one Hermes turn per OPEN task for all always-on agents.
   * Tasks are queried per-agent, scoped by both tenantId and assigneeAgentId
   * to satisfy hard rule 1 (tenant isolation).
   *
   * @param mcpUrl  The URL of the Pulsar MCP server (e.g. http://localhost:3000/api/v1/mcp)
   * @param max  Upper bound on tasks processed per invocation
   * @returns  Number of tasks successfully driven
   */
  async tick(mcpUrl: string, max: number): Promise<number> {
    const agents = await this.prisma.agent.findMany({ where: { status: AgentStatus.ACTIVE } });
    const alwaysOn = agents.filter((a) => ((a.caps ?? {}) as AgentCaps).alwaysOn === true);
    let driven = 0;
    let budget = max;

    for (const agent of alwaysOn) {
      if (budget <= 0) break;
      const open = await this.prisma.operationalTask.findMany({
        where: { tenantId: agent.tenantId, assigneeAgentId: agent.id, status: OperationalTaskStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        take: budget,
      });
      for (const task of open) {
        if (budget <= 0) break;
        budget--;
        try {
          await this.tasks.start(task.tenantId, task.id, agent.serviceUserId);
          const sessionId = await this.runtime.openSession({
            tenantId: agent.tenantId,
            agent: { id: agent.id, model: agent.model, persona: agent.persona },
            pulsarMcpUrl: mcpUrl,
            triggeredByRef: `task:${task.id}`,
          });
          try {
            for await (const _ev of this.runtime.sendTurn(sessionId, this.buildPrompt(task))) {
              void _ev;
            }
            driven++;
          } finally {
            await this.runtime.closeSession(sessionId).catch(() => undefined);
          }
        } catch (err) {
          this.logger.warn(`agent ${agent.id} task ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
          await this.prisma.operationalTask
            .updateMany({
              where: { id: task.id, tenantId: task.tenantId, status: OperationalTaskStatus.IN_PROGRESS },
              data: { status: OperationalTaskStatus.OPEN },
            })
            .catch(() => undefined);
        }
      }
    }
    return driven;
  }

  private buildPrompt(task: { id: string; title: string; category: string; subjectType: string; subjectId: string }): string {
    return (
      `You are handling operational task "${task.title}" (id: ${task.id}, category: ${task.category}, subject: ${task.subjectType}:${task.subjectId}). ` +
      `Review the situation and take or propose the appropriate action.`
    );
  }
}
