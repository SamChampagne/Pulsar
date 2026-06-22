import { Injectable } from '@nestjs/common';
import { AgentRunStatus, AgentRunTrigger } from '@pulsar/shared';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginationArgs, paginated } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

/** Projection for GET /agents/:id/runs — never exposes internal refs beyond the run itself. */
const runSelect = {
  id: true,
  agentId: true,
  trigger: true,
  taskId: true,
  status: true,
  attempt: true,
  startedAt: true,
  finishedAt: true,
  error: true,
  proposedActionCount: true,
  createdAt: true,
} as const;

@Injectable()
export class AgentRunsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a durable QUEUED run row. triggeredByRef mirrors the session token ref. */
  async createQueued(input: {
    tenantId: string;
    agentId: string;
    taskId: string | null;
    trigger: AgentRunTrigger;
    model: string | null;
    attempt?: number;
  }): Promise<string> {
    const run = await this.prisma.agentRun.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        taskId: input.taskId,
        triggeredByRef: input.taskId ? `task:${input.taskId}` : null,
        trigger: input.trigger,
        model: input.model,
        attempt: input.attempt ?? 1,
        status: AgentRunStatus.QUEUED,
      },
      select: { id: true },
    });
    return run.id;
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.agentRun
      .update({ where: { id }, data: { status: AgentRunStatus.RUNNING, startedAt: new Date() } })
      .catch(() => undefined);
  }

  async bumpAttempt(id: string, attempt: number): Promise<void> {
    await this.prisma.agentRun
      .update({ where: { id }, data: { status: AgentRunStatus.QUEUED, attempt } })
      .catch(() => undefined);
  }

  async finish(
    id: string,
    status: AgentRunStatus,
    extra: { error?: string; proposedActionCount?: number } = {},
  ): Promise<void> {
    await this.prisma.agentRun
      .update({
        where: { id },
        data: {
          status,
          finishedAt: new Date(),
          ...(extra.error !== undefined && { error: extra.error }),
          ...(extra.proposedActionCount !== undefined && { proposedActionCount: extra.proposedActionCount }),
        },
      })
      .catch(() => undefined);
  }

  async listForAgent(tenantId: string, agentId: string, q: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where = { tenantId, agentId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.agentRun.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: runSelect }),
      this.prisma.agentRun.count({ where }),
    ]);
    // Attach a light summary of the handled task so the UI shows WHAT each run
    // did (category, title, outcome, resolution note) instead of a raw task id.
    const taskIds = [...new Set(items.map((r) => r.taskId).filter((x): x is string => !!x))];
    const tasks = taskIds.length
      ? await this.prisma.operationalTask.findMany({
          where: { tenantId, id: { in: taskIds } },
          select: { id: true, category: true, title: true, status: true, resolutionNote: true },
        })
      : [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const enriched = items.map((r) => ({ ...r, task: r.taskId ? byId.get(r.taskId) ?? null : null }));
    return paginated(enriched, total, page, pageSize);
  }
}
