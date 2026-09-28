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

/** A child receives OS plumbing, never the API's DB/JWT/SMTP/provider credentials. */
export function isolatedRuntimeEnv(
  tenantEnv: Record<string, string>,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const allowed = new Set([
    'PATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'TZ',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) result[key] = value;
  }
  return {
    ...result,
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    // Prevent provider CLIs from finding the operator's personal credentials.
    HOME: tenantEnv.HERMES_HOME,
    USERPROFILE: tenantEnv.HERMES_HOME,
    APPDATA: path.join(tenantEnv.HERMES_HOME, '.config'),
    LOCALAPPDATA: path.join(tenantEnv.HERMES_HOME, '.local'),
    ...tenantEnv,
  };
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
  if (!/^[A-Za-z0-9_-]+$/.test(config.tenantId)) throw new Error('Invalid tenantId');
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
  const yamlStr = (v: string) =>
    `"${v
      .replace(/[\r\n]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')}"`;
  const provider = getRuntimeProvider(config.provider);
  const providerKey = provider?.providerKey ?? config.provider;
  const lines = ['model:', `  provider: ${yamlStr(providerKey)}`];
  if (config.defaultModel) {
    // `provider` is written separately, so `model.default` must be the BARE model
    // id. A stored `provider:model` form (e.g. "anthropic:claude-sonnet-4-6") is
    // sent to the provider verbatim by Hermes' default path (unlike session/set_model
    // which splits it) and 404s. Strip a leading "<providerKey>:" if present.
    const bareModel = config.defaultModel.startsWith(`${providerKey}:`)
      ? config.defaultModel.slice(providerKey.length + 1)
      : config.defaultModel;
    lines.push(`  default: ${yamlStr(bareModel)}`);
  }
  if (config.baseUrl) {
    lines.push(`  base_url: ${yamlStr(config.baseUrl)}`);
  }
  return lines.join('\n') + '\n';
}
