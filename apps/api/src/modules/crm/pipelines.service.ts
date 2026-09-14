import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  CrmDealStage,
  DEFAULT_CRM_STAGES,
  validateCrmPipelineStages,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CreatePipelineDto, SavePipelineDto } from './dto/pipeline.dto';

const include = { stages: { where: { archived: false }, orderBy: { position: 'asc' as const } } };
@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Lazy, idempotent provisioning also covers tenants created after the migration. */
  async defaultPipeline(tenantId: string) {
    return this.prisma.crmPipeline
      .upsert({
        where: { tenantId_key: { tenantId, key: 'default' } },
        update: {},
        create: {
          tenantId,
          key: 'default',
          name: 'Ventes',
          stages: {
            create: DEFAULT_CRM_STAGES.map((s, position) => ({ ...s, tenantId, position })),
          },
        },
        include,
      })
      .catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          return this.prisma.crmPipeline.findUniqueOrThrow({
            where: { tenantId_key: { tenantId, key: 'default' } },
            include,
          });
        throw error;
      });
  }
  async list(tenantId: string) {
    await this.defaultPipeline(tenantId);
    return this.prisma.crmPipeline.findMany({
      where: { tenantId },
      include,
      orderBy: { createdAt: 'asc' },
    });
  }
  async get(tenantId: string, id: string) {
    const pipeline = await this.prisma.crmPipeline.findFirst({ where: { tenantId, id }, include });
    if (!pipeline) throw new NotFoundException('Pipeline introuvable');
    return pipeline;
  }
  async create(tenantId: string, userId: string, dto: CreatePipelineDto) {
    if (!dto.name.trim()) throw new BadRequestException('Le nom du pipeline est requis');
    const pipeline = await this.prisma.crmPipeline.create({
      data: {
        tenantId,
        key: randomUUID(),
        name: dto.name.trim(),
        stages: { create: DEFAULT_CRM_STAGES.map((s, position) => ({ ...s, tenantId, position })) },
      },
      include,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-pipeline',
      entityId: pipeline.id,
      after: { name: pipeline.name },
    });
    return pipeline;
  }
  async save(tenantId: string, userId: string, id: string, dto: SavePipelineDto) {
    const error = validateCrmPipelineStages(dto.stages);
    if (error || !dto.name.trim())
      throw new BadRequestException(error ?? 'Le nom du pipeline est requis');
    const ids = dto.stages.flatMap((s) => (s.id ? [s.id] : []));
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Colonne dupliquée');
    await this.prisma.$transaction(async (tx) => {
      const pipeline = await tx.crmPipeline.findFirst({
        where: { id, tenantId },
        include: { stages: true },
      });
      if (!pipeline) throw new NotFoundException('Pipeline introuvable');
      const claim = await tx.crmPipeline.updateMany({
        where: { id, tenantId, revision: dto.revision },
        data: { name: dto.name.trim(), revision: { increment: 1 } },
      });
      if (!claim.count)
        throw new ConflictException('Le pipeline a changé. Rechargez avant de modifier.');
      if (ids.some((stageId) => !pipeline.stages.some((s) => s.id === stageId && !s.archived)))
        throw new BadRequestException('Une colonne ne fait pas partie de ce pipeline');
      for (const stage of pipeline.stages.filter((s) => !s.archived)) {
        const next = dto.stages.find((s) => s.id === stage.id);
        if (next && next.kind !== stage.kind)
          throw new BadRequestException(
            'La phase métier d’une colonne existante est immuable. Créez une nouvelle colonne.',
          );
        if (!next) {
          const occupied = await tx.crmDeal.count({
            where: {
              tenantId,
              OR: [
                { pipelineStageId: stage.id },
                ...(pipeline.key === 'default' ? [{ pipelineId: null, stage: stage.kind }] : []),
              ],
            },
          });
          if (occupied)
            throw new ConflictException(
              `Déplacez les opportunités de « ${stage.name} » avant de retirer cette colonne.`,
            );
          await tx.crmPipelineStage.updateMany({
            where: { id: stage.id, tenantId },
            data: { archived: true },
          });
          await tx.crmSequence.updateMany({
            where: { tenantId, pipelineStageId: stage.id },
            data: { enabled: false },
          });
        }
      }
      for (const [position, stage] of dto.stages.entries()) {
        if (stage.id)
          await tx.crmPipelineStage.updateMany({
            where: { id: stage.id, tenantId, pipelineId: id },
            data: { name: stage.name.trim(), position },
          });
        else
          await tx.crmPipelineStage.create({
            data: { tenantId, pipelineId: id, name: stage.name.trim(), kind: stage.kind, position },
          });
      }
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-pipeline',
      entityId: id,
      after: { name: dto.name.trim(), columns: dto.stages.map((s) => s.name.trim()) },
    });
    return this.get(tenantId, id);
  }
  async resolveStage(
    tenantId: string,
    options: { pipelineId?: string | null; stageId?: string; kind?: CrmDealStage },
  ) {
    if (options.stageId) {
      const stage = await this.prisma.crmPipelineStage.findFirst({
        where: { tenantId, id: options.stageId, archived: false },
      });
      if (!stage || (options.pipelineId && stage.pipelineId !== options.pipelineId))
        throw new BadRequestException('Colonne introuvable dans ce pipeline');
      return stage;
    }
    const pipeline = options.pipelineId
      ? await this.get(tenantId, options.pipelineId)
      : await this.defaultPipeline(tenantId);
    const stage = pipeline.stages.find((s) => s.kind === (options.kind ?? CrmDealStage.LEAD));
    if (!stage) throw new BadRequestException('Choisissez une colonne du pipeline');
    return stage;
  }
}
