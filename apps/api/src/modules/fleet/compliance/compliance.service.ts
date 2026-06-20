import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ComplianceSubject, computeComplianceStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService, OwnedEntity } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { ComplianceListQueryDto, CreateComplianceDocumentDto } from './dto/compliance.dto';

/**
 * Compliance documents for fleet subjects (vehicle / trailer / driver). The
 * subject is a soft polymorphic FK (no Prisma relation) so creates validate
 * ownership of the referenced subject explicitly (rule 9). The expiry status
 * (VALID / EXPIRING / EXPIRED) is COMPUTED on read, never persisted (rule 32).
 * Everything is tenant-scoped (rule 1); create/delete are audited (rule 6).
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  private assertSubjectOwned(tenantId: string, subjectType: ComplianceSubject, subjectId: string) {
    const entity: OwnedEntity =
      subjectType === ComplianceSubject.VEHICLE
        ? 'vehicle'
        : subjectType === ComplianceSubject.TRAILER
          ? 'trailer'
          : 'driver';
    return this.ownership.assertOwned(entity, subjectId, tenantId);
  }

  async list(tenantId: string, query: ComplianceListQueryDto, now = Date.now()) {
    const { complianceExpiringWindowDays } = await this.moduleSettings.resolve(tenantId, 'fleet');
    const warnDays = complianceExpiringWindowDays as number;
    const docs = await this.prisma.complianceDocument.findMany({
      where: {
        tenantId,
        ...(query.subjectType ? { subjectType: query.subjectType } : {}),
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });
    return docs.map((doc) => ({ ...doc, status: computeComplianceStatus(doc.expiresAt, now, warnDays) }));
  }

  async expiring(tenantId: string, days = 30, now = Date.now()) {
    const { complianceExpiringWindowDays } = await this.moduleSettings.resolve(tenantId, 'fleet');
    const warnDays = complianceExpiringWindowDays as number;
    const docs = await this.prisma.complianceDocument.findMany({
      where: { tenantId, expiresAt: { lte: new Date(now + days * 86_400_000) } },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });
    return docs.map((doc) => ({ ...doc, status: computeComplianceStatus(doc.expiresAt, now, warnDays) }));
  }

  async get(tenantId: string, id: string, now = Date.now()) {
    const { complianceExpiringWindowDays } = await this.moduleSettings.resolve(tenantId, 'fleet');
    const warnDays = complianceExpiringWindowDays as number;
    const doc = await this.prisma.complianceDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Compliance document not found');
    return { ...doc, status: computeComplianceStatus(doc.expiresAt, now, warnDays) };
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateComplianceDocumentDto,
    now = Date.now(),
  ) {
    const { complianceExpiringWindowDays } = await this.moduleSettings.resolve(tenantId, 'fleet');
    const warnDays = complianceExpiringWindowDays as number;
    await this.assertSubjectOwned(tenantId, dto.subjectType, dto.subjectId);

    const doc = await this.prisma.complianceDocument.create({
      data: {
        tenantId,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        docType: dto.docType,
        reference: dto.reference ?? null,
        issuedAt: dto.issuedAt ?? null,
        expiresAt: dto.expiresAt,
        documentId: dto.documentId ?? null,
        notes: dto.notes ?? null,
        createdById: userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'compliance-document',
      entityId: doc.id,
      after: {
        subjectType: doc.subjectType,
        subjectId: doc.subjectId,
        docType: doc.docType,
        expiresAt: doc.expiresAt,
      },
    });
    return { ...doc, status: computeComplianceStatus(doc.expiresAt, now, warnDays) };
  }

  async remove(tenantId: string, userId: string, id: string) {
    const { count } = await this.prisma.complianceDocument.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('Compliance document not found');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'compliance-document',
      entityId: id,
    });
    return { id, deleted: true };
  }
}
