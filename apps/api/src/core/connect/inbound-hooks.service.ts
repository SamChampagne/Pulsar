import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  applyIntegrationMapping,
  AuditAction,
  getInboundHookTarget,
  normalizeMappingRules,
  type InboundStatus,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CryptoService } from '../crypto/crypto.service';
import { ConnectRecordWriter } from './record-writer.service';
import { isEdiIntegration } from '../integrations/edi-identity';
import { ediDedupKey, EdiService, MAX_EDI_BYTES } from './edi.service';

/** Hard cap on the accepted JSON body (the platform body parser caps first). */
export const MAX_HOOK_BODY_BYTES = 256 * 1024;
/** Cap on the payload copy kept in `InboundMessage.parsed` (inbox display). */
const MAX_STORED_PAYLOAD_CHARS = 8 * 1024;
/**
 * A row still `RECEIVED` after this long means the process died between the
 * idempotency claim and the outcome — a replay is allowed to re-process it
 * instead of answering FAILED forever.
 */
const STUCK_RECEIVED_MS = 2 * 60 * 1000;

const SENSITIVE_KEY = /secret|password|token|apikey|api_key|authorization|signature/i;

export interface InboundHookRequest {
  /** Raw token from the URL (never logged, never echoed). */
  token: string;
  /** Parsed JSON body, or the raw interchange string for an EDI receiver. */
  body: unknown;
  /** Exact bytes as received — required for HMAC and for the default dedup key. */
  rawBody?: Buffer;
  /** `X-Signature: sha256=<hex>` header value, when the partner signs. */
  signature?: string;
  /** `X-Idempotency-Key` header value, when the partner sends one. */
  idempotencyKey?: string;
}

export interface InboundHookResponse {
  inboxId: string;
  /**
   * Outcome of THIS delivery, or the real stored status of an earlier one.
   * `RECEIVED` means another delivery with the same idempotency key is being
   * processed right now — retry later.
   */
  status: InboundStatus;
  error?: string;
  /** true when this delivery was already processed (same idempotency key). */
  replayed?: boolean;
  entityType?: string;
  entityId?: string;
  /** EDI receivers only: the 990 interchange answering a 204 (accept or decline). */
  ack?: string;
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** The inbox columns a replay answer is built from. */
interface ReplayableRow {
  id: string;
  status: string;
  error: string | null;
  refType: string | null;
  refId: string | null;
  parsed: unknown;
}

/** Drops obvious secrets and caps the size of the payload copy kept in the inbox. */
export function redactStoredPayload(body: unknown): unknown {
  const redact = (value: unknown, depth: number): unknown => {
    if (depth > 6 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '***' : redact(v, depth + 1),
      ]),
    );
  };
  const redacted = redact(body, 0);
  const serialized = JSON.stringify(redacted) ?? '';
  if (serialized.length <= MAX_STORED_PAYLOAD_CHARS) return redacted;
  return { truncated: true, preview: serialized.slice(0, MAX_STORED_PAYLOAD_CHARS) };
}

/**
 * Inbound webhook receiver (`POST /public/hooks/:inboundToken`).
 *
 * The door is unauthenticated in the JWT sense: the token IS the credential
 * (hashed at rest in `Integration.inboundTokenHash`). Everything after that is
 * the ordinary write path — module gate (rule 15), permission re-check under
 * the tenant service-account (rule 13), business services only (rule 55).
 *
 * Failure semantics, deliberately chosen (documented in docs/collaboration.md):
 *   - token / signature / module problems are HTTP errors (404 / 401 / 403) and
 *     leave no inbox row: the delivery was never accepted;
 *   - a delivery that IS accepted always answers 202 with an inbox id, even when
 *     the mapping or the business write failed (`status: 'FAILED'`, `error`).
 *     The partner keeps one contract; the inbox row is the source of truth;
 *   - a replay answers 200 with the ORIGINAL status, and a row left `RECEIVED`
 *     by a crashed attempt is re-processed after {@link STUCK_RECEIVED_MS}
 *     rather than replaying a phantom failure forever.
 */
