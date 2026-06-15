import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  OperationalTaskStatus,
  TaskAssigneeType,
  canTransitionOperationalTask,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginationArgs, paginated } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

export interface ListFilter extends ListQueryDto {
  status?: OperationalTaskStatus;
  type?: string;
  category?: string;
  assigneeType?: TaskAssigneeType;
}

export interface AssignBody {
  assigneeType: TaskAssigneeType;
  assigneeUserId?: string;
  assigneeAgentId?: string;
}

@Injectable()
export class OperationalTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, f: ListFilter) {
    const { page, pageSize, skip, take } = paginationArgs(f);
    const where: Prisma.OperationalTaskWhereInput = {
      tenantId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.type ? { type: f.type as never } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.assigneeType ? { assigneeType: f.assigneeType } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationalTask.findMany({
        where,
        skip,
        take,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.operationalTask.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException(`OperationalTask ${id} not found`);
    const proposedActions = await this.prisma.proposedAction.findMany({
      where: { tenantId, triggeredByRef: `task:${id}` },
      orderBy: { proposedAt: 'desc' },
      take: 50,
    });
    return { ...task, proposedActions };
  }

  /**
   * Atomic state-machine transition.
   * Uses updateMany with the expected current status so concurrent updates
   * produce count === 0 (conflict) rather than a silent overwrite.
   */
  private async transition(
    tenantId: string,
    id: string,
    to: OperationalTaskStatus,
    extra: Partial<{
      resolvedById: string;
      resolutionNote: string;
      resolvedAt: Date;
    }>,
    actorId: string,
  ) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException(`OperationalTask ${id} not found`);

    if (!canTransitionOperationalTask(task.status as OperationalTaskStatus, to)) {
      throw new BadRequestException(
        `Cannot transition OperationalTask from ${task.status} to ${to}`,
      );
    }

    const result = await this.prisma.operationalTask.updateMany({
      where: { id, tenantId, status: task.status },
      data: { status: to, ...extra },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        `Concurrent update detected on OperationalTask ${id} — please retry`,
      );
    }

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'OperationalTask',
      entityId: id,
      before: { status: task.status },
      after: { status: to, ...extra },
    });

    return this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
  }

  async resolve(tenantId: string, id: string, userId: string, note?: string) {
    return this.transition(
      tenantId,
      id,
      OperationalTaskStatus.RESOLVED,
      {
        resolvedById: userId,
        resolutionNote: note,
        resolvedAt: new Date(),
      },
      userId,
    );
  }

  async dismiss(tenantId: string, id: string, userId: string, note?: string) {
    return this.transition(
      tenantId,
      id,
      OperationalTaskStatus.DISMISSED,
      {
        resolvedById: userId,
        resolutionNote: note,
        resolvedAt: new Date(),
      },
      userId,
    );
  }

  async start(tenantId: string, id: string, actorId: string) {
    return this.transition(tenantId, id, OperationalTaskStatus.IN_PROGRESS, {}, actorId);
  }

  async addNote(tenantId: string, id: string, userId: string, note: string) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException(`OperationalTask ${id} not found`);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'OperationalTask',
      entityId: id,
      after: { note },
    });
    return { ok: true };
  }

  listForAgent(tenantId: string, agentId: string) {
    return this.prisma.operationalTask.findMany({
      where: {
        tenantId,
        assigneeAgentId: agentId,
        status: { in: [OperationalTaskStatus.OPEN, OperationalTaskStatus.IN_PROGRESS] },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  }

  getForTenant(tenantId: string, id: string) {
    return this.get(tenantId, id);
  }

  async assign(tenantId: string, id: string, actorId: string, body: AssignBody) {
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException(`OperationalTask ${id} not found`);

    await this.prisma.operationalTask.updateMany({
      where: { id, tenantId },
      data: {
        assigneeType: body.assigneeType,
        assigneeUserId: body.assigneeType === TaskAssigneeType.HUMAN ? body.assigneeUserId ?? null : null,
        assigneeAgentId: body.assigneeType === TaskAssigneeType.AGENT ? body.assigneeAgentId ?? null : null,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: AuditAction.UPDATE,
      entityType: 'OperationalTask',
      entityId: id,
      before: {
        assigneeType: task.assigneeType,
        assigneeUserId: task.assigneeUserId,
        assigneeAgentId: task.assigneeAgentId,
      },
      after: body,
    });

    return this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
  }
}
