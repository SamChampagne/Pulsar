import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  MODULE_KEYS,
  PERMISSIONS,
  type InboundSource,
  type InboundStatus,
  type AuthUser,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService, type OwnedEntity } from '../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { DocumentsService } from '../documents/documents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DomainEventsService } from '../operating/domain-events.service';
import { FreightAuditService } from '../../modules/billing/freight-audit/freight-audit.service';
import { paginated, paginationArgs } from '../../common/pagination';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { IsOptional, IsString } from 'class-validator';

export class ListInboxQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

/** Document refType → owned entity. Only these targets may be attached (rule 9). */
const DOC_REF_OWNERSHIP: Record<string, OwnedEntity> = {
  load: 'load',
  shipment: 'shipment',
  'transport-order': 'transportOrder',
  transportOrder: 'transportOrder',
  carrier: 'carrier',
  customer: 'customer',
};

@Injectable()
export class InboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
    private readonly events: DomainEventsService,
    private readonly freightAudit: FreightAuditService,
    private readonly ownership: OwnershipService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /connect/inbound/carrier-invoice
  // ---------------------------------------------------------------------------

  async ingestCarrierInvoice(
    user: AuthUser,
    file: Express.Multer.File,
    body: {
      carrierId: string;
      carrierInvoiceNumber: string;
      currency?: string;
      lines: string; // JSON string
    },
  ) {
    const { tenantId, id: userId } = user;

    // Rule 15: verify billing module is enabled for this tenant.
    const enabledKeys = await this.modulesCache.getEnabledKeys(tenantId);
    if (!enabledKeys.has(MODULE_KEYS.BILLING)) {
      throw new ForbiddenException('Billing module is not enabled for this tenant');
    }

    // No privilege escalation: caller must also hold freight-audit.manage.
    if (!user.permissions.includes(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE as any)) {
      throw new ForbiddenException(
        `Permission "${PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE}" is required to ingest carrier invoices`,
      );
    }

    // Parse lines JSON.
    let parsedLines: Array<{ lineRef: string; description?: string; chargedAmount: number }>;
    try {
      parsedLines = JSON.parse(body.lines) as typeof parsedLines;
    } catch {
      throw new BadRequestException('Field "lines" must be valid JSON');
    }
    if (!Array.isArray(parsedLines) || parsedLines.length === 0) {
      throw new BadRequestException('Field "lines" must be a non-empty JSON array');
    }

    // Create freight audit invoice (tagged as pdf-ingestion, rule 16 / phase 16).
    const invoice = await this.freightAudit.create(
      tenantId,
      userId,
      {
        carrierId: body.carrierId,
        carrierInvoiceNumber: body.carrierInvoiceNumber,
        currency: body.currency,
        lines: parsedLines,
      },
      'pdf-ingestion',
    );

    // Store the PDF via DocumentsService (rule 12).
    const doc = await this.documents.upload(tenantId, {
      entityType: 'incoming-carrier-invoice',
      entityId: invoice.id,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
      uploadedById: userId,
    });

    // Create InboundMessage record.
    const msg = await this.prisma.inboundMessage.create({
      data: {
        tenantId,
        source: 'PDF' as InboundSource,
        status: 'IMPORTED' as InboundStatus,
        kind: 'carrier-invoice',
        summary: `Facture ${body.carrierInvoiceNumber} ingérée`,
        documentId: doc.id,
        refType: 'incoming-carrier-invoice',
        refId: invoice.id,
        createdById: userId,
      },
    });

    // Best-effort domain event.
    this.events
      .emit(
        tenantId,
        'connect.carrier-invoice.ingested',
        { type: 'incoming-carrier-invoice', id: invoice.id },
        { invoiceId: invoice.id, inboundMessageId: msg.id, carrierId: body.carrierId },
      )
      .catch((err) =>
        console.error('[InboundService] DomainEvent emit failed (non-fatal)', err),
      );

    return { invoice, inboundMessageId: msg.id };
  }

  // ---------------------------------------------------------------------------
  // POST /connect/inbound/document
  // ---------------------------------------------------------------------------

  async ingestDocument(
    user: AuthUser,
    file: Express.Multer.File,
    body: { refType: string; refId: string; kind?: string },
  ) {
    const { tenantId, id: userId } = user;

    // Rule 9: only known entity types may be referenced, and the referenced row
    // must belong to the caller's tenant.
    const owned = DOC_REF_OWNERSHIP[body.refType];
    if (!owned) {
      throw new BadRequestException(`Unsupported refType "${body.refType}"`);
    }
    await this.ownership.assertOwned(owned, body.refId, tenantId);

    // Store via DocumentsService (rule 12).
    const doc = await this.documents.upload(tenantId, {
      entityType: body.refType,
      entityId: body.refId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
      uploadedById: userId,
    });

    const msg = await this.prisma.inboundMessage.create({
      data: {
        tenantId,
        source: 'DOCUMENT' as InboundSource,
        status: 'IMPORTED' as InboundStatus,
        kind: body.kind ?? null,
        summary: `Document ${file.originalname}`,
        documentId: doc.id,
        refType: body.refType,
        refId: body.refId,
        createdById: userId,
      },
    });

    return msg;
  }

  // ---------------------------------------------------------------------------
  // GET /connect/inbox
  // ---------------------------------------------------------------------------

  async listInbox(tenantId: string, query: ListInboxQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.source ? { source: query.source as InboundSource } : {}),
      ...(query.status ? { status: query.status as InboundStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inboundMessage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inboundMessage.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  // ---------------------------------------------------------------------------
  // GET /connect/inbox/:id
  // ---------------------------------------------------------------------------

  async getInboxMessage(tenantId: string, id: string) {
    const msg = await this.prisma.inboundMessage.findFirst({ where: { id, tenantId } });
    if (!msg) throw new NotFoundException('Inbound message not found');

    // Best-effort document URL.
    let documentUrl: { url: string; presigned: boolean } | undefined;
    if (msg.documentId) {
      try {
        const result = await this.documents.downloadUrl(tenantId, msg.documentId);
        documentUrl = { url: result.url, presigned: result.presigned };
      } catch {
        // Non-fatal: document may have been removed.
      }
    }

    return { ...msg, documentUrl };
  }

  // ---------------------------------------------------------------------------
  // POST /connect/inbox/:id/ignore
  // ---------------------------------------------------------------------------

  async ignoreMessage(tenantId: string, actorId: string, id: string) {
    const { count } = await this.prisma.inboundMessage.updateMany({
      where: { id, tenantId, status: { not: 'IGNORED' as InboundStatus } },
      data: { status: 'IGNORED' as InboundStatus },
    });
    if (count === 0) {
      // Either not found or already IGNORED — check which.
      const exists = await this.prisma.inboundMessage.findFirst({ where: { id, tenantId } });
      if (!exists) throw new NotFoundException('Inbound message not found');
      // Already IGNORED — idempotent, just return it.
      return exists;
    }

    // Best-effort audit (rule 6).
    await this.audit
      .log({
        tenantId,
        userId: actorId,
        action: AuditAction.UPDATE,
        entityType: 'inbound-message',
        entityId: id,
        after: { status: 'IGNORED' },
      })
      .catch((err) => console.error('[InboundService] Audit log failed (non-fatal)', err));

    return this.prisma.inboundMessage.findFirst({ where: { id, tenantId } });
  }
}