@Injectable()
export class InboundHooksService {
  private readonly logger = new Logger(InboundHooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly writer: ConnectRecordWriter,
    private readonly audit: AuditLogsService,
    private readonly apiKeys: ApiKeysService,
    private readonly edi: EdiService,
  ) {}

  async receive(input: InboundHookRequest): Promise<InboundHookResponse> {
    const { integration, config } = await this.resolveIntegration(input.token);
    const tenantId = integration.tenantId;

    // An EDI receiver has no `config.target`: the transaction set inside the
    // interchange decides what is written, and EdiService re-checks the module
    // of whichever business service it ends up calling (rule 15).
    //
    // BOTH halves of the identity are required here (`edi-*` key AND format
    // `x12`). Dispatching on the format alone was a bypass: a receiver on an
    // arbitrary key could reach the EDI plane while the `edi-*`-keyed
    // configuration gates never ran. A legacy row declaring only the format is
    // therefore handled as an ordinary JSON webhook (and refused for want of a
    // valid `config.target`), never as EDI.
    const isEdi = isEdiIntegration(integration.key, config);

    const targetKey = typeof config.target === 'string' ? config.target : '';
    const target = getInboundHookTarget(targetKey);
    if (!isEdi && !target) {
      throw new BadRequestException('This receiver has no valid inbound target configured');
    }

    // Rule 15: a public route bypasses ModulesGuard, so the module is re-checked here.
    if (target?.module) {
      const enabled = await this.modulesCache.getEnabledKeys(tenantId);
      if (!enabled.has(target.module)) {
        throw new ForbiddenException(`Module "${target.module}" is not enabled for this tenant`);
      }
    }

    const rawBody = input.rawBody;
    const maxBytes = isEdi ? MAX_EDI_BYTES : MAX_HOOK_BODY_BYTES;
    if (rawBody && rawBody.length > maxBytes) {
      throw new PayloadTooLargeException(
        isEdi ? 'Payload exceeds 512 KB' : 'Payload exceeds 256 KB',
      );
    }

    this.verifySignature(config, rawBody, input.signature);

    const body = input.body;
    let content = '';
    let payload: Record<string, unknown> = {};
    if (isEdi) {
      content = (typeof body === 'string' ? body : (rawBody?.toString('utf-8') ?? '')).trim();
      if (!content) {
        throw new BadRequestException('Body must be a raw X12 interchange (text/plain)');
      }
    } else {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new BadRequestException('Body must be a JSON object');
      }
      payload = body as Record<string, unknown>;
    }

    // EDI shares ONE idempotency namespace with the authenticated door
    // (`edi:<sha256 of the trimmed interchange>`), so the same interchange is a
    // replay whichever door it arrives through. An `X-Idempotency-Key` header is
    // deliberately ignored there — the interchange itself is the identity.
    const dedupKey = isEdi
      ? ediDedupKey(content)
      : input.idempotencyKey?.trim() ||
        sha256(rawBody ?? Buffer.from(JSON.stringify(payload), 'utf-8'));

    const existing = await this.findByDedupKey(tenantId, dedupKey);
    let messageId: string | undefined;
    if (existing) {
      const decision = await this.resolveExisting(tenantId, existing);
      if (decision.response) return decision.response;
      messageId = decision.reprocessId;
    }

