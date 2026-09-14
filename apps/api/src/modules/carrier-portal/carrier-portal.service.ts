import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, LoadStatus, MODULE_KEYS, TenderStatus } from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { TendersService } from '../transportation/tenders/tenders.service';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/**
 * Carrier Portal — capability-link visibility for the shipper's carriers.
 * One revocable token per carrier opens a page listing their tenders, loads, and
 * incoming invoices. Security model mirrors the Customer Portal (docs/collaboration.md).
 * Tenant isolation: tenantId is always derived from the token — never from the request body (rule 1).
 * Public projections never expose tenantId/carrierId (rule 10). Entity ids the carrier needs to
 * act on ITS OWN resources are exposed (tender.id to respond, load.id for POD upload,
 * invoice.id for attachment upload) — the token scopes them to this carrier.
 * Module gate re-checked in carrierByToken even on public routes (rule 15).
 */
@Injectable()
export class CarrierPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly documents: DocumentsService,
    private readonly tenders: TendersService,
    private readonly config: ConfigService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  /** Resolves a carrier by portal token and gates on the CARRIER_PORTAL module being enabled. */
  private async carrierByToken(token: string) {
    const carrier = await this.prisma.carrier.findUnique({
      where: { portalToken: token },
      include: { tenant: { select: { name: true } } },
    });
    if (!carrier) throw new NotFoundException('Unknown carrier portal link');
    const enabled = await this.modulesCache.getEnabledKeys(carrier.tenantId);
    if (!enabled.has(MODULE_KEYS.CARRIER_PORTAL)) {
      throw new ForbiddenException('The carrier portal is not enabled for this shipper');
    }
    return carrier;
  }

  /**
   * Admin: generate (or return existing) portal link for a carrier.
   * tenantId comes from the authenticated user's JWT (never from the body — rule 1).
   */
  async generateLink(tenantId: string, carrierId: string) {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id: carrierId, tenantId },
    });
    if (!carrier) throw new NotFoundException('Carrier not found');
    let token = carrier.portalToken;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await this.prisma.carrier.update({
        where: { id: carrierId },
        data: { portalToken: token },
      });
    }
    await this.audit.log({
      tenantId,
      action: AuditAction.UPDATE,
      entityType: 'carrier',
      entityId: carrierId,
      after: { portalLinkGenerated: true },
    });
    return {
      url: `${this.config.get('WEB_URL', 'http://localhost:5173')}/carrier-portal/${token}`,
    };
  }

  /** Admin: revoke the portal link for a carrier (sets portalToken to null). */
  async revokeLink(tenantId: string, carrierId: string) {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id: carrierId, tenantId },
    });
    if (!carrier) throw new NotFoundException('Carrier not found');
    await this.prisma.carrier.update({
      where: { id: carrierId },
      data: { portalToken: null },
    });
    await this.audit.log({
      tenantId,
      action: AuditAction.UPDATE,
      entityType: 'carrier',
      entityId: carrierId,
      after: { portalLinkRevoked: true },
    });
    return { revoked: true };
  }

  /**
   * Public read — returns the carrier's tenders, loads, and invoices.
   * Projection strictly follows rule 10: no tenantId, no carrierId, no loadId.
   * Only tender.id is exposed (needed to accept/decline from the portal).
   */
  async getView(token: string) {
    const carrier = await this.carrierByToken(token);
    const { tenantId } = carrier;
    const carrierId = carrier.id;

    const [tenderRows, loadRows, invoiceRows] = await Promise.all([
      this.prisma.tender.findMany({
        where: {
          tenantId,
          carrierId,
          status: { in: [TenderStatus.PENDING, TenderStatus.ACCEPTED] },
        },
        include: {
          load: { select: { loadNumber: true, status: true } },
        },
        orderBy: { sentAt: 'desc' },
        take: 50,
      }),
      this.prisma.load.findMany({
        where: { tenantId, carrierId },
        include: {
          shipments: {
            select: { shipmentNumber: true, status: true, actualDeliveryAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.incomingCarrierInvoice.findMany({
        where: { tenantId, carrierId },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      shipper: carrier.tenant.name,
      carrier: {
        name: carrier.name,
        code: carrier.code,
        email: carrier.email,
        phone: carrier.phone,
        contactName: carrier.contactName,
      },
      tenders: tenderRows.map((t) => ({
        id: t.id,
        loadNumber: t.load.loadNumber,
        status: t.status,
        expiresAt: t.expiresAt,
        message: t.message,
      })),
      loads: loadRows.map((l) => ({
        // id is required by the portal to target POD uploads (/loads/:id/pod). It is the
        // carrier's OWN load id, scoped by the capability token — like tender.id above.
        // Never expose tenantId/carrierId (rule 10).
        id: l.id,
        loadNumber: l.loadNumber,
        status: l.status,
        dispatchedAt: l.dispatchedAt,
        completedAt: l.completedAt,
        shipments: l.shipments.map((s) => ({
          shipmentNumber: s.shipmentNumber,
          status: s.status,
          actualDeliveryAt: s.actualDeliveryAt,
        })),
      })),
      invoices: invoiceRows.map((inv) => ({
        // id is required to target attachment uploads (/invoices/:id/attachment) — carrier's own.
        id: inv.id,
        carrierInvoiceNumber: inv.carrierInvoiceNumber,
        currency: inv.currency,
        chargedTotal: inv.chargedTotal,
        matchedTotal: inv.matchedTotal,
        varianceTotal: inv.varianceTotal,
        status: inv.status,
        disputeReasonCode: inv.disputeReasonCode,
        disputeNote: inv.disputeNote,
        resolution: inv.resolution,
        paidAt: inv.paidAt,
      })),
    };
  }

  /**
   * Public: accept or decline a tender on behalf of the carrier.
   * Reuses TendersService.respond (no duplication of load-status / auto-tender logic — rule).
   * The tender is verified to belong to this carrier before delegating.
   */
  async respondTender(
    token: string,
    tenderId: string,
    accept: boolean,
    declineReason?: string,
  ) {
    const carrier = await this.carrierByToken(token);
    const tender = await this.prisma.tender.findFirst({
      where: { id: tenderId, tenantId: carrier.tenantId, carrierId: carrier.id },
      select: { token: true },
    });
    if (!tender) throw new NotFoundException('Tender not found or not assigned to this carrier');
    // Delegate to TendersService.respond so all load-status + auto-tender chain logic runs once.
    const result = await this.tenders.respond(tender.token, accept, declineReason);
    return { status: result.status };
  }

  /** Public: upload a proof-of-delivery file for a load the carrier is assigned to. */
  async uploadPod(
    token: string,
    loadId: string,
    file: Express.Multer.File,
  ) {
    const carrier = await this.carrierByToken(token);
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId: carrier.tenantId, carrierId: carrier.id },
      select: { id: true, status: true },
    });
    if (!load) throw new NotFoundException('Load not found or not assigned to this carrier');
    if (!ALLOWED_MIME.includes(file.mimetype as (typeof ALLOWED_MIME)[number])) {
      throw new BadRequestException('Only JPEG/PNG/WebP images or PDF are accepted');
    }
    const settings = await this.moduleSettings.resolve(carrier.tenantId, 'carrier-portal');
    if (settings.podRequiresDispatched) {
      const dispatchedOrLater: string[] = [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT, LoadStatus.COMPLETED];
      if (!dispatchedOrLater.includes(load.status)) {
        throw new BadRequestException('POD requires the load to be dispatched');
      }
    }
    const doc = await this.documents.upload(carrier.tenantId, {
      entityType: 'load-pod',
      entityId: loadId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
    });
    await this.audit.log({
      tenantId: carrier.tenantId,
      action: AuditAction.CREATE,
      entityType: 'load-pod',
      entityId: loadId,
      after: { documentId: doc.id, via: 'carrier-portal', carrierId: carrier.id },
    });
    return { ok: true };
  }

  /** Public: attach a supporting document to an incoming carrier invoice. */
  async uploadInvoiceAttachment(
    token: string,
    invoiceId: string,
    file: Express.Multer.File,
  ) {
    const carrier = await this.carrierByToken(token);
    const invoice = await this.prisma.incomingCarrierInvoice.findFirst({
      where: { id: invoiceId, tenantId: carrier.tenantId, carrierId: carrier.id },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found or not assigned to this carrier');
    if (!ALLOWED_MIME.includes(file.mimetype as (typeof ALLOWED_MIME)[number])) {
      throw new BadRequestException('Only JPEG/PNG/WebP images or PDF are accepted');
    }
    const doc = await this.documents.upload(carrier.tenantId, {
      entityType: 'carrier-invoice-attachment',
      entityId: invoiceId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      body: file.buffer,
    });
    await this.audit.log({
      tenantId: carrier.tenantId,
      action: AuditAction.CREATE,
      entityType: 'carrier-invoice-attachment',
      entityId: invoiceId,
      after: { documentId: doc.id, via: 'carrier-portal', carrierId: carrier.id },
    });
    return { ok: true };
  }
}
