import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import { createHash, randomBytes } from 'node:crypto';
import {
  applyIntegrationMapping,
  AuditAction,
  getInboundHookTarget,
  validateMappingPaths,
  checkWebhookUrl,
  PERMISSIONS,
  DOMAIN_EVENT_CATALOG,
  normalizeMappingRules,
  resolveWebhookTarget,
} from '@pulsar/shared';
import { OwnershipService } from '../../prisma/ownership.service';
import { mentionsEdi, normalizeEdiConfig } from './edi-identity';
import { PrismaService } from '../../prisma/prisma.service';
import { auditActor } from '../audit-logs/audit-actor';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CryptoService } from '../crypto/crypto.service';
import { WebhooksService } from './webhooks.service';

/**
 * The staff user performing a configuration write. Inbound receivers need more
 * than `core.integrations.manage`: pointing a receiver at a business target is
 * granting a partner that target's write permission, so the configuring user
 * must hold it too (the delivery itself runs as the service-account, rule 13).
 */
export interface ConfiguringUser {
  id: string;
  permissions: readonly string[];
}

export interface UpsertIntegrationInput {
  key: string;
  name: string;
  config?: Record<string, unknown>;
  status?: 'DISABLED' | 'ENABLED' | 'ERROR';
}

export interface StudioMappingRow {
  source: string;
  target: string;
  transform?: string;
  required?: boolean;
}

export interface StudioCheck {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'blocked';
  detail: string;
}

export interface ConnectionTestReport {
  status: 'ok' | 'warning' | 'blocked';
  summary: string;
  checkedAt: string;
  checks: StudioCheck[];
  /** True for a real network probe (webhook*), false for the config-shape simulation. */
  live?: boolean;
  statusCode?: number;
  latencyMs?: number;
}

export interface DryRunInput {
  samplePayload?: string;
  mappings?: StudioMappingRow[];
}

export interface DryRunReport {
  status: 'ok' | 'warning' | 'blocked';
  summary: string;
  checkedAt: string;
  rows: Array<StudioMappingRow & { status: 'mapped' | 'missing' | 'skipped'; value?: unknown }>;
  output: Record<string, unknown>;
  errors: string[];
}

const SENSITIVE_KEY = /secret|password|token|key/i;
const MASK = '***';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `config.mappings` (unknown JSON) → studio rows. Shape lives in @pulsar/shared. */
function normalizeMappingRows(value: unknown): StudioMappingRow[] {
  return normalizeMappingRules(value);
}

function redactUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'URL configurée';
  }
}

export function buildConnectionTestReport(integration: {
  id: string;
  name: string;
  status: 'DISABLED' | 'ENABLED' | 'ERROR';
  config: Record<string, unknown>;
}): ConnectionTestReport {
  const config = asObject(integration.config);
  const endpointUrl = asString(config.endpointUrl);
  const hasEndpoint = /^https?:\/\//i.test(endpointUrl);
  const hasCredential = ['apiKey', 'secret', 'webhookSecret', 'tenantReference'].some((key) =>
    Boolean(asString(config[key])),
  );
  const mappings = normalizeMappingRows(config.mappings);
  const objects = Array.isArray(config.objects)
    ? config.objects.filter((item) => typeof item === 'string')
    : [];
  const checks: StudioCheck[] = [
    {
      key: 'endpoint',
      label: 'Endpoint',
      status: hasEndpoint ? 'ok' : 'blocked',
      detail: hasEndpoint
        ? `${redactUrl(endpointUrl)} — simulation (contrôle de configuration, aucun appel réseau).`
        : 'Ajoute une URL https/http avant activation.',
    },
    {
      key: 'credential',
      label: 'Credentials',
      status: hasCredential ? 'ok' : 'blocked',
      detail: hasCredential
        ? 'Credential présent et masqué dans le rapport.'
        : 'API key, secret, webhook secret ou référence projet requis.',
    },
    {
      key: 'objects',
      label: 'Objets métier',
      status: objects.length ? 'ok' : 'warning',
      detail: objects.length
        ? `${objects.length} objet(s) sélectionné(s).`
        : 'Sélectionne au moins un objet pour documenter la portée.',
    },
    {
      key: 'mapping',
      label: 'Mapping',
      status: mappings.length ? 'ok' : 'warning',
      detail: mappings.length
        ? `${mappings.length} champ(s) dans le mapping.`
        : 'Ajoute au moins un mapping source → Pulsar.',
    },
  ];
  const status = checks.some((check) => check.status === 'blocked')
    ? 'blocked'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ok';
  return {
    status,
    summary:
      status === 'ok'
        ? 'Simulation : connexion prête pour un dry run.'
        : status === 'warning'
          ? 'Simulation : connexion testable, mais portée/mapping incomplet.'
          : 'Simulation : connexion bloquée avant dry run.',
    checkedAt: new Date().toISOString(),
    checks,
    live: false,
  };
}

