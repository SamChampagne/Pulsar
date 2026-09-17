import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  LocationType,
  MODULE_KEYS,
  ShipmentStatus,
  at7ForShipmentStatus,
  at7ForTrackingEvent,
  build214,
  build990,
  parseX12,
  read204,
  read210,
  type CanonicalCarrierInvoice,
  type CanonicalLoadTender,
  type CanonicalTenderStop,
  type InboundStatus,
  type X12EnvelopeOptions,
  type X12ParseError,
  type X12ShipmentStatusEvent,
  type X12Transaction,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CryptoService } from '../crypto/crypto.service';
import { LocationsService } from '../locations/locations.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { TransportOrdersService } from '../../modules/transportation/transport-orders/transport-orders.service';
import { FreightAuditService } from '../../modules/billing/freight-audit/freight-audit.service';
import { buildShipmentTrackingView } from '../../modules/transportation/public/shipment-tracking.view';
import { EDI_KEY_PREFIX, isEdiIntegration } from '../integrations/edi-identity';

/** Hard cap on an accepted interchange (the largest 204 seen in the wild is a few KB). */
export const MAX_EDI_BYTES = 512 * 1024;

/** Longest ISA05..ISA08 partner id X12 accepts (padded/truncated to this width). */
const ISA_ID_WIDTH = 15;

/** K1 (990 decline reason) is two 30-char elements — keep reasons short. */
const MAX_REASON_CHARS = 60;

/** 1 lb → kg. X12 weight unit `L` is pounds; `K` is kilograms. */
const LB_TO_KG = 0.45359237;

/**
 * AT7 codes that happen at the consignee end. Used to stamp MS1 with the right
 * city when the tracking event carries no stop reference (a `DELIVERED` event
 * is recorded against the shipment, not a stop).
 */
const DELIVERY_SIDE_AT7 = new Set(['AB', 'X1', 'CD', 'D1', 'AP', 'A7', 'AG']);

/**
 * Structural parse errors that make an interchange untrustworthy. A 204 whose
 * SE01 count is wrong is still readable (C3 returns a best-effort document),
 * but a missing IEA or a control-number mismatch means we are not looking at
 * the message the partner thinks it sent.
 */
const FATAL_PARSE_CODES = new Set([
  'EMPTY_INPUT',
  'MISSING_ISA',
  'ISA_TOO_SHORT',
  'ISA_MALFORMED',
  'MISSING_IEA',
  'SE_COUNT_MISMATCH',
  'ST_CONTROL_MISMATCH',
  'GS_CONTROL_MISMATCH',
  'ISA_CONTROL_MISMATCH',
  'NO_TRANSACTION',
]);

/**
 * Config of an `edi-<partner>` integration. Sender/receiver ids are written
 * from OUR point of view: `isaSenderId` is the id Pulsar signs outbound
 * interchanges with, `isaReceiverId` is the partner's. `gs*` default to the
 * `isa*` values.
 */
export interface EdiIntegrationConfig {
  isaSenderId?: string;
  isaReceiverId?: string;
  gsSenderId?: string;
  gsReceiverId?: string;
  /** Required to turn a 204 into a transport order (rule 9: ownership checked at save time). */
  customerId?: string;
  /** Required to turn a 210 into an incoming carrier invoice. */
  carrierId?: string;
  /** Destination of outbound 214s, delivered through the webhook outbox. */
  url?: string;
  /** `x12` marks the integration as an EDI endpoint for the public receiver. */
  format?: string;
}

export interface EdiOutcome {
  status: InboundStatus;
  /** 990 interchange (accept or decline) — only for a 204. */
  ack?: string;
  /**
   * PARTNER-SAFE reason. Travels to the caller (including the anonymous public
   * door) and into the 990 `K1`, so it only ever carries a deliberate
   * {@link EdiDeclineError} message — never an exception from a business
   * service, an ORM or the runtime.
   */
  error?: string;
  /** Full internal detail. Journalled in `InboundMessage.error`, NEVER returned. */
  detail?: string;
  entityType?: string;
  entityId?: string;
  /** Partner-safe one-liner (inbox display + response). */
  summary: string;
  transactionSetId?: string;
}

