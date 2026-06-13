import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, PermissionKey } from '@pulsar/shared';
import { ALL_PERMISSION_KEYS, AgentStatus } from '@pulsar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps, AgentPrincipal } from './agent-principal';

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
} as const;

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Returns the full key ONCE — only the hash is stored. */
  async create(
    tenantId: string,
    createdById: string,
    input: { name: string; description?: string; permissions: string[]; caps?: AgentCaps },
  ) {
    const valid = new Set<string>(ALL_PERMISSION_KEYS);
    for (const p of input.permissions) {
      if (!valid.has(p)) throw new BadRequestException(`Unknown permission "${p}"`);
    }
    const serviceUserId = await this.createServiceUser(tenantId, input.name);
    const rawKey = `ak_${randomBytes(24).toString('base64url')}`;
    const record = await this.prisma.agent.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        caps: (input.caps ?? {}) as object,
        prefix: rawKey.slice(0, 11),
        secretHash: sha256(rawKey),
        serviceUserId,
        createdById,
      },
      select: agentSelect,
    });
    return { ...record, key: rawKey };
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
    const agent = await this.prisma.agent.findUnique({ where: { secretHash: sha256(rawKey) } });
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
