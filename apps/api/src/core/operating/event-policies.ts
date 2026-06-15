import { Injectable } from '@nestjs/common';
import { AgentStatus } from '@pulsar/database';
import type { TaskSpec } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** Resolve which always-on agent (if any) should handle a category for a tenant. */
@Injectable()
export class TaskAssignmentResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** First ACTIVE agent with caps.alwaysOn === true and the category in caps.handlesCategories. */
  async resolveAgent(tenantId: string, spec: TaskSpec): Promise<string | null> {
    if (spec.assignHint !== 'AUTO') return null;
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: AgentStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true, caps: true },
    });
    for (const a of agents) {
      const caps = (a.caps ?? {}) as { alwaysOn?: boolean; handlesCategories?: string[] };
      if (caps.alwaysOn && (caps.handlesCategories ?? []).includes(spec.category)) return a.id;
    }
    return null;
  }
}
