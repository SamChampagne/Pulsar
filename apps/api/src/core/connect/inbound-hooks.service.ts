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

/** Hard cap on the accepted JSON body (the platform body parser caps first). */
export const MAX_HOOK_BODY_BYTES = 256 * 1024;
/** Cap on the payload copy kept in `InboundMessage.parsed` (inbox display). */
const MAX_STORED_PAYLOAD_CHARS = 8 * 1024;

const SENSITIVE_KEY = /secret|password|token|apikey|api_key|authorization|signature/i;

export interface InboundHookRequest {
  /** Raw token from the URL (never logged, never echoed). */
  token: string;
  /** Parsed JSON body. */
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
  status: 'IMPORTED' | 'FAILED';
  error?: string;
  /** true when this delivery was already processed (same idempotency key). */
  replayed?: boolean;
  entityType?: string;
  entityId?: string;
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

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
 *     The partner keeps one contract; the inbox row is the source of truth.
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
  ) {}

  async receive(input: InboundHookRequest): Promise<InboundHookResponse> {
    const { integration, config } = await this.resolveIntegration(input.token);
    const tenantId = integration.tenantId;

    const targetKey = typeof config.target === 'string' ? config.target : '';
    const target = getInboundHookTarget(targetKey);
    if (!target) {
      throw new BadRequestException('This receiver has no valid inbound target configured');
    }

    // Rule 15: a public route bypasses ModulesGuard, so the module is re-checked here.
    if (target.module) {
      const enabled = await this.modulesCache.getEnabledKeys(tenantId);
      if (!enabled.has(target.module)) {
        throw new ForbiddenException(`Module "${target.module}" is not enabled for this tenant`);
      }
    }

    const rawBody = input.rawBody;
    if (rawBody && rawBody.length > MAX_HOOK_BODY_BYTES) {
      throw new PayloadTooLargeException('Payload exceeds 256 KB');
    }

    this.verifySignature(config, rawBody, input.signature);

    const body = input.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Body must be a JSON object');
    }
    const payload = body as Record<string, unknown>;

    const dedupKey =
      input.idempotencyKey?.trim() ||
      sha256(rawBody ?? Buffer.from(JSON.stringify(payload), 'utf-8'));

    const replay = await this.prisma.inboundMessage.findFirst({
      where: { tenantId, dedupKey },
      select: { id: true, status: true, error: true, refType: true, refId: true },
    });
    if (replay) return this.asReplay(replay);

    // Claim the idempotency key BEFORE doing any work: the unique index
    // (tenantId, dedupKey) makes two concurrent identical deliveries race-safe.
    let message: { id: string };
    try {
      message = await this.prisma.inboundMessage.create({
        data: {
          tenantId,
          source: 'WEBHOOK',
          status: 'RECEIVED' as InboundStatus,
          kind: target.key,
          summary: `Webhook entrant — ${integration.name} (${target.label})`,
          dedupKey,
          parsed: {
            integrationId: integration.id,
            target: target.key,
            payload: redactStoredPayload(payload),
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.inboundMessage.findFirst({
          where: { tenantId, dedupKey },
          select: { id: true, status: true, error: true, refType: true, refId: true },
        });
        if (existing) return this.asReplay(existing);
      }
      throw err;
    }

    // Rule 13: the write is attributed to the tenant's hidden service account,
    // scoped to the single permission of the configured target.
    const serviceUserId = await this.apiKeys.ensureServiceUser(tenantId);
    const principal = {
      id: serviceUserId,
      tenantId,
      permissions: [target.permission],
    };

    let response: InboundHookResponse;
    try {
      const mapped = this.mapPayload(config, payload);
      const written = await this.writer.writeHookTarget(principal, target.key, mapped);
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
          target: target.key,
          status: response.status,
          ...(response.entityType ? { refType: response.entityType } : {}),
          ...(response.entityId ? { refId: response.entityId } : {}),
        },
      })
      .catch((err) => this.logger.warn(`Audit log failed (non-fatal): ${String(err)}`));

    return response;
  }

  private asReplay(row: {
    id: string;
    status: string;
    error: string | null;
    refType: string | null;
    refId: string | null;
  }): InboundHookResponse {
    return {
      inboxId: row.id,
      status: row.status === 'IMPORTED' ? 'IMPORTED' : 'FAILED',
      ...(row.error ? { error: row.error } : {}),
      ...(row.refType ? { entityType: row.refType } : {}),
      ...(row.refId ? { entityId: row.refId } : {}),
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
      select: { id: true, tenantId: true, name: true, status: true, config: true },
    });
    if (!integration || integration.status !== 'ENABLED') throw generic;
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
