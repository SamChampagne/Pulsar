import { Injectable } from '@nestjs/common';
import { AgentStatus } from '@pulsar/database';
import { mrpWorkerEligible, type TaskSpec } from '@pulsar/shared';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AgentCaps } from '../agents/agent-principal';

/** Resolve which always-on agent (if any) should handle a category for a tenant. */
@Injectable()
export class TaskAssignmentResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  /** First ACTIVE agent with caps.alwaysOn === true and the category in caps.handlesCategories. */
  async resolveAgent(tenantId: string, spec: TaskSpec): Promise<string | null> {
    if (spec.assignHint !== 'AUTO') return null;
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: AgentStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true, caps: true, permissions: true },
    });
    for (const a of agents) {
      if (
        spec.category === 'MRP_REVIEW' &&
        !mrpWorkerEligible(
          { permissions: a.permissions as string[], caps: a.caps },
          await this.modules.getEnabledKeys(tenantId),
          spec.details.requiresCrm === true,
        )
      )
        continue;
      const caps = (a.caps ?? {}) as AgentCaps;
      if (caps.alwaysOn && (caps.handlesCategories ?? []).includes(spec.category)) return a.id;
    }
    return null;
  }
}
