import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AUTOMATION_EVENT_CATALOG } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAutomationRuleDto, UpdateAutomationRuleDto } from './dto/automation-rule.dto';

@Injectable()
export class AutomationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  list(tenantId: string) {
    return this.prisma.automationRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, id: string) {
    const rule = await this.prisma.automationRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException(`AutomationRule ${id} not found`);
    return rule;
  }

  async create(tenantId: string, userId: string, dto: CreateAutomationRuleDto) {
    // Default subjectField to the event's catalog default when omitted, so the
    // shared resolver always has a reliable subjectId path (e.g. stop.delayed → stopId).
    const action = { ...dto.action };
    if (!action.subjectField) {
      const descriptor = AUTOMATION_EVENT_CATALOG.find((e) => e.type === dto.eventType);
      if (descriptor) action.subjectField = descriptor.defaultSubjectField;
    }

    const created = await this.prisma.automationRule.create({
      data: {
        tenantId,
        name: dto.name,
        eventType: dto.eventType,
        enabled: dto.enabled ?? true,
        match: dto.match,
        conditions: dto.conditions as unknown as Prisma.InputJsonValue,
        action: action as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'AutomationRule',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  async update(tenantId: string, id: string, userId: string, dto: UpdateAutomationRuleDto) {
    const existing = await this.prisma.automationRule.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`AutomationRule ${id} not found`);

    const data: Prisma.AutomationRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.eventType !== undefined) data.eventType = dto.eventType;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.match !== undefined) data.match = dto.match;
    if (dto.conditions !== undefined) {
      data.conditions = dto.conditions as unknown as Prisma.InputJsonValue;
    }
    if (dto.action !== undefined) {
      // Re-apply the subjectField default if absent, keyed on the effective event type.
      const action = { ...dto.action };
      if (!action.subjectField) {
        const eventType = dto.eventType ?? existing.eventType;
        const descriptor = AUTOMATION_EVENT_CATALOG.find((e) => e.type === eventType);
        if (descriptor) action.subjectField = descriptor.defaultSubjectField;
      }
      data.action = action as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.automationRule.update({ where: { id }, data });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'AutomationRule',
      entityId: id,
      before: existing,
      after: updated,
    });

    return updated;
  }

  async remove(tenantId: string, id: string, userId: string) {
    const existing = await this.prisma.automationRule.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`AutomationRule ${id} not found`);

    await this.prisma.automationRule.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'AutomationRule',
      entityId: id,
      before: existing,
    });

    return { id };
  }
}
