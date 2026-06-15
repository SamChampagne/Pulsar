import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { AgentStatus, OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { OperationalTasksService } from './operational-tasks.service';

/**
 * Headless agent runner for always-on dispatch agents (phase 12, task 10).
 *
 * `tick()` wakes every ACTIVE agent whose caps.alwaysOn === true, finds their
 * OPEN operational tasks, drives one Hermes turn each (best-effort), and links
 * proposed actions to the task via triggeredByRef = 'task:<id>'.
 *
 * Hard rules:
 * - Never throws — failures are logged and the task is reverted to OPEN.
 * - Bounded by `maxTasksPerTick` to avoid runaway work.
 * - Uses forwardRef to break the AgentsModule ↔ OperatingModule cycle.
 */
@Injectable()
export class WorkbenchAgentRunner {
  private readonly logger = new Logger(WorkbenchAgentRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentRuntimeService))
    private readonly runtime: AgentRuntimeService,
    private readonly tasks: OperationalTasksService,
  ) {}

  /**
   * Drives one Hermes turn per OPEN task for all always-on agents.
   *
   * @param pulsarMcpUrl  The URL of the Pulsar MCP server (e.g. http://localhost:3000/api/v1/mcp)
   * @param maxTasksPerTick  Upper bound on tasks processed per invocation
   * @returns  Number of tasks successfully driven
   */
  async tick(pulsarMcpUrl: string, maxTasksPerTick: number): Promise<number> {
    // 1. Load all ACTIVE agents — filter alwaysOn in memory since Prisma
    //    does not support JSON field filtering portably.
    const allActiveAgents = await this.prisma.agent.findMany({
      where: { status: AgentStatus.ACTIVE },
      select: { id: true, tenantId: true, model: true, persona: true, serviceUserId: true, caps: true },
    });

    const alwaysOnAgents = allActiveAgents.filter((a) => {
      const caps = a.caps as Record<string, unknown> | null;
      return caps?.alwaysOn === true;
    });

    if (alwaysOnAgents.length === 0) return 0;

    // 2. Load OPEN tasks for those agents (bounded).
    const agentIds = alwaysOnAgents.map((a) => a.id);
    const openTasks = await this.prisma.operationalTask.findMany({
      where: {
        assigneeAgentId: { in: agentIds },
        status: OperationalTaskStatus.OPEN,
      },
      orderBy: { createdAt: 'asc' },
      take: maxTasksPerTick,
    });

    if (openTasks.length === 0) return 0;

    // Build a quick lookup from agentId → agent record.
    const agentById = new Map(alwaysOnAgents.map((a) => [a.id, a]));

    let driven = 0;

    for (const task of openTasks) {
      const agent = agentById.get(task.assigneeAgentId!);
      if (!agent) continue;

      let sessionId: string | undefined;
      try {
        // Mark task in-progress before opening session.
        await this.tasks.start(task.tenantId, task.id, agent.serviceUserId);

        sessionId = await this.runtime.openSession({
          tenantId: agent.tenantId,
          agent: { id: agent.id, model: agent.model, persona: agent.persona },
          pulsarMcpUrl,
          triggeredByRef: `task:${task.id}`,
        });

        const prompt =
          `You are handling operational task "${task.title}" (id: ${task.id}, category: ${task.category}, subject: ${task.subjectType}:${task.subjectId}). ` +
          `Review the situation and take or propose the appropriate action.`;

        // Drain the turn — we don't need the output here, just the side-effects
        // (proposed actions written to the DB via the MCP server).
        for await (const _ev of this.runtime.sendTurn(sessionId, prompt)) {
          // best-effort: consume all events
        }

        driven++;
      } catch (err) {
        this.logger.warn(
          `WorkbenchAgentRunner: task ${task.id} failed — ${err instanceof Error ? err.message : String(err)}`,
        );
        // Revert the task to OPEN so it will be retried on the next tick.
        await this.prisma.operationalTask
          .updateMany({
            where: { id: task.id, tenantId: task.tenantId },
            data: { status: OperationalTaskStatus.OPEN },
          })
          .catch(() => undefined);
      } finally {
        if (sessionId) {
          await this.runtime.closeSession(sessionId).catch(() => undefined);
        }
      }
    }

    return driven;
  }
}