    // Claim the idempotency key BEFORE doing any work: the unique index
    // (tenantId, dedupKey) makes two concurrent identical deliveries race-safe.
    if (!messageId) {
      try {
        const created = await this.prisma.inboundMessage.create({
          data: {
            tenantId,
            source: isEdi ? 'EDI' : 'WEBHOOK',
            status: 'RECEIVED' as InboundStatus,
            kind: isEdi ? 'edi' : target!.key,
            summary: isEdi
              ? `EDI entrant — ${integration.name}`
              : `Webhook entrant — ${integration.name} (${target!.label})`,
            dedupKey,
            parsed: isEdi
              ? ({
                  integrationId: integration.id,
                  bytes: Buffer.byteLength(content, 'utf-8'),
                } as Prisma.InputJsonValue)
              : ({
                  integrationId: integration.id,
                  target: target!.key,
                  payload: redactStoredPayload(payload),
                } as Prisma.InputJsonValue),
          },
          select: { id: true },
        });
        messageId = created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const raced = await this.findByDedupKey(tenantId, dedupKey);
          if (raced) {
            const decision = await this.resolveExisting(tenantId, raced);
            if (decision.response) return decision.response;
            messageId = decision.reprocessId;
          }
        }
        if (!messageId) throw err;
      }
    }
    const message = { id: messageId };

    // EDI plane: the interchange decides what is written. EdiService owns the
    // rest of the row's lifecycle (status, refs, audit) — same service account,
    // same journalling, no duplicated write path here.
    if (isEdi) {
      const outcome = await this.edi.processDelivery({
        tenantId,
        integrationId: integration.id,
        integrationKey: integration.key,
        integrationName: integration.name,
        config,
        content,
        inboxId: message.id,
      });
      return {
        inboxId: message.id,
        status: outcome.status,
        ...(outcome.error ? { error: outcome.error } : {}),
        ...(outcome.entityType ? { entityType: outcome.entityType } : {}),
        ...(outcome.entityId ? { entityId: outcome.entityId } : {}),
        ...(outcome.ack ? { ack: outcome.ack } : {}),
      };
    }

    // Rule 13: the write is attributed to the tenant's hidden service account,
    // scoped to the single permission of the configured target.
    const serviceUserId = await this.apiKeys.ensureServiceUser(tenantId);
    const principal = {
      id: serviceUserId,
      tenantId,
      permissions: [target!.permission],
    };

    let response: InboundHookResponse;
    try {
      const mapped = this.mapPayload(config, payload);
      const written = await this.writer.writeHookTarget(principal, target!.key, mapped);
      await this.prisma.inboundMessage.update({
        where: { id: message.id },
        data: {
          status: 'IMPORTED' as InboundStatus,
          summary: `Webhook entrant — ${integration.name} — ${written.summary}`,
          refType: written.entityType,
          refId: written.entityId,
          createdById: serviceUserId,
        },
      });
      response = {
        inboxId: message.id,
        status: 'IMPORTED',
        entityType: written.entityType,
        entityId: written.entityId,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Inbound hook ${integration.id} failed: ${error}`);
      await this.prisma.inboundMessage.update({
        where: { id: message.id },
        data: { status: 'FAILED' as InboundStatus, error, createdById: serviceUserId },
      });
      response = { inboxId: message.id, status: 'FAILED', error };
    }

    // Rule 6/13: audited under the service account, never with the token.
    await this.audit
      .log({
        tenantId,
        userId: serviceUserId,
        action: AuditAction.CREATE,
        entityType: 'inbound-message',
        entityId: message.id,
        after: {
          source: 'WEBHOOK',
          integrationId: integration.id,
          target: target!.key,
          status: response.status,
          ...(response.entityType ? { refType: response.entityType } : {}),
          ...(response.entityId ? { refId: response.entityId } : {}),
        },
      })
      .catch((err) => this.logger.warn(`Audit log failed (non-fatal): ${String(err)}`));

    return response;
  }

  private findByDedupKey(tenantId: string, dedupKey: string) {
    return this.prisma.inboundMessage.findFirst({
      where: { tenantId, dedupKey },
      select: {
        id: true,
        status: true,
        error: true,
        refType: true,
        refId: true,
        updatedAt: true,
        // EDI rows keep the 990 we answered and the partner-safe reason here.
        parsed: true,
      },
    });
  }

  /**
   * Decides what to do with an inbox row already carrying this idempotency key.
   *
   *  - terminal row (IMPORTED / FAILED / IGNORED / PARSED) → replay the ORIGINAL
   *    result, nothing is re-executed;
   *  - RECEIVED and fresh → another delivery is in flight right now: answer 202
   *    `RECEIVED` without touching it;
   *  - RECEIVED and older than {@link STUCK_RECEIVED_MS} → the previous attempt
   *    died between the claim and its outcome; re-process it. The re-claim is a
   *    conditional `updateMany` (and `@updatedAt` bumps the row), so two
   *    concurrent replays can never both re-run the write.
   */
  private async resolveExisting(
    tenantId: string,
    row: ReplayableRow & { updatedAt: Date },
  ): Promise<{ response?: InboundHookResponse; reprocessId?: string }> {
    if (row.status !== 'RECEIVED') return { response: this.asReplay(row) };

    const cutoff = new Date(Date.now() - STUCK_RECEIVED_MS);
    if (row.updatedAt > cutoff) {
      return { response: { inboxId: row.id, status: 'RECEIVED' } };
    }
    const claimed = await this.prisma.inboundMessage.updateMany({
      where: { id: row.id, tenantId, status: 'RECEIVED', updatedAt: { lte: cutoff } },
      data: { error: null },
    });
    if (claimed.count === 0) {
      // Lost the race: whoever won is processing it now.
      return { response: { inboxId: row.id, status: 'RECEIVED' } };
    }
    this.logger.warn(`Inbound message ${row.id} was stuck in RECEIVED — re-processing`);
    return { reprocessId: row.id };
  }

  private asReplay(row: ReplayableRow): InboundHookResponse {
    // An EDI row stores the 990 it answered and a PARTNER-SAFE reason in
    // `parsed`; `error` there is the internal detail and must not be echoed.
    const parsed = (row.parsed ?? {}) as { ack?: string; publicError?: string };
    const error = parsed.publicError ?? (parsed.ack ? undefined : (row.error ?? undefined));
    return {
      inboxId: row.id,
      // The REAL status — never collapsed to FAILED.
      status: row.status as InboundStatus,
      ...(error ? { error } : {}),
      ...(row.refType ? { entityType: row.refType } : {}),
      ...(row.refId ? { entityId: row.refId } : {}),
      ...(parsed.ack ? { ack: parsed.ack } : {}),
      replayed: true,
    };
  }

  /**
   * Resolves the receiver by the SHA-256 of the presented token. An unknown
   * token and a disabled integration answer the exact same 404: a probe learns
   * nothing about which receivers exist.
   */
  private async resolveIntegration(token: string) {
    const generic = new NotFoundException('Unknown inbound hook');
    if (!token || token.length < 16 || token.length > 128) throw generic;
    const integration = await this.prisma.integration.findUnique({
      where: { inboundTokenHash: sha256(token) },
      select: {
        id: true,
        tenantId: true,
        key: true,
        name: true,
        status: true,
        config: true,
        tenant: { select: { status: true } },
      },
    });
    if (!integration || integration.status !== 'ENABLED') throw generic;
    // A suspended tenant keeps no write surface at all — same convention as
    // AuthService/PortalAuthService (TRIAL and ACTIVE are both live).
    if (integration.tenant.status === 'SUSPENDED') throw generic;
    let config: Record<string, unknown>;
    try {
      config = this.crypto.decryptJson(integration.config);
    } catch {
      // Unreadable config (rotated key): never leak the reason to the caller.
      this.logger.error(`Integration ${integration.id}: unreadable config`);
      throw generic;
    }
    return { integration, config };
  }

  /** Constant-time HMAC check; only enforced when the receiver declares a secret. */
  private verifySignature(
    config: Record<string, unknown>,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    const secret = typeof config.inboundSecret === 'string' ? config.inboundSecret : '';
    if (!secret) return;
    if (!rawBody) {
      // Fail loudly rather than accept an unverifiable delivery.
      throw new InternalServerErrorException(
        'Raw body capture is disabled; cannot verify the signature',
      );
    }
    const provided = (signature ?? '').trim().replace(/^sha256=/i, '');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(provided, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid signature');
    }
  }

  /**
   * Partner payload → business fields. With no `config.mappings` the body is
   * taken as-is (identity mapping), which is what a partner already speaking
   * Pulsar's field names wants. Strict transforms: an unknown transform is an
   * error here, never a silent pass-through.
   */
  private mapPayload(
    config: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const rules = normalizeMappingRules(config.mappings);
    if (rules.length === 0) return payload;
    const result = applyIntegrationMapping(payload, rules, { strictTransforms: true });
    if (result.errors.length > 0) {
      throw new BadRequestException(`Mapping: ${result.errors.join('; ')}`);
    }
    return result.output;
  }
}
