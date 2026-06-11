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

const SENSITIVE_KEY = /secret|password|token|key/i;
const MASK = '***';

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