export function buildDryRunMapping(input: DryRunInput): DryRunReport {
  const mappings = normalizeMappingRows(input.mappings);
  let payload: Record<string, unknown> = {};
  try {
    payload = asObject(input.samplePayload ? JSON.parse(input.samplePayload) : {});
  } catch {
    return {
      status: 'blocked',
      summary: 'Sample payload JSON invalide.',
      checkedAt: new Date().toISOString(),
      rows: [],
      output: {},
      errors: ['Sample payload JSON invalide.'],
    };
  }

  // Lenient mode: an unknown transform stays a no-op in the studio preview
  // (the inbound receiver runs the same engine with strictTransforms).
  const { output, rows, errors } = applyIntegrationMapping(payload, mappings);
  const status = errors.length
    ? 'warning'
    : rows.some((row) => row.status === 'mapped')
      ? 'ok'
      : 'blocked';
  return {
    status,
    summary:
      status === 'ok'
        ? 'Dry run réussi.'
        : status === 'warning'
          ? `${errors.length} champ(s) requis à corriger.`
          : 'Aucun mapping exploitable.',
    checkedAt: new Date().toISOString(),
    rows,
    output,
    errors,
  };
}

/**
 * API responses never expose secret values — they are replaced by "***".
 * FLAT configs only: nested objects pass through verbatim. Every config shape
 * in use today (WebhookConfig) is flat; a connector with nested secrets must
 * extend this before shipping.
 */
export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([k, v]) => [k, SENSITIVE_KEY.test(k) && v ? MASK : v]),
  );
}

/**
 * A client echoing back "***" means "keep the stored secret unchanged" (flat
 * keys only). Consequence: a literal secret value of "***" cannot be set —
 * the accepted trade-off of echo-back masking.
 */
export function mergePreservingMasked(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(incoming).map(([k, v]) => [k, v === MASK ? stored[k] : v]),
  );
}

/**
 * A `webhook*` integration's config always carries `eventsBackfilledAt` once
 * written through this service — on create AND on update — so
 * `WebhookEventsBackfillService` never re-widens an explicit empty allowlist
 * set later via PATCH. Preserves an already-stamped value (from the new
 * config, or — since `mergePreservingMasked` only carries over keys the
 * client resends — from the previously stored config); stamps now (ISO)
 * only when neither has one. No-op for non-webhook kinds.
 */
function withEventsBackfillStamp(
  key: string,
  config: Record<string, unknown>,
  previousStamp?: unknown,
): Record<string, unknown> {
  if (!key.startsWith('webhook')) return config;
  if (config.eventsBackfilledAt) return config;
  const stamp =
    typeof previousStamp === 'string' && previousStamp ? previousStamp : new Date().toISOString();
  return { ...config, eventsBackfilledAt: stamp };
}

