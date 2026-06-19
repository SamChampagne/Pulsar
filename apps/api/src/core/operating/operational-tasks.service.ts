import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  OperationalTaskStatus,
  TaskAssigneeType,
  canTransitionOperationalTask,
  isSlaBreached,
  mergeTimeline,
  type TimelineEntry,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginationArgs, paginated } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface NoteEntry {
  at: string;
  byUserId: string;
  text: string;
}

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
      select: { id: true, tool: true, riskTier: true, status: true, triggeredByRef: true, proposedAt: true, decidedAt: true },
    });
    const slaBreached = isSlaBreached(
      task.slaDueAt ? task.slaDueAt.toISOString() : null,
      Date.now(),
    );
    return {
      ...task,
      caseNumber: task.caseNumber,
      slaDueAt: task.slaDueAt,
      escalatedAt: task.escalatedAt,
      notes: task.notes,
      slaBreached,
      proposedActions,
    };
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

  /**
   * Append a note to an OperationalTask's notes JSON array.
   * Rejects empty text (400). Audited as UPDATE.
   */
  async addNote(tenantId: string, id: string, userId: string, text: string) {
    if (!text || !text.trim()) {
      throw new BadRequestException('Note text must not be empty');
    }
    const task = await this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException(`OperationalTask ${id} not found`);

    const existingNotes = Array.isArray(task.notes) ? (task.notes as unknown as NoteEntry[]) : [];
    const newNote: NoteEntry = {
      at: new Date().toISOString(),
      byUserId: userId,
      text: text.trim(),
    };
    const updatedNotes = [...existingNotes, newNote];

    await this.prisma.operationalTask.updateMany({
      where: { id, tenantId },
      data: { notes: updatedNotes as unknown as Prisma.InputJsonValue },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'OperationalTask',
      entityId: id,
      before: { notes: existingNotes.length },
      after: { noteAdded: newNote },
    });

    return this.prisma.operationalTask.findFirst({ where: { id, tenantId } });
  }

  /**
   * Derived, read-time timeline for a task.
   * Merges audit log entries, proposed actions, and inline notes into a
   * unified TimelineEntry[] sorted newest-first (max 100 entries).
   */
  async timeline(tenantId: string, id: string): Promise<TimelineEntry[]> {
    const task = await this.prisma.operationalTask.findFirst({
      where: { id, tenantId },
      select: { notes: true },
    });
    if (!task) throw new NotFoundException(`OperationalTask ${id} not found`);

    const [auditLogs, proposedActions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { tenantId, entityType: 'OperationalTask', entityId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, createdAt: true, action: true, before: true, after: true, userId: true },
      }),
      this.prisma.proposedAction.findMany({
        where: { tenantId, triggeredByRef: `task:${id}` },
        orderBy: { proposedAt: 'desc' },
        take: 200,
        select: { id: true, proposedAt: true, tool: true, status: true, riskTier: true },
      }),
    ]);

    const auditEntries: TimelineEntry[] = auditLogs.map((log) => ({
      at: log.createdAt.toISOString(),
      kind: 'audit',
      summary: `${log.action}${log.userId ? ` by ${log.userId}` : ''}`,
      ref: log.id,
    }));

    const actionEntries: TimelineEntry[] = proposedActions.map((pa) => ({
      at: pa.proposedAt.toISOString(),
      kind: 'action',
      summary: `${pa.tool} — ${pa.status} (${pa.riskTier})`,
      ref: pa.id,
    }));

    const rawNotes = Array.isArray(task.notes) ? (task.notes as unknown as NoteEntry[]) : [];
    const noteEntries: TimelineEntry[] = rawNotes.map((n) => ({
      at: n.at,
      kind: 'note',
      summary: n.text,
      ref: n.byUserId,
    }));

    return mergeTimeline([auditEntries, actionEntries, noteEntries], 100);
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
