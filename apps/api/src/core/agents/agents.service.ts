import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, PermissionKey } from '@pulsar/shared';
import { ALL_PERMISSION_KEYS, AgentAutonomy, AgentStatus, autoApprovedTiers } from '@pulsar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListQueryDto } from '../../common/dto/list-query.dto';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentWorkerService } from '../operating/agent-worker.service';
import { AgentRunsService } from '../operating/agent-runs.service';
import type { AgentCaps, AgentPrincipal } from './agent-principal';
import { mintAgentSessionToken, verifyAgentSessionTokenFull } from './agent-session-token';
import { TOOL_REGISTRY } from './tool-registry';

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

  /** Manual "Run now" — enqueue the agent's oldest OPEN task. */
  async runNow(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status !== AgentStatus.ACTIVE) throw new BadRequestException('Agent is not active');
    const enqueued = await this.worker.runNow(tenantId, id);
    return { enqueued };
  }

  /** Paginated run history (projection — no secrets, rule 26). */
  async listRuns(tenantId: string, id: string, q: ListQueryDto) {
    await this.getOne(tenantId, id); // 404 if not in tenant
    return this.runs.listForAgent(tenantId, id, q);
  }

  /** Resolve a raw agent key into a full principal (service user + caps + scoped permissions). */
  async validateKey(rawKey: string): Promise<AgentPrincipal> {
    const parsed = verifyAgentSessionTokenFull(rawKey, this.sessionSecret);
    const agent = parsed
      ? await this.prisma.agent.findUnique({ where: { id: parsed.agentId } })
      : await this.prisma.agent.findUnique({ where: { secretHash: sha256(rawKey) } });
    if (!agent || agent.status === AgentStatus.REVOKED) {
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
    };
  }
}
