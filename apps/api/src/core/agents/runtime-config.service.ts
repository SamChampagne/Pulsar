import { BadRequestException, Injectable } from '@nestjs/common';
import * as path from 'node:path';
import type { AgentRuntimeConfig } from '@pulsar/database';
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

/** Public projection of the runtime config — NEVER includes the encrypted key. */
export interface RuntimeConfigProjection {
  configured: boolean;
  provider?: string;
  authMode?: string;
  defaultModel?: string | null;
  baseUrl?: string | null;
  hasApiKey?: boolean;
  connectedAt?: Date | null;
  lastTestAt?: Date | null;
  lastTestOk?: boolean | null;
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
      provider: config.provider,
      authMode: config.authMode,
      defaultModel: config.defaultModel,
      baseUrl: config.baseUrl,
      hasApiKey: !!config.apiKeyEnc,
      connectedAt: config.connectedAt,
      lastTestAt: config.lastTestAt,
      lastTestOk: config.lastTestOk,
    };
  }

  /**
   * Creates or updates the tenant's runtime config. A non-empty `apiKey` is
   * encrypted at rest; when absent, the existing `apiKeyEnc` is preserved.
   */
  async upsert(tenantId: string, input: UpsertRuntimeInput): Promise<AgentRuntimeConfig> {
    const hasKey = typeof input.apiKey === 'string' && input.apiKey.length > 0;
    const apiKeyEnc = hasKey ? this.crypto.encryptString(input.apiKey as string) : undefined;

    return this.prisma.agentRuntimeConfig.upsert({
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
        provider: input.provider,
        authMode: input.authMode,
        defaultModel: input.defaultModel ?? null,
        baseUrl: input.baseUrl ?? null,
        // Preserve existing apiKeyEnc when no new key is supplied.
        ...(apiKeyEnc !== undefined ? { apiKeyEnc } : {}),
      },
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

  async markConnected(tenantId: string): Promise<void> {
    await this.prisma.agentRuntimeConfig.update({
      where: { tenantId },
      data: { connectedAt: new Date() },
    });
  }

  async markTested(tenantId: string, ok: boolean): Promise<void> {
    await this.prisma.agentRuntimeConfig.update({
      where: { tenantId },
      data: { lastTestAt: new Date(), lastTestOk: ok },
    });
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
