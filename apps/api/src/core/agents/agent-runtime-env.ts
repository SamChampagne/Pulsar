import * as path from 'node:path';
import { getRuntimeProvider } from '@pulsar/shared';

/**
 * The persisted runtime config shape this helper needs. Mirrors the relevant
 * columns of the `AgentRuntimeConfig` Prisma model (T3) — kept local so the
 * pure helper has no Prisma dependency.
 */
export interface RuntimeConfigInput {
  tenantId: string;
  provider: string;
  authMode: string;
  defaultModel?: string | null;
  baseUrl?: string | null;
}

export interface RuntimeEnv {
  env: Record<string, string>;
  homeDir: string;
}

/**
 * Builds the spawn environment for a tenant's Hermes runtime.
 *
 * - `HERMES_HOME` is always set to a per-tenant dir under `hermesHomeRoot`
 *   (Hermes warns spawners must propagate it — docs/agents-runtime-notes.md §3).
 * - For `apiKey` providers, the decrypted key lands in the provider's env var
 *   (e.g. `OPENROUTER_API_KEY`) — never on disk.
 * - For base-url providers (OpenAI-compatible / custom) `OPENAI_BASE_URL` is set
 *   when a baseUrl is configured (docs §2, cli-config.yaml.example:36-37).
 * - Login providers get no key env (credentials live in HERMES_HOME after
 *   `hermes login` / `hermes auth`).
 */
export function buildRuntimeEnv(
  config: RuntimeConfigInput,
  decryptedKey: string | null,
  hermesHomeRoot: string,
): RuntimeEnv {
  const homeDir = path.join(hermesHomeRoot, config.tenantId);
  const env: Record<string, string> = { HERMES_HOME: homeDir };

  const provider = getRuntimeProvider(config.provider);
  if (config.authMode === 'apiKey' && decryptedKey && provider?.keyEnvVar) {
    env[provider.keyEnvVar] = decryptedKey;
  }
  if (provider?.needsBaseUrl && config.baseUrl) {
    env.OPENAI_BASE_URL = config.baseUrl;
  }

  return { env, homeDir };
}

/**
 * Renders the minimal `cli-config.yaml` pinning the provider + model.
 * Keys match docs/agents-runtime-notes.md §1 exactly: `model.provider`,
 * `model.default`, optional `model.base_url`. The provider VALUE is Hermes'
 * `providerKey` (cli-config.yaml.example:13-33), not Pulsar's provider id.
 */
export function renderCliConfig(config: RuntimeConfigInput): string {
  const provider = getRuntimeProvider(config.provider);
  const providerKey = provider?.providerKey ?? config.provider;
  const lines = ['model:', `  provider: "${providerKey}"`];
  if (config.defaultModel) {
    lines.push(`  default: "${config.defaultModel}"`);
  }
  if (config.baseUrl) {
    lines.push(`  base_url: "${config.baseUrl}"`);
  }
  return lines.join('\n') + '\n';
}
