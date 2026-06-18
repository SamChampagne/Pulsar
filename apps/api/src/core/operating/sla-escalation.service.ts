import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const SLA_ESCALATION_BATCH = 200;

@Injectable()
export class SlaEscalationService {
  private readonly logger = new Logger(SlaEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runCron(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(
        `SLA escalation sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Find tasks whose SLA has expired and have not yet been escalated.
   * Race-safe: claim via updateMany({ escalatedAt: null }) before acting.
   * Does NOT change task status.
   * Per-task try/catch — a failure on one task never stops the rest.
   */
  async sweep(nowMs = Date.now()): Promise<void> {
    const now = new Date(nowMs);

    const overdue = await this.prisma.operationalTask.findMany({
      where: {
        status: { in: [OperationalTaskStatus.OPEN, OperationalTaskStatus.IN_PROGRESS] },
        slaDueAt: { lt: now },
        escalatedAt: null,
      },
      select: { id: true, tenantId: true, title: true, category: true },
      take: SLA_ESCALATION_BATCH,
    });

    for (const task of overdue) {
      try {
        const claimed = await this.prisma.operationalTask.updateMany({
          where: { id: task.id, escalatedAt: null },
          data: { escalatedAt: now },
        });

        if (claimed.count === 0) {
          // Another worker claimed this task concurrently — skip.
          continue;
        }

        // Notify (best-effort): create an in-app notification for the tenant.
        try {
          await this.prisma.notification.create({
            data: {
              tenantId: task.tenantId,
              level: 'WARNING',
              title: `SLA breached: ${task.title}`,
              body: `Operational task (${task.category}) has exceeded its SLA deadline.`,
              payload: { taskId: task.id, eventType: 'SLA_BREACHED' } as never,
            },
          });
        } catch (notifyErr) {
          this.logger.warn(
            `SLA notification failed for task ${task.id}: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`,
          );
        }

        // Audit the escalation.
        await this.audit.log({
          tenantId: task.tenantId,
          action: AuditAction.UPDATE,
          entityType: 'OperationalTask',
          entityId: task.id,
          after: { escalatedAt: now.toISOString(), reason: 'SLA_BREACHED' },
        });
      } catch (err) {
        this.logger.error(
          `SLA escalation failed for task ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
