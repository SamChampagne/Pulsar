import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, PermissionKey } from '@pulsar/shared';
import { ALL_PERMISSION_KEYS, AgentAutonomy, AgentStatus, autoApprovedTiers, computeTrustScore, deriveAgentKpis, mergeTimeline, runtimeBlockMessage, type AgentKpiRaw, type TimelineEntry } from '@pulsar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListQueryDto } from '../../common/dto/list-query.dto';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentWorkerService } from '../operating/agent-worker.service';
import { AgentRunsService } from '../operating/agent-runs.service';
import type { AgentCaps, AgentPrincipal } from './agent-principal';
import { mintAgentSessionToken, verifyAgentSessionTokenFull } from './agent-session-token';
import { TOOL_BY_NAME, TOOL_REGISTRY } from './tool-registry';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const agentSelect = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  caps: true,
  prefix: true,
  status: true,
  lastUsedAt: true,
  lastSeenAt: true,
  lastRunAt: true,
  createdAt: true,
  revokedAt: true,
  persona: true,
  role: true,
  model: true,
  autonomyLevel: true,
  avatar: true,
  breakerTrippedAt: true,
} as const;

@Injectable()
export class AgentsService {
  private readonly sessionSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentRuntimeService))
    private readonly runtime: AgentRuntimeService,
    @Inject(forwardRef(() => AgentWorkerService))
    private readonly worker: AgentWorkerService,
    private readonly runs: AgentRunsService,
  ) {
    const secret = process.env.AGENT_SESSION_SECRET ?? process.env.JWT_SECRET;
    if (!secret) throw new Error('AGENT_SESSION_SECRET or JWT_SECRET must be set');
    this.sessionSecret = secret;
  }

  mintSessionToken(agentId: string, ttlSeconds = 300, triggeredByRef?: string): string {
    return mintAgentSessionToken(agentId, this.sessionSecret, ttlSeconds, { triggeredByRef });
  }

  /** One hidden DISABLED user PER agent — audit shows the specific agent, never loginable (rule 13). */
  private async createServiceUser(tenantId: string, name: string): Promise<string> {
    const created = await this.prisma.user.create({
      data: {
        tenantId,
        email: `agent+${randomBytes(8).toString('hex')}@pulsar.local`,
        passwordHash: sha256(randomBytes(32).toString('hex')),
        firstName: 'Agent',
        lastName: name.slice(0, 60),
        status: 'DISABLED',
      },
      select: { id: true },
    });
    return created.id;
  }

  list(tenantId: string) {
    return this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: agentSelect,
    });
  }

  private validatePolicies(caps?: AgentCaps): void {
    const rules = caps?.policies;
    if (!rules) return;
    const valid = new Set(['AUTO', 'PROPOSE', 'DENY']);
    for (const r of rules) {
      if (!valid.has(r.effect)) throw new BadRequestException(`Invalid policy effect "${r.effect}"`);
      if (r.tool !== undefined && !TOOL_BY_NAME.has(r.tool)) throw new BadRequestException(`Unknown tool in policy "${r.tool}"`);
      if (r.maxAmount !== undefined && r.maxAmount < 0) throw new BadRequestException('policy maxAmount must be >= 0');
    }
  }

  private applyAutonomy(level: AgentAutonomy | undefined, caps: AgentCaps): AgentCaps {
    const tiers = autoApprovedTiers(level ?? AgentAutonomy.PROPOSE);
    const byTier = TOOL_REGISTRY.filter((t) => tiers.includes(t.tier)).map((t) => t.name);
    const explicit = caps.autoApprove ?? [];
    return { ...caps, autoApprove: Array.from(new Set([...byTier, ...explicit])) };
  }

  /** Returns the full key ONCE — only the hash is stored. */
  async create(
    tenantId: string,
    createdById: string,
    input: {
      name: string;
      description?: string;
      permissions: string[];
      caps?: AgentCaps;
      persona?: string;
      role?: string;
      model?: string;
      autonomyLevel?: AgentAutonomy;
      avatar?: string;
    },
  ) {
    this.validatePolicies(input.caps);
    const valid = new Set<string>(ALL_PERMISSION_KEYS);
    for (const p of input.permissions) {
      if (!valid.has(p)) throw new BadRequestException(`Unknown permission "${p}"`);
    }
    const caps = this.applyAutonomy(input.autonomyLevel, input.caps ?? {});
    const serviceUserId = await this.createServiceUser(tenantId, input.name);
    const rawKey = `ak_${randomBytes(24).toString('base64url')}`;
    const record = await this.prisma.agent.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        caps: caps as object,
        prefix: rawKey.slice(0, 11),
        secretHash: sha256(rawKey),
        serviceUserId,
        createdById,
        persona: input.persona,
        role: input.role,
        model: input.model,
        autonomyLevel: input.autonomyLevel ?? AgentAutonomy.PROPOSE,
        avatar: input.avatar,
      },
      select: agentSelect,
    });
    return { ...record, key: rawKey };
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      name?: string;
      description?: string;
      permissions?: string[];
      caps?: AgentCaps;
      persona?: string;
      role?: string;
      model?: string;
      autonomyLevel?: AgentAutonomy;
      avatar?: string;
    },
  ) {
    this.validatePolicies(input.caps);
    const existing = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Agent not found');
    if (input.permissions) {
      const valid = new Set<string>(ALL_PERMISSION_KEYS);
      for (const p of input.permissions) {
        if (!valid.has(p)) throw new BadRequestException(`Unknown permission "${p}"`);
      }
    }
    const needsAutonomyRecalc = input.autonomyLevel !== undefined || input.caps !== undefined;
    let caps: AgentCaps | undefined;
    if (needsAutonomyRecalc) {
      const currentCaps = (existing.caps ?? {}) as AgentCaps;
      caps = this.applyAutonomy(
        input.autonomyLevel ?? (existing.autonomyLevel as AgentAutonomy | undefined),
        { ...currentCaps, ...(input.caps ?? {}) },
      );
    }
    return this.prisma.agent.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.permissions !== undefined && { permissions: input.permissions }),
        ...(caps !== undefined && { caps: caps as object }),
        ...(input.persona !== undefined && { persona: input.persona }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.model !== undefined && { model: input.model }),
        ...(input.autonomyLevel !== undefined && { autonomyLevel: input.autonomyLevel }),
        ...(input.avatar !== undefined && { avatar: input.avatar }),
      },
      select: agentSelect,
    });
  }

  async getOwned(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, tenantId },
      select: { id: true, model: true, persona: true, status: true, name: true },
    });
    if (!agent || agent.status !== AgentStatus.ACTIVE) throw new NotFoundException('Agent not found');
    return agent;
  }

  async getOne(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: agentSelect });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  async activity(tenantId: string, id: string) {
    await this.getOne(tenantId, id);
    const [conversations, proposedActions] = await Promise.all([
      this.prisma.agentConversation.findMany({
        where: { tenantId, agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          createdAt: true,
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.proposedAction.findMany({
        where: { tenantId, agentId: id },
        orderBy: { proposedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          tool: true,
          status: true,
          riskTier: true,
          proposedAt: true,
          decidedAt: true,
        },
      }),
    ]);
    const stats = {
      conversations: conversations.length,
      pending: proposedActions.filter((p) => p.status === 'PENDING').length,
      executed: proposedActions.filter((p) => p.status === 'EXECUTED').length,
      rejected: proposedActions.filter((p) => p.status === 'REJECTED').length,
    };
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        messageCount: c._count.messages,
      })),
      proposedActions,
      stats,
    };
  }

  async revoke(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    await this.prisma.agent.update({
      where: { id },
      data: { status: AgentStatus.REVOKED, revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /** Hot kill switch: PAUSE (reversible) + kill in-flight Hermes sessions. */
  async pause(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === AgentStatus.REVOKED) throw new BadRequestException('Agent is revoked');
    await this.prisma.agent.update({ where: { id }, data: { status: AgentStatus.PAUSED } });
    await this.runtime.killAgentSessions(id).catch(() => undefined);
    return { status: AgentStatus.PAUSED };
  }

  async resume(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === AgentStatus.REVOKED) throw new BadRequestException('Agent is revoked');
    await this.prisma.agent.update({ where: { id }, data: { status: AgentStatus.ACTIVE } });
    return { status: AgentStatus.ACTIVE };
  }

  /** Tenant-wide emergency stop: pause every non-revoked agent. Returns the count paused. */
  async pauseAll(tenantId: string): Promise<number> {
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: { not: AgentStatus.REVOKED } },
      select: { id: true },
    });
    for (const a of agents) {
      await this.prisma.agent.update({ where: { id: a.id }, data: { status: AgentStatus.PAUSED } });
      await this.runtime.killAgentSessions(a.id).catch(() => undefined);
    }
    return agents.length;
  }

  /**
   * Manual "Run now" — enqueue the agent's oldest OPEN task.
   * Honest contract: before enqueuing, verify the runtime is installed, a provider is
   * configured and a model is connected. If not, throw a clear 503 so the UI never shows
   * a fake success. Returns the structured worker result ({ enqueued, runId, taskId, reason }).
   */
  async runNow(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status !== AgentStatus.ACTIVE) throw new BadRequestException('Agent is not active');

    // Honest gate: install → config → auth → model → last probe (pure decision, single
    // point). The agent's model override counts toward the model precondition.
    const readiness = await this.runtime.readiness(tenantId, agent.model);
    if (!readiness.ready && readiness.blockReason) {
      throw new ServiceUnavailableException(runtimeBlockMessage(readiness.blockReason, readiness.authMode));
    }

    return this.worker.runNow(tenantId, id);
  }

  /** Paginated run history (projection — no secrets, rule 26). */
  async listRuns(tenantId: string, id: string, q: ListQueryDto) {
    await this.getOne(tenantId, id); // 404 if not in tenant
    return this.runs.listForAgent(tenantId, id, q);
  }

  /** Count circuit-breaker trips for an agent from the audit trail (phase-14 maybeTripBreaker logs them). */
  private breakerTripCount(tenantId: string, agentId: string, since?: Date) {
    return this.prisma.auditLog.count({
      where: {
        tenantId,
        entityType: 'agent',
        entityId: agentId,
        after: { path: ['breakerTripped'], equals: true },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
    });
  }

  /** Gather all raw KPI counts for an agent within a window. */
  private async gatherKpiRaw(tenantId: string, agentId: string, since: Date): Promise<AgentKpiRaw> {
    const pa = (extra: object) => this.prisma.proposedAction.count({ where: { tenantId, agentId, proposedAt: { gte: since }, ...extra } });
    const run = (extra: object) => this.prisma.agentRun.count({ where: { tenantId, agentId, createdAt: { gte: since }, ...extra } });
    const [
      executed, autoApproved, pending, rejected, failed,
      runsTotal, runsSucceeded, runsFailed, runsSkipped, runsKilled,
      breakerTrips, tasksResolved, finishedRuns,
    ] = await Promise.all([
      pa({ status: 'EXECUTED' }),
      pa({ status: 'EXECUTED', autoApproved: true }),
      pa({ status: 'PENDING' }),
      pa({ status: 'REJECTED' }),
      pa({ status: 'FAILED' }),
      run({}),
      run({ status: 'SUCCEEDED' }),
      run({ status: 'FAILED' }),
      run({ status: 'SKIPPED' }),
      run({ status: 'KILLED' }),
      this.breakerTripCount(tenantId, agentId, since),
      this.prisma.operationalTask.count({ where: { tenantId, assigneeAgentId: agentId, status: 'RESOLVED', resolvedAt: { gte: since } } }),
      this.prisma.agentRun.findMany({
        where: { tenantId, agentId, createdAt: { gte: since }, startedAt: { not: null }, finishedAt: { not: null } },
        select: { startedAt: true, finishedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    const runLatenciesMs = finishedRuns
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
    return { executed, autoApproved, pending, rejected, failed, runsTotal, runsSucceeded, runsFailed, runsSkipped, runsKilled, runLatenciesMs, breakerTrips, tasksResolved };
  }

  /** Per-agent KPI rollup (computed on read). */
  async kpis(tenantId: string, id: string, days = 30) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!agent) throw new NotFoundException('Agent not found');
    const since = new Date(Date.now() - days * 86_400_000);
    return deriveAgentKpis(await this.gatherKpiRaw(tenantId, id, since));
  }

  /** Tenant-wide manager dashboard: per-agent KPI summaries + aggregate rollup (computed on read). */
  async controlTower(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const agents = await this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, role: true, avatar: true, status: true, autonomyLevel: true, breakerTrippedAt: true },
    });
    const items = await Promise.all(
      agents.map(async (a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        status: a.status,
        autonomyLevel: a.autonomyLevel,
        breakerTrippedAt: a.breakerTrippedAt,
        kpis: deriveAgentKpis(await this.gatherKpiRaw(tenantId, a.id, since)),
      })),
    );
    const rollup = {
      agents: items.length,
      active: items.filter((i) => i.status === 'ACTIVE').length,
      paused: items.filter((i) => i.status === 'PAUSED').length,
      revoked: items.filter((i) => i.status === 'REVOKED').length,
      totalActions: items.reduce((s, i) => s + i.kpis.actions.total, 0),
      pendingApprovals: items.reduce((s, i) => s + i.kpis.actions.pending, 0),
      totalBreakerTrips: items.reduce((s, i) => s + i.kpis.breakerTrips, 0),
      totalTasksResolved: items.reduce((s, i) => s + i.kpis.tasksResolved, 0),
    };
    return { items, rollup };
  }

  /** Unified per-agent activity/audit timeline (runs + actions + lifecycle audits), newest first. */
  async timeline(tenantId: string, id: string, limit = 50) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!agent) throw new NotFoundException('Agent not found');
    const [runs, actions, audits] = await Promise.all([
      this.prisma.agentRun.findMany({ where: { tenantId, agentId: id }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, trigger: true, status: true, taskId: true, createdAt: true } }),
      this.prisma.proposedAction.findMany({ where: { tenantId, agentId: id }, orderBy: { proposedAt: 'desc' }, take: limit, select: { id: true, tool: true, status: true, autoApproved: true, proposedAt: true } }),
      this.prisma.auditLog.findMany({ where: { tenantId, entityType: 'agent', entityId: id }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, action: true, after: true, createdAt: true } }),
    ]);
    const runEntries: TimelineEntry[] = runs.map((r) => ({
      at: r.createdAt.toISOString(),
      kind: 'run',
      summary: `Run ${r.trigger} → ${r.status}${r.taskId ? ` (task ${r.taskId})` : ''}`,
      ref: r.id,
    }));
    const actionEntries: TimelineEntry[] = actions.map((a) => ({
      at: a.proposedAt.toISOString(),
      kind: 'action',
      summary: `${a.autoApproved ? 'Auto' : 'Proposé'} ${a.tool} → ${a.status}`,
      ref: a.id,
    }));
    const auditEntries: TimelineEntry[] = audits.map((a) => {
      const after = (a.after ?? {}) as { breakerTripped?: boolean };
      return {
        at: a.createdAt.toISOString(),
        kind: 'lifecycle',
        summary: after.breakerTripped ? 'Circuit breaker déclenché' : `Audit ${a.action}`,
        ref: a.id,
      };
    });
    return mergeTimeline([runEntries, actionEntries, auditEntries], limit);
  }

  /** Trust score from the agent's track record (proposals + runs). Computed on read. */
  async trust(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId }, select: { id: true, autonomyLevel: true } });
    if (!agent) throw new NotFoundException('Agent not found');
    const [executed, rejected, failed, runsSucceeded, runsTotal] = await Promise.all([
      this.prisma.proposedAction.count({ where: { tenantId, agentId: id, status: 'EXECUTED' } }),
      this.prisma.proposedAction.count({ where: { tenantId, agentId: id, status: 'REJECTED' } }),
      this.prisma.proposedAction.count({ where: { tenantId, agentId: id, status: 'FAILED' } }),
      this.prisma.agentRun.count({ where: { tenantId, agentId: id, status: 'SUCCEEDED' } }),
      this.prisma.agentRun.count({ where: { tenantId, agentId: id } }),
    ]);
    const breakerTrips = await this.breakerTripCount(tenantId, id);
    const result = computeTrustScore(
      { executed, rejected, failed, runsSucceeded, runsTotal, breakerTrips },
      agent.autonomyLevel as AgentAutonomy,
    );
    return { ...result, currentLevel: agent.autonomyLevel };
  }

  /** Human reset of a tripped circuit breaker. */
  async resetBreaker(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    await this.prisma.agent.update({ where: { id }, data: { breakerTrippedAt: null } });
    return { breakerReset: true };
  }

  /** Resolve a raw agent key into a full principal (service user + caps + scoped permissions). */
  async validateKey(rawKey: string): Promise<AgentPrincipal> {
    const parsed = verifyAgentSessionTokenFull(rawKey, this.sessionSecret);
    const agent = parsed
      ? await this.prisma.agent.findUnique({ where: { id: parsed.agentId } })
      : await this.prisma.agent.findUnique({ where: { secretHash: sha256(rawKey) } });
    // Only ACTIVE agents may act. PAUSED is the hot kill switch (rule 28) and
    // REVOKED is permanent — neither must validate, or a stale/replayed session
    // token could still drive MCP tool calls after the human pulled the switch.
    if (!agent || agent.status !== AgentStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid agent key');
    }
    void this.prisma.agent
      .update({ where: { id: agent.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    const user: AuthUser = {
      id: agent.serviceUserId,
      tenantId: agent.tenantId,
      email: `agent:${agent.name}`,
      firstName: 'Agent',
      lastName: agent.name,
      permissions: agent.permissions as PermissionKey[],
    };
    return {
      agentId: agent.id,
      name: agent.name,
      caps: (agent.caps ?? {}) as AgentCaps,
      user,
      triggeredByRef: parsed?.triggeredByRef,
      autonomyLevel: agent.autonomyLevel as AgentPrincipal['autonomyLevel'],
    };
  }
}
