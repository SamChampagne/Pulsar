import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { getRuntimeProvider } from '@pulsar/shared';
import { remoteRuntimeEnabled } from './remote-runtime';
import * as path from 'node:path';
import type { AgentRuntimeConfig, Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { repoRoot } from './runtime-install';

export interface UpsertRuntimeInput {
  provider: string;
  authMode: string;
  apiKey?: string | null;
  defaultModel?: string | null;
  baseUrl?: string | null;
}

export interface RuntimeModelOption {
  value: string;
  label: string;
}

/** Public projection of the runtime config — NEVER includes the encrypted key. */
export interface RuntimeConfigProjection {
  updatedAt?: string;
  configured: boolean;
  provider?: string;
  authMode?: string;
  defaultModel?: string | null;
  baseUrl?: string | null;
  hasApiKey?: boolean;
  connectedAt?: Date | null;
  lastTestAt?: Date | null;
  lastTestOk?: boolean | null;
  availableModels?: RuntimeModelOption[];
}

/**
 * Per-tenant Hermes runtime configuration. Owns the encrypted provider API key
 * (enc:v1 via CryptoService) and the managed HERMES_HOME root. Spawning code
 * resolves the decrypted key through {@link resolveForSpawn}.
 */
@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(tenantId: string): Promise<AgentRuntimeConfig | null> {
    return this.prisma.agentRuntimeConfig.findUnique({ where: { tenantId } });
  }

  /** Public, key-free shape for API responses. */
  project(config: AgentRuntimeConfig | null): RuntimeConfigProjection {
    if (!config) return { configured: false };
    return {
      configured: true,
      updatedAt: config.updatedAt?.toISOString(),
      provider: config.provider,
      authMode: config.authMode,
      defaultModel: config.defaultModel,
      baseUrl: config.baseUrl,
      hasApiKey: !!config.apiKeyEnc,
      connectedAt: config.connectedAt,
      lastTestAt: config.lastTestAt,
      lastTestOk: config.lastTestOk,
      availableModels: Array.isArray(config.availableModels)
        ? (config.availableModels as unknown as RuntimeModelOption[])
        : [],
    };
  }

  /**
   * Creates or updates the tenant's runtime config. A non-empty `apiKey` is
   * encrypted at rest; an absent key is retained ONLY for the same identity.
   */
  async upsert(
    tenantId: string,
    input: UpsertRuntimeInput,
    platform?: { actorId: string; expectedUpdatedAt: string | null },
  ): Promise<AgentRuntimeConfig> {
    const provider = getRuntimeProvider(input.provider);
    if (!provider || provider.authMode !== input.authMode)
      throw new BadRequestException('Fournisseur ou mode d’authentification invalide.');
    if (input.authMode === 'login' && input.apiKey)
      throw new BadRequestException('Ce fournisseur utilise OAuth, pas une clé API.');
    if (input.baseUrl) {
      let url: URL;
      try {
        url = new URL(input.baseUrl);
      } catch {
        throw new BadRequestException('URL du fournisseur invalide.');
      }
      if (
        !provider.needsBaseUrl ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (remoteRuntimeEnabled() && (url.protocol !== 'https:' || (url.port && url.port !== '443')))
      )
        throw new BadRequestException(
          'URL fournisseur refusée. En production : HTTPS 443 sur un domaine autorisé par l’opérateur.',
        );
    }
    const hasKey = typeof input.apiKey === 'string' && input.apiKey.length > 0;
    const apiKeyEnc = hasKey ? this.crypto.encryptString(input.apiKey as string) : undefined;

    return this.prisma.$transaction(async (tx) => {
      // Serialize read/preserve/write: changing provider or endpoint must never
      // forward the previous provider's credential to a different destination.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${tenantId}`}, 0))`;
      const current = await tx.agentRuntimeConfig.findUnique({ where: { tenantId } });
      if (platform && (current?.updatedAt.toISOString() ?? null) !== platform.expectedUpdatedAt)
        throw new ConflictException('La connexion IA a changé. Rechargez avant de sauvegarder.');
      const identityChanged =
        !!current &&
        (current.provider !== input.provider ||
          current.authMode !== input.authMode ||
          current.baseUrl !== (input.baseUrl ?? null));
      const changed =
        !current ||
        identityChanged ||
        hasKey ||
        current.defaultModel !== (input.defaultModel ?? null);
      const saved = await tx.agentRuntimeConfig.upsert({
        where: { tenantId },
        create: {
          tenantId,
          provider: input.provider,
          authMode: input.authMode,
          defaultModel: input.defaultModel ?? null,
          baseUrl: input.baseUrl ?? null,
          ...(apiKeyEnc !== undefined ? { apiKeyEnc } : {}),
        },
        update: {
          updatedAt: new Date(Math.max(Date.now(), (current?.updatedAt?.getTime() ?? 0) + 1)),
          provider: input.provider,
          authMode: input.authMode,
          defaultModel: input.defaultModel ?? null,
          baseUrl: input.baseUrl ?? null,
          ...(input.authMode === 'login'
            ? { apiKeyEnc: null }
            : apiKeyEnc !== undefined
              ? { apiKeyEnc }
              : identityChanged
                ? { apiKeyEnc: null }
                : {}),
          ...(identityChanged ? { connectedAt: null } : {}),
          ...(changed ? { lastTestAt: null, lastTestOk: null, availableModels: [] } : {}),
        },
      });
      if (platform)
        await tx.platformServiceAudit.create({
          data: {
            actorId: platform.actorId,
            tenantId,
            service: 'tenant-ai',
            action: 'CONFIGURE',
            detail: {
              provider: input.provider,
              authMode: input.authMode,
              identityChanged,
              hasApiKey: !!saved.apiKeyEnc,
            },
          },
        });
      return saved;
    });
  }

  /** Resolves the config + decrypted key for spawning. Throws if unconfigured. */
  async resolveForSpawn(
    tenantId: string,
  ): Promise<{ config: AgentRuntimeConfig; decryptedKey: string | null }> {
    const config = await this.get(tenantId);
    if (!config) {
      throw new BadRequestException('Agent runtime not configured');
    }
    const decryptedKey = config.apiKeyEnc ? this.crypto.decryptString(config.apiKeyEnc) : null;
    return { config, decryptedKey };
  }

  async markConnected(tenantId: string, expectedUpdatedAt?: Date): Promise<void> {
    const result = await this.prisma.agentRuntimeConfig.updateMany({
      where: { tenantId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
      data: { connectedAt: new Date() },
    });
    if (result.count !== 1)
      throw new BadRequestException('La configuration a changé; reconnectez le fournisseur.');
  }

  async markTested(
    tenantId: string,
    ok: boolean,
    models?: RuntimeModelOption[],
    expectedUpdatedAt?: Date,
  ): Promise<void> {
    const result = await this.prisma.agentRuntimeConfig.updateMany({
      where: { tenantId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
      data: {
        lastTestAt: new Date(),
        lastTestOk: ok,
        ...(ok && models ? { availableModels: models as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    if (result.count !== 1)
      throw new BadRequestException('La configuration a changé; relancez le contrôle.');
  }

  /**
   * Root dir for per-tenant HERMES_HOME. Defaults to the gitignored
   * `hermes-agent/.hermes-home/` under the repo root; override with
   * `HERMES_HOME_ROOT`.
   */
  hermesHomeRoot(): string {
    return process.env.HERMES_HOME_ROOT ?? path.join(repoRoot(), 'hermes-agent', '.hermes-home');
  }
}
