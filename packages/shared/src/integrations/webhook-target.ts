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

/** IPv4 range checks shared between a plain dotted-quad host and one unwrapped from IPv6. */
function isPrivateIPv4(host: string): boolean {
  if (PRIVATE_V4_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;
  // 172.16.0.0/12 — second octet 16..31.
  const b16 = /^172\.(\d{1,3})\./.exec(host);
  if (b16 && Number(b16[1]) >= 16 && Number(b16[1]) <= 31) return true;
  // 100.64.0.0/10 (RFC 6598 shared/CGNAT address space) — second octet 64..127.
  const b100 = /^100\.(\d{1,3})\./.exec(host);
  if (b100 && Number(b100[1]) >= 64 && Number(b100[1]) <= 127) return true;
  return false;
}

/**
 * Splits an IPv6 literal (no brackets) into its 8 hextets, expanding `::`
 * compression and a trailing embedded IPv4 dotted-quad. Returns null when
 * `host` isn't a well-formed IPv6 address.
 */
function expandIPv6(host: string): string[] | null {
  if (!host.includes(':')) return null;

  const doubleColonAt = host.indexOf('::');
  const hasCompression = doubleColonAt !== -1;
  const headStr = hasCompression ? host.slice(0, doubleColonAt) : host;
  const tailStr = hasCompression ? host.slice(doubleColonAt + 2) : '';
  if (hasCompression && host.indexOf('::', doubleColonAt + 1) !== -1) return null; // "::" twice

  const toGroups = (s: string) => (s.length ? s.split(':') : []);
  const expandTrailingIPv4 = (groups: string[]): string[] | null => {
    if (!groups.length) return groups;
    const last = groups[groups.length - 1];
    if (!last.includes('.')) return groups;
    const octets = last.split('.');
    if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) {
      return null;
    }
    const nums = octets.map(Number);
    const hi = ((nums[0] << 8) | nums[1]).toString(16);
    const lo = ((nums[2] << 8) | nums[3]).toString(16);
    return [...groups.slice(0, -1), hi, lo];
  };

  const headGroups = expandTrailingIPv4(toGroups(headStr));
  const tailGroups = expandTrailingIPv4(toGroups(tailStr));
  if (!headGroups || !tailGroups) return null;

  let all: string[];
  if (!hasCompression) {
    if (headGroups.length !== 8) return null;
    all = headGroups;
  } else {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    all = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
    if (all.length !== 8) return null;
  }
  if (all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return all.map((g) => g.toLowerCase());
}

/** Rebuilds "a.b.c.d" from two hex hextets (the low 32 bits of an IPv6 address). */
function hextetsToIPv4(hi: string, lo: string): string {
  const h = parseInt(hi, 16);
  const l = parseInt(lo, 16);
  return `${(h >> 8) & 0xff}.${h & 0xff}.${(l >> 8) & 0xff}.${l & 0xff}`;
}

/**
 * An embedded-IPv4 IPv6 literal (IPv4-mapped `::ffff:a.b.c.d`, IPv4-compatible
 * `::a.b.c.d`, or NAT64 `64:ff9b::a.b.c.d`) is only as safe as the address it
 * carries — unwrap it and re-run the IPv4 checks, instead of letting the
 * hex form slip past every string-based comparison above.
 */
function isPrivateEmbeddedIPv4(hextets: string[]): boolean {
  const isZero = (g: string) => g === '0';
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
  const allButLast2ZeroExcept5 = [h0, h1, h2, h3, h4].every(isZero);
  // IPv4-mapped: ::ffff:a.b.c.d
  if (allButLast2ZeroExcept5 && h5 === 'ffff') {
    return isPrivateIPv4(hextetsToIPv4(h6, h7));
  }
  // IPv4-compatible: ::a.b.c.d (excludes ::/128 and ::1/128, handled elsewhere)
  if ([h0, h1, h2, h3, h4, h5].every(isZero)) {
    return isPrivateIPv4(hextetsToIPv4(h6, h7));
  }
  // NAT64 well-known prefix 64:ff9b::/96 wrapping an IPv4 address.
  if (h0 === '64' && h1 === 'ff9b' && [h2, h3, h4, h5].every(isZero)) {
    return isPrivateIPv4(hextetsToIPv4(h6, h7));
  }
  return false;
}

function isPrivateHost(hostname: string): boolean {
  // Strip brackets (IPv6 literal) then a trailing DNS root dot — Node's URL
  // normalizes numeric IPv4 forms but leaves a literal hostname's trailing
  // dot untouched, so `localhost.`/`foo.localhost.` would otherwise slip
  // past every comparison below (SSRF bypass).
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'localhost.localdomain' || host.endsWith('.localdomain')) return true;
  if (host === '::1' || host === '::') return true;
  // Unique local addresses fc00::/7 — first hextet starts with fc or fd.
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  // Link-local IPv6 fe80::/10.
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  if (isPrivateIPv4(host)) return true;
  if (host.includes(':')) {
    const hextets = expandIPv6(host);
    if (hextets && isPrivateEmbeddedIPv4(hextets)) return true;
  }
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
