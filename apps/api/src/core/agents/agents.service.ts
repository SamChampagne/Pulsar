import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, PermissionKey } from '@pulsar/shared';
import { ALL_PERMISSION_KEYS, AgentAutonomy, AgentStatus, autoApprovedTiers } from '@pulsar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps, AgentPrincipal } from './agent-principal';
import { mintAgentSessionToken, verifyAgentSessionToken } from './agent-session-token';
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

  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.AGENT_SESSION_SECRET ?? process.env.JWT_SECRET;
    if (!secret) throw new Error('AGENT_SESSION_SECRET or JWT_SECRET must be set');
    this.sessionSecret = secret;
  }

  mintSessionToken(agentId: string, ttlSeconds = 300): string {
    return mintAgentSessionToken(agentId, this.sessionSecret, ttlSeconds);
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
    if (!agent || agent.status === AgentStatus.REVOKED) throw new NotFoundException('Agent not found');
    return agent;
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

  /** Resolve a raw agent key into a full principal (service user + caps + scoped permissions). */
  async validateKey(rawKey: string): Promise<AgentPrincipal> {
    const sessionAgentId = verifyAgentSessionToken(rawKey, this.sessionSecret);
    const agent = sessionAgentId
      ? await this.prisma.agent.findUnique({ where: { id: sessionAgentId } })
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
    return { agentId: agent.id, name: agent.name, caps: (agent.caps ?? {}) as AgentCaps, user };
  }
}
