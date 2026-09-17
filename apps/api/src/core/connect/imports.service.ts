import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  applyMapping,
  AuditAction,
  coerceTypes,
  type CsvLocale,
  getImportTarget,
  IMPORT_TARGETS,
  type ImportStatus,
  parseCsv,
  validateRequired,
  type AuthUser,
} from '@pulsar/shared';
import { DocumentsService } from '../documents/documents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DomainEventsService } from '../operating/domain-events.service';
import { ModuleSettingsService } from '../module-registry/module-settings.service';
import { SequencesService } from '../../prisma/sequences.service';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, paginationArgs } from '../../common/pagination';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { ConnectRecordWriter } from './record-writer.service';

export interface StartImportInput {
  file: Express.Multer.File;
  target: string;
  /** JSON-encoded mapping: { [dtoField]: csvColumnHeader } */
  mapping: string;
  user: AuthUser;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
    private readonly events: DomainEventsService,
    private readonly moduleSettings: ModuleSettingsService,
    // Shared write surface: the inbound webhook receiver goes through the very
    // same permission re-check and business services (never duplicated).
    private readonly writer: ConnectRecordWriter,
  ) {}

  // -------------------------------------------------------------------------
  // List batches
  // -------------------------------------------------------------------------

  async list(tenantId: string, query: ListQueryDto & { target?: string }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.target ? { target: query.target } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importBatch.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.importBatch.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  // -------------------------------------------------------------------------
  // Get one batch + paginated rows
  // -------------------------------------------------------------------------

  async get(tenantId: string, id: string, rowsQuery: ListQueryDto) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException('Import batch not found');

    const { page, pageSize, skip, take } = paginationArgs(rowsQuery);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.importRow.findMany({
        where: { batchId: id, tenantId },
        skip,
        take,
        orderBy: { rowIndex: 'asc' },
      }),
      this.prisma.importRow.count({ where: { batchId: id, tenantId } }),
    ]);

    return {
      ...batch,
      rows: paginated(rows, total, page, pageSize),
    };
  }

  // -------------------------------------------------------------------------
  // Run import — POST /connect/imports
  // -------------------------------------------------------------------------

  async runImport(input: StartImportInput) {
    const { file, target: targetKey, user } = input;
    const tenantId = user.tenantId;

    // 1. Validate target
    const target = getImportTarget(targetKey);
    if (!target) {
      throw new BadRequestException(`Unknown import target: "${targetKey}"`);
    }

    // 2. Target-specific permission check (no privilege escalation).
    //    core.connect.manage is already enforced at the controller level via
    //    @RequirePermissions. Here we additionally verify the data permission.
    if (!user.permissions.includes(target.permission as any)) {
      throw new ForbiddenException(
        `Permission "${target.permission}" is required to import ${target.label}`,
      );
    }

    // 3. Parse column mapping
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(input.mapping) as Record<string, string>;
    } catch {
      throw new BadRequestException('mapping must be valid JSON');
    }

    // 4. Parse CSV (before creating the batch so totalRows is known)
    const csvText = file.buffer.toString('utf-8');
    const parsed = parseCsv(csvText);

    // 5. Create batch record first (without documentId) so we have the real id
    const number = await this.sequences.nextNumber(tenantId, 'import-batch');
    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId,
        number,
        target: targetKey,
        status: 'PROCESSING' as ImportStatus,
        totalRows: parsed.rows.length,
        importedRows: 0,
        failedRows: 0,
        mapping: mapping as any,
        createdById: user.id,
      },
    });

    // 6. Store CSV file via DocumentsService (rule 12), linked to the real batch id.
    const doc = await this.documents.upload(tenantId, {
      entityType: 'import-batch',
      entityId: batch.id,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
      uploadedById: user.id,
    });

    // Back-patch documentId onto the batch now that we have it.
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { documentId: doc.id },
    });

    // 7. Process each row — best-effort (one failure never aborts the batch)
    let importedRows = 0;
    let failedRows = 0;

    // Resolve tenant's CSV number locale once, outside the loop.
    const { csvNumberLocale } = await this.moduleSettings.resolve(tenantId, 'connect');

    for (let i = 0; i < parsed.rows.length; i++) {
      const rawRow = parsed.rows[i];
      let rowStatus: 'IMPORTED' | 'FAILED' = 'FAILED';
      let rowError: string | null = null;
      let rowData: Record<string, unknown> = rawRow;

      try {
        const mapped = applyMapping(rawRow, mapping);
        const coerced = coerceTypes(mapped, target, csvNumberLocale as CsvLocale);
        const missing = validateRequired(coerced, target.requiredColumns);

        if (missing.length > 0) {
          throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }

        await this.writer.createImportRecord(user, targetKey, coerced);
        rowData = coerced;
        rowStatus = 'IMPORTED';
        importedRows++;
      } catch (err: unknown) {
        rowError = err instanceof Error ? err.message : String(err);
        failedRows++;
      }

      await this.prisma.importRow.create({
        data: {
          tenantId,
          batchId: batch.id,
          rowIndex: i,
          status: rowStatus,
          error: rowError,
          data: rowData as any,
        },
      });
    }

    // 8. Final batch status:
    //    - Empty CSV → COMPLETED (nothing to do)
    //    - At least one imported row → COMPLETED
    //    - Zero imported but some failed → FAILED
    const finalStatus: ImportStatus =
      parsed.rows.length === 0 || importedRows > 0 ? 'COMPLETED' : 'FAILED';

    const updatedBatch = await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: finalStatus, importedRows, failedRows },
    });

    // 9. InboundMessage (source CSV, best-effort — no number field on this model)
    try {
      await this.prisma.inboundMessage.create({
        data: {
          tenantId,
          source: 'CSV',
          status: finalStatus === 'COMPLETED' ? 'IMPORTED' : 'FAILED',
          kind: targetKey,
          summary: `CSV import: ${target.label} — ${importedRows} imported, ${failedRows} failed (${number})`,
          documentId: doc.id,
          refType: 'import-batch',
          refId: batch.id,
          createdById: user.id,
        },
      });
    } catch (err) {
      console.error('[ImportsService] InboundMessage creation failed (non-fatal)', err);
    }

    // 10. Audit (rule 6)
    await this.audit.log({
      tenantId,
      userId: user.id,
      action: AuditAction.CREATE,
      entityType: 'import-batch',
      entityId: batch.id,
      after: {
        number,
        target: targetKey,
        status: finalStatus,
        importedRows,
        failedRows,
        totalRows: parsed.rows.length,
      },
    });

    // 11. Domain event (best-effort, fire-and-forget — rule spec)
    this.events
      .emit(
        tenantId,
        'connect.import-batch.completed',
        { type: 'import-batch', id: batch.id },
        {
          target: targetKey,
          number,
          status: finalStatus,
          importedRows,
          failedRows,
          totalRows: parsed.rows.length,
        },
      )
      .catch((err) => console.error('[ImportsService] DomainEvent emit failed (non-fatal)', err));

    return updatedBatch;
  }

  // -------------------------------------------------------------------------
  // Catalog of available targets (for UI)
  // -------------------------------------------------------------------------

  getTargets() {
    return IMPORT_TARGETS;
  }
}
