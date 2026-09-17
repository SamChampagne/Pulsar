// Pure, browser-safe. No Node imports.
//
// Webhook destination resolution + egress safety. Two config spellings exist in
// the wild: the outbox was written against `url`/`secret`, while the
// integrations studio UI writes `endpointUrl`/`webhookSecret`. Both are read
// here so a studio-configured integration actually delivers.

export interface WebhookTarget {
  url: string;
  secret?: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Destination of a webhook integration, or null when no URL is configured.
 * `url` wins over `endpointUrl`, `secret` over `webhookSecret`.
 */
export function resolveWebhookTarget(config: unknown): WebhookTarget | null {
  const raw =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const url = str(raw.url) || str(raw.endpointUrl);
  if (!url) return null;
  const secret = str(raw.secret) || str(raw.webhookSecret);
  return { url, ...(secret ? { secret } : {}) };
}

/**
 * Legacy outbound webhook surface (before domain events fed the outbox).
 * Used to backfill `config.events` on integrations created when an empty
 * allowlist meant "the 6 TMS events", not "every catalog event".
 */
export const LEGACY_WEBHOOK_EVENTS: readonly string[] = [
  'load.dispatched',
  'load.completed',
  'tender.sent',
  'tender.accepted',
  'tender.declined',
  'tender.expired',
];

/** Literal-host prefixes that must never be reachable from the server (SSRF). */
const PRIVATE_V4_PREFIXES = ['127.', '10.', '192.168.', '169.254.', '0.'];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::') return true;
  // Unique local addresses fc00::/7 — first hextet starts with fc or fd.
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  // Link-local IPv6 fe80::/10.
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  if (PRIVATE_V4_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;
  // 172.16.0.0/12 — second octet 16..31.
  const match = /^172\.(\d{1,3})\./.exec(host);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return false;
}

export interface WebhookUrlCheckOptions {
  /** Escape hatch for local development / CI (WEBHOOK_ALLOW_PRIVATE_URLS=true). */
  allowPrivate?: boolean;
}

export type WebhookUrlCheck = { ok: true } | { ok: false; reason: string };

/** Why a webhook URL is refused (FR message), or `{ ok: true }`. */
export function checkWebhookUrl(
  url: string,
  options: WebhookUrlCheckOptions = {},
): WebhookUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'URL invalide.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Seuls les schémas http/https sont acceptés.' };
  }
  if (!options.allowPrivate && isPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      reason:
        'Hôte interne interdit (loopback, lien-local ou plage privée). ' +
        'Active WEBHOOK_ALLOW_PRIVATE_URLS=true pour le développement local.',
    };
  }
  return { ok: true };
}

export function isSafeWebhookUrl(url: string, options: WebhookUrlCheckOptions = {}): boolean {
  return checkWebhookUrl(url, options).ok;
}
