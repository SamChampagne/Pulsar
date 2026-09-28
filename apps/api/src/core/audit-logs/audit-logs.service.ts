import { Injectable } from '@nestjs/common';
import type { AuditAction } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  tenantId: string;
  userId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort by default; an explicit transaction opts into atomic audit/rollback. */
  async log(entry: AuditEntry, transaction?: Prisma.TransactionClient): Promise<void> {
    try {
      await (transaction ?? this.prisma).auditLog.create({
        data: {
          tenantId: entry.tenantId,
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
          after: entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      // Financial writers opt into atomic audit: a failed audit must roll back their transaction.
      if (transaction) throw err;
      console.error('Audit log write failed', err);
    }
  }

  async list(tenantId: string, query: ListQueryDto & { entityType?: string; entityId?: string }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
}