export type EdiInboundResponse = Omit<EdiOutcome, 'detail'> & {
  inboxId: string;
  /** true when the exact same interchange had already been processed. */
  replayed?: boolean;
};

/**
 * A refusal whose message is safe to hand back to the partner (it describes
 * THEIR interchange or OUR configuration in business terms). Anything else that
 * escapes is reported generically — see {@link GENERIC_DECLINE}.
 */
class EdiDeclineError extends Error {}

/** What a non-{@link EdiDeclineError} failure tells the partner. */
const GENERIC_DECLINE = 'Tender could not be processed';
const GENERIC_FAILURE = 'Interchange could not be processed';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * The ONE idempotency namespace of the EDI plane: both doors (authenticated
 * `POST /connect/edi/inbound` and the public receiver) derive the same key from
 * the same bytes, so a partner that retries on the other door is still a replay.
 * An `X-Idempotency-Key` header is deliberately ignored for EDI — the
 * interchange itself is the identity.
 */
export function ediDedupKey(content: string): string {
  return `edi:${sha256(content.trim())}`;
}

/** `EDI-<12 hex>` — deterministic location code derived from the stop address. */
export function ediLocationCode(parts: Array<string | undefined>): string {
  const normalized = parts
    .map((value) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|');
  return `EDI-${createHash('sha1').update(normalized).digest('hex').slice(0, 12)}`;
}

/**
 * Trimmed value, or the fallback when it is absent OR blank. A configuration
 * form posts every field, so "not set" reaches us as `''` — `??` would keep it.
 */
export function nonEmpty(value: string | undefined | null, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
}

/** X12 weight + unit qualifier → kilograms (`L` = pounds, anything else taken as kg). */
export function ediWeightToKg(weight?: number, unit?: string): number | undefined {
  if (weight === undefined || !Number.isFinite(weight)) return undefined;
  const factor = (unit ?? '').trim().toUpperCase() === 'L' ? LB_TO_KG : 1;
  return Math.round(weight * factor * 100) / 100;
}

/**
 * ANSI X12 plane: inbound 204 (load tender) and 210 (carrier invoice), outbound
 * 990 (tender response) and 214 (shipment status).
 *
 * All parsing and generation lives in `@pulsar/shared/edi` (pure, rule 55);
 * this service is transport + governance only:
 *  - every write is attributed to the tenant service-account (rule 13) and goes
 *    through the existing business services (never raw Prisma on domain tables);
 *  - the module of the target service is re-checked here (rule 15) because the
 *    public receiver bypasses `ModulesGuard`;
 *  - the interchange is journalled as an `InboundMessage{source:'EDI'}`,
 *    idempotent on the sha256 of its bytes.
 */
@Injectable()
export class EdiService {
  private readonly logger = new Logger(EdiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly apiKeys: ApiKeysService,
    private readonly audit: AuditLogsService,
    private readonly locations: LocationsService,
    private readonly transportOrders: TransportOrdersService,
    private readonly freightAudit: FreightAuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Intake
  // ---------------------------------------------------------------------------

  /**
   * Authenticated intake (`POST /connect/edi/inbound`). Resolves the partner
   * integration by key, then runs the same pipeline the public receiver uses.
   */
  async receive(
    tenantId: string,
    input: { integrationKey?: string; content: string },
  ): Promise<EdiInboundResponse> {
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('Empty EDI payload');
    if (Buffer.byteLength(content, 'utf-8') > MAX_EDI_BYTES) {
      throw new BadRequestException('EDI payload exceeds 512 KB');
    }
    const integration = await this.resolveIntegrationByKey(tenantId, input.integrationKey);
    return this.ingest({
      tenantId,
      integrationId: integration.id,
      integrationName: integration.name,
      config: integration.config,
      content,
    });
  }

  /**
   * Public-receiver entry point. The caller (`InboundHooksService`) has already
   * authenticated the token, checked the HMAC and claimed the idempotency key,
   * so the inbox row exists: we only complete it.
   */
  async processDelivery(args: {
    tenantId: string;
    integrationId: string;
    integrationKey: string;
    integrationName: string;
    config: Record<string, unknown>;
    content: string;
    inboxId: string;
  }): Promise<EdiOutcome> {
    // Defence in depth: the caller already dispatched on `isEdiIntegration`,
    // but nothing that is not a fully-declared EDI receiver may ever reach the
    // business writes below.
    if (!isEdiIntegration(args.integrationKey, args.config)) {
      throw new ForbiddenException('This integration is not a fully declared EDI receiver');
    }
    const serviceUserId = await this.apiKeys.ensureServiceUser(args.tenantId);
    const outcome = await this.handleInterchange(
      args.tenantId,
      serviceUserId,
      args.config as EdiIntegrationConfig,
      args.content,
    );
    await this.finish(args, outcome, serviceUserId, args.inboxId);
    return outcome;
  }

  /** Inbox claim (idempotent on the interchange bytes) + processing + journalling. */
  private async ingest(args: {
    tenantId: string;
    integrationId: string;
    integrationName: string;
    config: EdiIntegrationConfig;
    content: string;
  }): Promise<EdiInboundResponse> {
    const { tenantId, content } = args;
    const dedupKey = ediDedupKey(content);

    const existing = await this.prisma.inboundMessage.findFirst({
      where: { tenantId, dedupKey },
      select: { id: true, status: true, refType: true, refId: true, parsed: true },
    });
    if (existing) {
      // The replay answers with the STORED partner-safe reason, never with the
      // internal detail kept in `InboundMessage.error`.
      const parsed = (existing.parsed ?? {}) as {
        ack?: string;
        publicError?: string;
        transactionSetId?: string;
      };
      return {
        inboxId: existing.id,
        status: existing.status as InboundStatus,
        summary: 'Interchange déjà traité',
        ...(parsed.publicError ? { error: parsed.publicError } : {}),
        ...(existing.refType ? { entityType: existing.refType } : {}),
        ...(existing.refId ? { entityId: existing.refId } : {}),
        ...(parsed.ack ? { ack: parsed.ack } : {}),
        ...(parsed.transactionSetId ? { transactionSetId: parsed.transactionSetId } : {}),
        replayed: true,
      };
    }

    let inboxId: string;
    try {
      const created = await this.prisma.inboundMessage.create({
        data: {
          tenantId,
          source: 'EDI',
          status: 'RECEIVED' as InboundStatus,
          kind: 'edi',
          summary: `EDI — ${args.integrationName}`,
          dedupKey,
          parsed: {
            integrationId: args.integrationId,
            bytes: Buffer.byteLength(content, 'utf-8'),
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      inboxId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // A concurrent identical interchange won the claim — surface its row.
        const raced = await this.prisma.inboundMessage.findFirst({
          where: { tenantId, dedupKey },
          select: { id: true, status: true },
        });
        if (raced) {
          return {
            inboxId: raced.id,
            status: raced.status as InboundStatus,
            summary: 'Interchange déjà traité',
            replayed: true,
          };
        }
      }
      throw err;
    }

    const serviceUserId = await this.apiKeys.ensureServiceUser(tenantId);
    const outcome = await this.handleInterchange(
      tenantId,
      serviceUserId,
      args.config,
      args.content,
    );
    await this.finish(args, outcome, serviceUserId, inboxId);
    const { detail: _detail, ...safe } = outcome;
    return { inboxId, ...safe };
  }

  /** Writes the outcome back to the inbox row and audits it under the service account. */
  private async finish(
    args: { tenantId: string; integrationId: string; integrationName: string },
    outcome: EdiOutcome,
    serviceUserId: string,
    inboxId: string,
  ) {
    // Keep whatever the claim wrote (`bytes`, `integrationId`) — this is an
    // enrichment of the row, not a replacement.
    const current = await this.prisma.inboundMessage.findFirst({
      where: { id: inboxId, tenantId: args.tenantId },
      select: { parsed: true },
    });
    const previous = (current?.parsed ?? {}) as Record<string, unknown>;

    // Tenant-scoped write (rule 1): `updateMany` is the only conditional form.
    await this.prisma.inboundMessage.updateMany({
      where: { id: inboxId, tenantId: args.tenantId },
      data: {
        status: outcome.status,
        summary: `EDI ${outcome.transactionSetId ?? '?'} — ${args.integrationName} — ${outcome.summary}`,
        createdById: serviceUserId,
        // `error` keeps the FULL detail — it never leaves the inbox.
        error: outcome.detail ?? outcome.error ?? null,
        ...(outcome.entityType ? { refType: outcome.entityType } : {}),
        ...(outcome.entityId ? { refId: outcome.entityId } : {}),
        parsed: {
          ...previous,
          integrationId: args.integrationId,
          transactionSetId: outcome.transactionSetId ?? null,
          // The 990 we answered is part of the audit trail of the exchange.
          ...(outcome.ack ? { ack: outcome.ack } : {}),
          // What a replay is allowed to tell the partner.
          ...(outcome.error ? { publicError: outcome.error } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    await this.audit
      .log({
        tenantId: args.tenantId,
        userId: serviceUserId,
        action: AuditAction.CREATE,
        entityType: 'inbound-message',
        entityId: inboxId,
        after: {
          source: 'EDI',
          integrationId: args.integrationId,
          transactionSetId: outcome.transactionSetId ?? null,
          status: outcome.status,
          ...(outcome.entityType ? { refType: outcome.entityType } : {}),
          ...(outcome.entityId ? { refId: outcome.entityId } : {}),
        },
      })
      .catch((err) => this.logger.warn(`Audit log failed (non-fatal): ${String(err)}`));
  }

  /** Parse the interchange, dispatch on the transaction set, never throw. */
  private async handleInterchange(
    tenantId: string,
    serviceUserId: string,
    config: EdiIntegrationConfig,
    content: string,
  ): Promise<EdiOutcome> {
    const result = parseX12(content);
    const fatal = (result.errors ?? []).filter((e: X12ParseError) => FATAL_PARSE_CODES.has(e.code));
    if (!result.document || fatal.length > 0) {
      // Parse diagnostics describe the PARTNER's own bytes — safe to hand back.
      const error = `Interchange illisible: ${(fatal.length ? fatal : result.errors)
        .map((e: X12ParseError) => e.message)
        .join('; ')
        .slice(0, 500)}`;
      return { status: 'FAILED', error, summary: 'Interchange refusé' };
    }

    const transaction = result.document.transactions[0];
    if (!transaction) {
      return {
        status: 'FAILED',
        error: 'Interchange without a transaction set',
        summary: 'Interchange vide',
      };
    }
    const setId = transaction.transactionSetId;

    if (setId === '204') return this.handle204(tenantId, serviceUserId, config, transaction);
    if (setId === '210') return this.handle210(tenantId, serviceUserId, config, transaction);
    return {
      status: 'FAILED',
      transactionSetId: setId,
      error: `Unsupported transaction set "${setId}" (204 and 210 only)`,
      summary: 'Type de transaction non supporté',
    };
  }

  // ---------------------------------------------------------------------------
  // 204 — motor carrier load tender → TransportOrder DRAFT + 990
  // ---------------------------------------------------------------------------

  private async handle204(
    tenantId: string,
    serviceUserId: string,
    config: EdiIntegrationConfig,
    transaction: X12Transaction,
  ): Promise<EdiOutcome> {
    let tender: CanonicalLoadTender | null = null;
    try {
      tender = read204(transaction);
      const order = await this.createOrderFromTender(tenantId, serviceUserId, config, tender);
      const ack = build990(
        { shipmentId: tender.shipmentId, ...(tender.scac ? { scac: tender.scac } : {}) },
        { accept: true, references: [{ qualifier: 'CN', value: order.orderNumber }] },
        this.envelope(config),
      );
      return {
        status: 'IMPORTED',
        transactionSetId: '204',
        ack,
        entityType: 'transport-order',
        entityId: order.id,
        summary: `Commande ${order.orderNumber}`,
      };
    } catch (err) {
      // Only a deliberate decline reaches the partner: anything else (a business
      // service, Prisma, the runtime) would describe our internals, and the
      // public door echoes this verbatim in a 202 body.
      const detail = err instanceof Error ? err.message : String(err);
      const safe = err instanceof EdiDeclineError ? err.message : GENERIC_DECLINE;
      const reason = safe.slice(0, MAX_REASON_CHARS);
      this.logger.warn(`EDI 204 declined: ${detail}`);
      const ack = build990(
        {
          shipmentId: tender?.shipmentId ?? '',
          ...(tender?.scac ? { scac: tender.scac } : {}),
        },
        { accept: false, reason },
        this.envelope(config),
      );
      return {
        status: 'FAILED',
        transactionSetId: '204',
        ack,
        error: safe,
        detail,
        summary: `Tender refusé — ${reason}`,
      };
    }
  }

  private async createOrderFromTender(
    tenantId: string,
    serviceUserId: string,
    config: EdiIntegrationConfig,
    tender: CanonicalLoadTender,
  ) {
    // Rule 15: this path is reachable from a public route — re-check the module.
    const enabled = await this.modulesCache.getEnabledKeys(tenantId);
    if (!enabled.has(MODULE_KEYS.TRANSPORTATION)) {
      throw new EdiDeclineError('Transportation module disabled');
    }
    if (!tender.shipmentId) throw new EdiDeclineError('B2-04 shipment id missing');

    const customerId = (config.customerId ?? '').trim();
    if (!customerId) throw new EdiDeclineError('No customerId on the EDI integration');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) throw new EdiDeclineError('Configured customerId is unknown');

    const pickup = tender.stops.find((stop) => stop.type === 'PICKUP');
    const deliveries = tender.stops.filter((stop) => stop.type === 'DELIVERY');
    const delivery = deliveries[deliveries.length - 1];
    if (!pickup || !delivery) throw new EdiDeclineError('Tender needs a pickup and a delivery');

    const originLocationId = await this.upsertStopLocation(tenantId, serviceUserId, pickup);
    const destinationLocationId = await this.upsertStopLocation(tenantId, serviceUserId, delivery);

    const palletCount =
      (pickup.quantityUnit ?? '').toUpperCase().startsWith('PL') && Number.isFinite(pickup.quantity)
        ? Math.round(pickup.quantity as number)
        : undefined;

    return this.transportOrders.create(tenantId, serviceUserId, {
      customerId,
      originLocationId,
      destinationLocationId,
      customerReference: tender.shipmentId.slice(0, 120),
      ...(pickup.earliestAt ? { requestedPickupEarly: pickup.earliestAt } : {}),
      ...(pickup.latestAt ? { requestedPickupLate: pickup.latestAt } : {}),
      ...(delivery.earliestAt ? { requestedDeliveryEarly: delivery.earliestAt } : {}),
      ...(delivery.latestAt ? { requestedDeliveryLate: delivery.latestAt } : {}),
      ...(ediWeightToKg(tender.totalWeight, tender.weightUnit) !== undefined
        ? { totalWeightKg: ediWeightToKg(tender.totalWeight, tender.weightUnit) }
        : {}),
      ...(palletCount !== undefined ? { palletCount } : {}),
      ...(tender.notes.length ? { notes: tender.notes.join('\n').slice(0, 2000) } : {}),
    });
  }

  /**
   * Stop address → `Location`. The code is derived from the normalized address
   * (`EDI-<sha1>`), so re-tendering the same lane reuses the same row instead of
   * growing the master data. Created rows are `CUSTOMER_SITE` (ruling) and
   * audited under the service account (rule 6).
   */
  private async upsertStopLocation(
    tenantId: string,
    serviceUserId: string,
    stop: CanonicalTenderStop,
  ): Promise<string> {
    const city = (stop.city ?? '').trim();
    if (!city) throw new EdiDeclineError('Stop address incomplete (N4 city required)');
    // N3 is optional in the wild: fall back to the party name, then to the city,
    // so a city-level tender still produces a usable Location.
    const addressLine1 = (stop.address1 ?? '').trim() || (stop.name ?? '').trim() || city;

    const code = ediLocationCode([
      addressLine1,
      stop.address2,
      city,
      stop.state,
      stop.postalCode,
      stop.country,
    ]);
    const existing = await this.prisma.location.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: { id: true },
    });
    if (existing) return existing.id;

    let created: { id: string };
    try {
      created = await this.locations.create(tenantId, {
        code,
        name: (stop.name ?? city).slice(0, 120),
        type: LocationType.CUSTOMER_SITE,
        addressLine1,
        ...(stop.address2 ? { addressLine2: stop.address2 } : {}),
        city,
        ...(stop.state ? { state: stop.state } : {}),
        ...(stop.postalCode ? { postalCode: stop.postalCode } : {}),
        ...(stop.country ? { country: stop.country } : {}),
      });
    } catch (err) {
      // Two interchanges naming the same address can race between the lookup
      // above and this create (LocationsService answers 409; the unique index
      // answers P2002). Either way the row now exists — re-read it.
      const raced =
        err instanceof ConflictException ||
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002');
      if (!raced) throw err;
      const existingNow = await this.prisma.location.findUnique({
        where: { tenantId_code: { tenantId, code } },
        select: { id: true },
      });
      if (!existingNow) throw err;
      return existingNow.id;
    }
    await this.audit
      .log({
        tenantId,
        userId: serviceUserId,
        action: AuditAction.CREATE,
        entityType: 'location',
        entityId: created.id,
        after: { code, source: 'edi-204', type: LocationType.CUSTOMER_SITE },
      })
      .catch((err) => this.logger.warn(`Audit log failed (non-fatal): ${String(err)}`));
    return created.id;
  }

  // ---------------------------------------------------------------------------
  // 210 — carrier invoice → IncomingCarrierInvoice (freight audit)
  // ---------------------------------------------------------------------------

  private async handle210(
    tenantId: string,
    serviceUserId: string,
    config: EdiIntegrationConfig,
    transaction: X12Transaction,
  ): Promise<EdiOutcome> {
    try {
      // Rule 15: Billing must be active — the public receiver bypasses ModulesGuard.
      const enabled = await this.modulesCache.getEnabledKeys(tenantId);
      if (!enabled.has(MODULE_KEYS.BILLING)) {
        throw new EdiDeclineError('Billing module disabled');
      }
      const carrierId = (config.carrierId ?? '').trim();
      if (!carrierId) throw new EdiDeclineError('No carrierId on the EDI integration');
      const carrier = await this.prisma.carrier.findFirst({
        where: { id: carrierId, tenantId },
        select: { id: true },
      });
      if (!carrier) throw new EdiDeclineError('Configured carrierId is unknown');

      const invoice = read210(transaction);
      if (!invoice.invoiceNumber) throw new EdiDeclineError('B3-02 invoice number missing');
      const lines = this.invoiceLines(invoice);
      if (lines.length === 0) throw new EdiDeclineError('Invoice carries no charge');

      // Business-key dedup on top of the interchange hash: a partner that
      // re-sends the SAME invoice inside a different envelope (new ISA control
      // number, new date) would otherwise create a second payable.
      const duplicate = await this.prisma.incomingCarrierInvoice.findFirst({
        where: { tenantId, carrierId, carrierInvoiceNumber: invoice.invoiceNumber },
        select: { id: true },
      });
      if (duplicate) {
        throw new EdiDeclineError(`Duplicate carrier invoice ${invoice.invoiceNumber}`);
      }

      const created = await this.freightAudit.create(
        tenantId,
        serviceUserId,
        {
          carrierId,
          carrierInvoiceNumber: invoice.invoiceNumber,
          ...(invoice.currency ? { currency: invoice.currency } : {}),
          lines,
        },
        'edi-210',
      );
      return {
        status: 'IMPORTED',
        transactionSetId: '210',
        entityType: 'incoming-carrier-invoice',
        entityId: created.id,
        summary: `Facture ${invoice.invoiceNumber} (${lines.length} ligne(s))`,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const safe = err instanceof EdiDeclineError ? err.message : GENERIC_FAILURE;
      this.logger.warn(`EDI 210 failed: ${detail}`);
      return {
        status: 'FAILED',
        transactionSetId: '210',
        error: safe,
        detail,
        summary: `Facture refusée — ${safe.slice(0, MAX_REASON_CHARS)}`,
      };
    }
  }

  /**
   * 210 LX loops → freight-audit lines. A 210 with no LX loop but a header total
   * still bills something: keep one synthetic line so the audit has a subject
   * (rule 31 — the service compares these to the frozen `Load.estimatedCost`).
   */
  private invoiceLines(invoice: CanonicalCarrierInvoice) {
    const lines = invoice.lines
      .filter((line) => Number.isFinite(line.amount))
      .map((line, index) => ({
        lineRef: String(line.chargeCode ?? line.lineNumber ?? index + 1),
        ...(line.description ? { description: line.description } : {}),
        chargedAmount: Math.round(line.amount * 100) / 100,
      }));
    if (lines.length > 0) return lines;
    if (Number.isFinite(invoice.total) && invoice.total !== 0) {
      return [
        {
          lineRef: 'TOTAL',
          description: 'Total facture (aucune ligne LX)',
          chargedAmount: Math.round(invoice.total * 100) / 100,
        },
      ];
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // 214 — outbound shipment status
  // ---------------------------------------------------------------------------

  /**
   * Current 214 of one shipment: every tracking event that maps to an AT7 code,
   * in chronological order, followed by the shipment's current status.
   */
  async build214ForShipment(tenantId: string, shipmentId: string, integrationKey?: string) {
    const integration = await this.resolveIntegrationByKey(tenantId, integrationKey);
    // Same projection as the portal / public tracking page (single source of truth).
    const view = await buildShipmentTrackingView(
      this.prisma,
      { id: shipmentId, tenantId },
      'Shipment not found',
    );

    const details = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      select: {
        transportOrder: { select: { orderNumber: true, customerReference: true } },
        load: {
          select: {
            loadNumber: true,
            carrier: { select: { scacCode: true } },
            trailer: { select: { unitNumber: true } },
          },
        },
      },
    });

    // The projection carries no stop reference (rule 10) — AT7 needs to know
    // whether an arrival/departure happened at a pickup or a delivery.
    const stopTypes = new Map<string, 'PICKUP' | 'DELIVERY'>();
    const withStops = await this.prisma.trackingEvent.findMany({
      where: { tenantId, shipmentId, stopId: { not: null } },
      select: { id: true, stop: { select: { type: true } } },
    });
    for (const row of withStops) {
      if (row.stop) stopTypes.set(row.id, row.stop.type as 'PICKUP' | 'DELIVERY');
    }

    const placeOf = (code: string, stopType?: 'PICKUP' | 'DELIVERY') =>
      stopType === 'DELIVERY' || (stopType === undefined && DELIVERY_SIDE_AT7.has(code))
        ? view.destination
        : view.origin;

    const events: X12ShipmentStatusEvent[] = [];
    // The projection is newest-first; a 214 reads oldest-first.
    for (const event of [...view.events].reverse()) {
      const stopType = stopTypes.get(event.id);
      const code = at7ForTrackingEvent(event.type, stopType ? { stopType } : undefined);
      if (!code) continue;
      const place = placeOf(code, stopType);
      events.push({
        code,
        at: event.occurredAt,
        ...(place?.city ? { city: place.city } : {}),
        ...(place?.state ? { state: place.state } : {}),
      });
    }

    const statusCode = at7ForShipmentStatus(view.status as ShipmentStatus);
    if (statusCode && events[events.length - 1]?.code !== statusCode) {
      const place = placeOf(statusCode);
      events.push({
        code: statusCode,
        at: view.actualDeliveryAt ?? view.actualPickupAt ?? new Date(),
        ...(place?.city ? { city: place.city } : {}),
        ...(place?.state ? { state: place.state } : {}),
      });
    }

    const references = [
      ...(details?.transportOrder?.orderNumber
        ? [{ qualifier: 'CN', value: details.transportOrder.orderNumber }]
        : []),
      ...(details?.transportOrder?.customerReference
        ? [{ qualifier: 'PO', value: details.transportOrder.customerReference }]
        : []),
      ...(details?.load?.loadNumber ? [{ qualifier: 'SI', value: details.load.loadNumber }] : []),
    ];

    const x12 = build214(
      {
        referenceNumber: view.shipmentNumber,
        shipmentId: view.shipmentNumber,
        ...(details?.load?.carrier?.scacCode ? { scac: details.load.carrier.scacCode } : {}),
        ...(details?.load?.trailer?.unitNumber
          ? { equipmentNumber: details.load.trailer.unitNumber }
          : {}),
        references,
        events,
      },
      this.envelope(integration.config),
    );
    return {
      x12,
      shipmentNumber: view.shipmentNumber,
      status: view.status,
      eventCount: events.length,
      integrationKey: integration.key,
    };
  }

  /**
   * Queues the 214 on the existing webhook outbox (durable, retried, signed).
   * `config.format: 'x12'` makes `formatWebhookBody` ship `data.x12` verbatim as
   * `text/plain` — no duplicated delivery code here.
   */
  async send214(tenantId: string, userId: string, shipmentId: string, integrationKey?: string) {
    const integration = await this.resolveIntegrationByKey(tenantId, integrationKey);
    if (!nonEmpty(integration.config.url, '')) {
      throw new BadRequestException('This EDI integration has no outbound url configured');
    }
    const built = await this.build214ForShipment(tenantId, shipmentId, integration.key);
    const delivery = await this.webhooks.emitToIntegration(
      tenantId,
      integration.id,
      'shipment.214',
      {
        shipmentNumber: built.shipmentNumber,
        status: built.status,
        x12: built.x12,
      },
    );
    await this.audit
      .log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'shipment',
        entityId: shipmentId,
        after: { action: 'edi-214-send', integrationId: integration.id, deliveryId: delivery.id },
      })
      .catch((err) => this.logger.warn(`Audit log failed (non-fatal): ${String(err)}`));
    return {
      deliveryId: delivery.id,
      shipmentNumber: built.shipmentNumber,
      eventCount: built.eventCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves an `edi-*` integration of the tenant by key. Tenant-scoped (rule 1)
   * and restricted to the `edi-` namespace so this surface can never be pointed
   * at a webhook receiver's configuration.
   */
  async resolveIntegrationByKey(tenantId: string, key: string | undefined) {
    const wanted = (key ?? '').trim();
    if (!wanted) throw new BadRequestException('integrationKey is required');
    if (!wanted.startsWith(EDI_KEY_PREFIX)) {
      throw new BadRequestException('integrationKey must name an "edi-<partner>" integration');
    }
    const integration = await this.prisma.integration.findUnique({
      where: { tenantId_key: { tenantId, key: wanted } },
      select: { id: true, tenantId: true, name: true, key: true, status: true, config: true },
    });
    if (!integration) throw new NotFoundException(`Unknown EDI integration "${wanted}"`);
    if (integration.status !== 'ENABLED') {
      throw new ForbiddenException(`EDI integration "${wanted}" is not enabled`);
    }
    return {
      id: integration.id,
      name: integration.name,
      key: integration.key,
      config: this.crypto.decryptJson<EdiIntegrationConfig>(integration.config),
    };
  }

  /**
   * Outbound envelope. Control numbers are derived from the clock (9 digits,
   * monotonic within a partner's day) rather than a persisted counter — X12
   * only requires them to be unique-ish and to round-trip inside the
   * interchange, and `serializeX12` recomputes SE/GE/IEA from the content.
   */
  private envelope(config: EdiIntegrationConfig): X12EnvelopeOptions {
    const control = Number(String(Date.now()).slice(-9));
    // A partner form saves every field, so an unused GS id arrives as `''`, not
    // as `undefined` — `??` would let it through and emit an EMPTY GS02/GS03.
    const sender = nonEmpty(config.isaSenderId, 'PULSARTMS').slice(0, ISA_ID_WIDTH);
    const receiver = nonEmpty(config.isaReceiverId, 'PARTNER').slice(0, ISA_ID_WIDTH);
    return {
      senderId: sender,
      receiverId: receiver,
      applicationSender: nonEmpty(config.gsSenderId, sender).slice(0, ISA_ID_WIDTH),
      applicationReceiver: nonEmpty(config.gsReceiverId, receiver).slice(0, ISA_ID_WIDTH),
      interchangeControlNumber: control,
      groupControlNumber: control % 1_000_000,
      transactionControlNumber: 1,
      at: new Date(),
    };
  }
}

export { EdiDeclineError };
