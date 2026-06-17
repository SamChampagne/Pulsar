import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

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
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asMappingRows(value: unknown): StudioMappingRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      source: asString(item.source),
      target: asString(item.target),
      transform: asString(item.transform) || 'none',
      required: Boolean(item.required),
    }))
    .filter((item) => item.source || item.target);
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return;
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function applyTransform(value: unknown, transform?: string): unknown {
  if (value == null) return value;
  const op = transform || 'none';
  if (op === 'trim' && typeof value === 'string') return value.trim();
  if (op === 'uppercase' && typeof value === 'string') return value.toUpperCase();
  if (op === 'number') return Number(value);
  if (op === 'date.iso') return new Date(String(value)).toISOString();
  return value;
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
  const hasCredential = ['apiKey', 'secret', 'webhookSecret', 'tenantReference'].some((key) => Boolean(asString(config[key])));
  const mappings = asMappingRows(config.mappings);
  const objects = Array.isArray(config.objects) ? config.objects.filter((item) => typeof item === 'string') : [];
  const checks: StudioCheck[] = [
    {
      key: 'endpoint',
      label: 'Endpoint',
      status: hasEndpoint ? 'ok' : 'blocked',
      detail: hasEndpoint ? `${redactUrl(endpointUrl)} répondra au test réel bientôt` : 'Ajoute une URL https/http avant activation.',
    },
    {
      key: 'credential',
      label: 'Credentials',
      status: hasCredential ? 'ok' : 'blocked',
      detail: hasCredential ? 'Credential présent et masqué dans le rapport.' : 'API key, secret, webhook secret ou référence projet requis.',
    },
    {
      key: 'objects',
      label: 'Objets métier',
      status: objects.length ? 'ok' : 'warning',
      detail: objects.length ? `${objects.length} objet(s) sélectionné(s).` : 'Sélectionne au moins un objet pour documenter la portée.',
    },
    {
      key: 'mapping',
      label: 'Mapping',
      status: mappings.length ? 'ok' : 'warning',
      detail: mappings.length ? `${mappings.length} champ(s) dans le mapping.` : 'Ajoute au moins un mapping source → Pulsar.',
    },
  ];
  const status = checks.some((check) => check.status === 'blocked')
    ? 'blocked'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ok';
  return {
    status,
    summary: status === 'ok' ? 'Connexion prête pour un dry run.' : status === 'warning' ? 'Connexion testable, mais portée/mapping incomplet.' : 'Connexion bloquée avant dry run.',
    checkedAt: new Date().toISOString(),
    checks,
  };
}

export function buildDryRunMapping(input: DryRunInput): DryRunReport {
  const mappings = asMappingRows(input.mappings);
  const errors: string[] = [];
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

  const output: Record<string, unknown> = {};
  const rows = mappings.map((mapping) => {
    if (!mapping.source || !mapping.target) {
      return { ...mapping, status: 'skipped' as const };
    }
    const raw = getPath(payload, mapping.source);
    if (raw == null || raw === '') {
      if (mapping.required) errors.push(`Champ requis manquant: ${mapping.source}`);
      return { ...mapping, status: 'missing' as const };
    }
    const value = applyTransform(raw, mapping.transform);
    setPath(output, mapping.target, value);
    return { ...mapping, status: 'mapped' as const, value };
  });
  const status = errors.length ? 'warning' : rows.some((row) => row.status === 'mapped') ? 'ok' : 'blocked';
  return {
    status,
    summary: status === 'ok' ? 'Dry run réussi.' : status === 'warning' ? `${errors.length} champ(s) requis à corriger.` : 'Aucun mapping exploitable.',
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
  ) {}

  /** Internal consumers (webhooks) get the decrypted config. */
  decryptedConfig<T = Record<string, unknown>>(stored: unknown): T {
    return this.crypto.decryptJson<T>(stored);
  }

  private present(integration: { config: unknown } & Record<string, unknown>) {
    return { ...integration, config: maskConfig(this.crypto.decryptJson(integration.config)) };
  }

  async list(tenantId: string) {
    const rows = await this.prisma.integration.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.present(row));
  }

  async create(tenantId: string, input: UpsertIntegrationInput) {
    const existing = await this.prisma.integration.findUnique({
      where: { tenantId_key: { tenantId, key: input.key } },
    });
    if (existing) throw new ConflictException(`Integration "${input.key}" already exists`);
    const created = await this.prisma.integration.create({
      data: {
        tenantId,
        key: input.key,
        name: input.name,
        status: input.status ?? 'DISABLED',
        config: this.crypto.encryptJson(input.config ?? {}) as Prisma.InputJsonValue,
      },
    });
    return this.present(created);
  }

  async update(tenantId: string, id: string, input: Partial<UpsertIntegrationInput>) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    const stored = this.crypto.decryptJson(integration.config);
    const updated = await this.prisma.integration.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        ...(input.config
          ? {
              config: this.crypto.encryptJson(
                mergePreservingMasked(input.config, stored),
              ) as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    return this.present(updated);
  }

  async testConnection(tenantId: string, id: string) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    return buildConnectionTestReport({
      id: integration.id,
      name: integration.name,
      status: integration.status,
      config: this.crypto.decryptJson(integration.config),
    });
  }

  async dryRun(tenantId: string, id: string, input: DryRunInput = {}) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    const config = this.crypto.decryptJson(integration.config);
    return buildDryRunMapping({
      samplePayload: input.samplePayload ?? asString(config.samplePayload),
      mappings: input.mappings ?? asMappingRows(config.mappings),
    });
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