/**
 * Integration *configuration* registry (EDI, telematics, ERP connectors...).
 * Configs are encrypted at rest (enc:v1 string in the Json column); legacy
 * plaintext rows are read transparently and re-encrypted on next write
 * (see apps/api/scripts/reencrypt-secrets.ts for the batch path).
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
    private readonly ownership: OwnershipService,
  ) {}

  /** Dev/CI escape hatch for loopback endpoints (WEBHOOK_ALLOW_PRIVATE_URLS=true). */
  private get allowPrivateUrls(): boolean {
    return this.config.get<string>('WEBHOOK_ALLOW_PRIVATE_URLS') === 'true';
  }

  /**
   * Egress guard (SSRF): an integration that Pulsar will POST to — `webhook*`
   * and EDI (outbound 214) — may only point at a public http/https endpoint.
   * Applied on every write and before a live ping. EDI is recognised by EITHER
   * half of its identity (`mentionsEdi`), so a half-declared receiver is checked
   * too instead of slipping past on its key alone.
   */
  private assertSafeWebhookConfig(key: string, config: Record<string, unknown>) {
    if (!key.startsWith('webhook') && !mentionsEdi(key, config)) return;
    const target = resolveWebhookTarget(config);
    if (!target) return;
    const check = checkWebhookUrl(target.url, { allowPrivate: this.allowPrivateUrls });
    if (!check.ok) throw new BadRequestException(check.reason);
  }

  /**
   * Config guard for an EDI integration.
   *
   * Keyed on `mentionsEdi` — EITHER an `edi-*` key OR `config.format: 'x12'` —
   * not on the key alone: the public receiver used to dispatch on the format,
   * so a receiver declaring only the format reached the EDI plane while this
   * gate never ran. `normalizeEdiConfig` then makes the two halves agree before
   * anything is persisted.
   *
   * The two foreign keys an interchange is written against — `customerId` (the
   * shipper a 204 becomes an order for) and `carrierId` (the carrier a 210 is
   * billed by) — are checked at SAVE time (rule 9), so the intake path can never
   * be pointed at another tenant's master data. Partner ids are bounded to the
   * 15 characters ISA05..ISA08 accept.
   */
  private async assertEdiConfigAllowed(
    tenantId: string,
    key: string,
    config: Record<string, unknown>,
    actor?: ConfiguringUser,
  ) {
    if (!mentionsEdi(key, config)) return;
    const customerId = asString(config.customerId) || undefined;
    const carrierId = asString(config.carrierId) || undefined;
    await this.ownership.assertOwnedIfSet('customer', customerId, tenantId);
    await this.ownership.assertOwnedIfSet('carrier', carrierId, tenantId);

    // Privilege gate — same shape as `assertInboundConfigAllowed`, but keyed on
    // the EDI config instead of `config.target` (an EDI receiver has none).
    // Setting `customerId` means "a 204 arriving here creates a transport
    // order"; setting `carrierId` means "a 210 creates an incoming carrier
    // invoice". Granting that to an anonymous door is granting the permission,
    // so the configuring user must hold it themselves (rule 13 spirit).
    if (actor) {
      for (const [id, permission, label] of [
        [customerId, PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE, 'transport orders'],
        [carrierId, PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE, 'incoming carrier invoices'],
      ] as const) {
        if (id && !actor.permissions.includes(permission)) {
          throw new ForbiddenException(
            `Permission "${permission}" is required to configure an inbound receiver writing ${label}`,
          );
        }
      }
    }

    for (const field of ['isaSenderId', 'isaReceiverId', 'gsSenderId', 'gsReceiverId']) {
      const value = asString(config[field]);
      if (value.length > 15) {
        throw new BadRequestException(`"${field}" must be at most 15 characters (X12 ISA width)`);
      }
    }
  }

  /** Documented business events a webhook integration can subscribe to. */
  eventCatalog() {
    return DOMAIN_EVENT_CATALOG;
  }

  /** Internal consumers (webhooks) get the decrypted config. */
  decryptedConfig<T = Record<string, unknown>>(stored: unknown): T {
    return this.crypto.decryptJson<T>(stored);
  }

  /**
   * API projection. The token hash never leaves the server (it is the
   * verifier of a live credential): callers get a boolean instead.
   */
  private present(integration: { config: unknown } & Record<string, unknown>) {
    const { inboundTokenHash, ...rest } = integration;
    return {
      ...rest,
      config: maskConfig(this.crypto.decryptJson(integration.config)),
      hasInboundToken: typeof inboundTokenHash === 'string' && inboundTokenHash.length > 0,
    };
  }

  /**
   * Guards a configuration write that (re)points an inbound receiver.
   *
   * Two checks, both refusing with 403:
   *  - `config.target` must be a known inbound target;
   *  - the configuring user must hold that target's own permission, on top of
   *    the `core.integrations.manage` already enforced by the controller.
   *
   * Also rejects prototype-walking mapping paths (`__proto__`, `constructor`,
   * `prototype`) with a 400 — a bad target never reaches storage.
   */
  private assertInboundConfigAllowed(config: Record<string, unknown>, actor?: ConfiguringUser) {
    const mappingErrors = validateMappingPaths(normalizeMappingRows(config.mappings));
    if (mappingErrors.length > 0) throw new BadRequestException(mappingErrors.join('; '));

    const targetKey = typeof config.target === 'string' ? config.target.trim() : '';
    if (!targetKey) return;
    const target = getInboundHookTarget(targetKey);
    if (!target) {
      throw new BadRequestException(`Unknown inbound target: "${targetKey}"`);
    }
    if (!actor) return; // internal caller (seed/tests) — no user context to check
    if (!actor.permissions.includes(target.permission)) {
      throw new ForbiddenException(
        `Permission "${target.permission}" is required to configure an inbound receiver writing ${target.label}`,
      );
    }
  }

  async list(tenantId: string) {
    const rows = await this.prisma.integration.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.present(row));
  }

  async create(tenantId: string, input: UpsertIntegrationInput, actor?: ConfiguringUser) {
    const existing = await this.prisma.integration.findUnique({
      where: { tenantId_key: { tenantId, key: input.key } },
    });
    if (existing) throw new ConflictException(`Integration "${input.key}" already exists`);
    this.assertSafeWebhookConfig(input.key, input.config ?? {});
    this.assertInboundConfigAllowed(input.config ?? {}, actor);
    // Reconcile the two halves of the EDI identity BEFORE the gate, so the gate
    // sees exactly what will be stored (and a mismatched pair is a 400).
    const ediConfig = normalizeEdiConfig(input.key, input.config ?? {});
    await this.assertEdiConfigAllowed(tenantId, input.key, ediConfig, actor);
    // A webhook integration created here already follows the current semantics
    // (empty `events` = every catalog event), so it must never be picked up by
    // WebhookEventsBackfillService — stamp the marker straight away.
    const config = withEventsBackfillStamp(input.key, ediConfig);
    const created = await this.prisma.integration.create({
      data: {
        tenantId,
        key: input.key,
        name: input.name,
        status: input.status ?? 'DISABLED',
        config: this.crypto.encryptJson(config) as Prisma.InputJsonValue,
      },
    });
    return this.present(created);
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<UpsertIntegrationInput>,
    actor?: ConfiguringUser,
  ) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    const stored = this.crypto.decryptJson<Record<string, unknown>>(integration.config);
    let merged = input.config
      ? withEventsBackfillStamp(
          integration.key,
          mergePreservingMasked(input.config, stored),
          stored.eventsBackfilledAt,
        )
      : undefined;
    if (merged) {
      this.assertSafeWebhookConfig(integration.key, merged);
      this.assertInboundConfigAllowed(merged, actor);
      merged = normalizeEdiConfig(integration.key, merged);
      await this.assertEdiConfigAllowed(tenantId, integration.key, merged, actor);
    }
    const updated = await this.prisma.integration.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        ...(merged ? { config: this.crypto.encryptJson(merged) as Prisma.InputJsonValue } : {}),
      },
    });
    return this.present(updated);
  }

  /**
   * Connection test. `webhook*` integrations get a REAL signed `ping` POST
   * (5 s timeout); every other kind still gets the configuration-shape
   * simulation, explicitly labelled as such.
   */
  async testConnection(
    tenantId: string,
    id: string,
    userId?: string,
  ): Promise<ConnectionTestReport> {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    const config = this.crypto.decryptJson(integration.config);

    const report = integration.key.startsWith('webhook')
      ? await this.pingWebhook(config)
      : buildConnectionTestReport({
          id: integration.id,
          name: integration.name,
          status: integration.status,
          config,
        });

    await this.audit.log({
      tenantId,
      userId: auditActor(userId),
      action: AuditAction.UPDATE,
      entityType: 'integration',
      entityId: integration.id,
      after: { action: 'test', live: report.live === true, status: report.status },
    });
    return report;
  }

  private async pingWebhook(config: Record<string, unknown>): Promise<ConnectionTestReport> {
    const target = resolveWebhookTarget(config);
    const url = target?.url ?? '';
    const checkedAt = new Date().toISOString();
    if (!url) {
      return {
        status: 'blocked',
        summary: 'Aucune URL de destination configurée.',
        checkedAt,
        live: true,
        checks: [
          {
            key: 'endpoint',
            label: 'Endpoint',
            status: 'blocked',
            detail: 'Ajoute une URL https/http avant de tester.',
          },
        ],
      };
    }

    const guard = checkWebhookUrl(url, { allowPrivate: this.allowPrivateUrls });
    if (!guard.ok) {
      return {
        status: 'blocked',
        summary: guard.reason,
        checkedAt,
        live: true,
        checks: [{ key: 'endpoint', label: 'Endpoint', status: 'blocked', detail: guard.reason }],
      };
    }

    const result = await this.webhooks.ping({
      url,
      secret: target?.secret,
      format: config.format as never,
    });
    const signed = Boolean(target?.secret);
    const checks: StudioCheck[] = [
      {
        key: 'endpoint',
        label: 'Endpoint',
        status: result.ok ? 'ok' : 'blocked',
        detail: result.ok
          ? `${redactUrl(url)} a répondu ${result.statusCode} en ${result.latencyMs} ms.`
          : `${redactUrl(url)} n'a pas répondu : ${result.error ?? 'erreur inconnue'}.`,
      },
      {
        key: 'signature',
        label: 'Signature',
        status: signed ? 'ok' : 'warning',
        detail: signed
          ? 'Ping signé (X-Pulsar-Signature, HMAC SHA-256).'
          : 'Aucun secret configuré : les livraisons ne seront pas signées.',
      },
    ];
    return {
      status: result.ok ? (signed ? 'ok' : 'warning') : 'blocked',
      summary: result.ok
        ? `Ping livré en ${result.latencyMs} ms.`
        : `Ping en échec : ${result.error ?? 'erreur inconnue'}.`,
      checkedAt,
      live: true,
      ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
      latencyMs: result.latencyMs,
      checks,
    };
  }

  async dryRun(tenantId: string, id: string, input: DryRunInput = {}) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    const config = this.crypto.decryptJson(integration.config);
    const mappings = input.mappings ?? normalizeMappingRows(config.mappings);
    const mappingErrors = validateMappingPaths(normalizeMappingRows(mappings));
    if (mappingErrors.length > 0) throw new BadRequestException(mappingErrors.join('; '));
    return buildDryRunMapping({
      samplePayload: input.samplePayload ?? asString(config.samplePayload),
      mappings,
    });
  }

  /**
   * Re-queue one delivery and retry it inline. Tenant-scoped: a delivery of
   * another tenant is a 404, never a replay.
   */
  async replayDelivery(
    tenantId: string,
    integrationId: string,
    deliveryId: string,
    userId?: string,
  ) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, tenantId, integrationId },
      select: { id: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    // Conditional claim (TOCTOU): only a delivery that is NOT already queued can
    // be re-queued, so two concurrent replays can't double-send, and we never
    // steal a delivery the cron is about to pick up.
    // `deliveredAt` is left untouched — it records the last successful delivery.
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, tenantId, integrationId, status: { not: 'PENDING' } },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    if (claimed.count === 0) {
      throw new ConflictException('Delivery is already queued for another attempt');
    }

    await this.webhooks.attempt(delivery.id);
    await this.audit.log({
      tenantId,
      userId: auditActor(userId),
      action: AuditAction.UPDATE,
      entityType: 'integration',
      entityId: integrationId,
      after: { action: 'replay', deliveryId: delivery.id },
    });
    return this.prisma.webhookDelivery.findUnique({ where: { id: delivery.id } });
  }

  /**
   * Issues (or rotates) the inbound webhook token of an integration.
   *
   * The raw token is returned ONCE and never stored: only its sha256 lands in
   * the indexed `inboundTokenHash` column, the same way API keys are handled.
   * Re-issuing invalidates the previous token immediately (single active token
   * per receiver). The audit trail records the rotation, never the secret.
   *
   * Authorization: `core.integrations.manage` (controller) AND the permission of
   * the configured `config.target` (here) — see `assertInboundConfigAllowed`.
   */
  async issueInboundToken(tenantId: string, id: string, actor?: ConfiguringUser) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');

    // Handing a partner a token for this receiver grants it the target's write
    // permission: the issuing user must hold that permission themselves (403).
    const storedConfig = this.crypto.decryptJson<Record<string, unknown>>(integration.config);
    this.assertInboundConfigAllowed(storedConfig, actor);
    // An EDI receiver carries no `config.target`: its own gate applies here too
    // (under the same `mentionsEdi` predicate), otherwise handing out a token
    // would grant what saving the config refused.
    await this.assertEdiConfigAllowed(tenantId, integration.key, storedConfig, actor);

    const token = randomBytes(32).toString('base64url');
    const inboundTokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { inboundTokenHash },
    });

    await this.audit.log({
      tenantId,
      userId: auditActor(actor?.id),
      action: AuditAction.UPDATE,
      entityType: 'integration',
      entityId: integration.id,
      after: { action: 'issue-inbound-token', rotated: integration.inboundTokenHash !== null },
    });

    const config = storedConfig;
    const target = typeof config.target === 'string' ? config.target : null;
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3000').replace(/\/+$/, '');
    return {
      token,
      url: `${apiUrl}/api/v1/public/hooks/${token}`,
      target,
      targetValid: target !== null && getInboundHookTarget(target) !== undefined,
      signed: typeof config.inboundSecret === 'string' && config.inboundSecret.length > 0,
      status: integration.status,
    };
  }

  async listDeliveries(tenantId: string, integrationId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return this.prisma.webhookDelivery.findMany({
      where: { tenantId, integrationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
