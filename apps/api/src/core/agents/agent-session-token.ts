import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prefix distinguishes session tokens from real `ak_` agent keys. */
const PREFIX = 'as_';

/**
 * Mint a short-lived signed session token for an agent.
 * Format: as_<base64url(agentId.expiresAt[.refB64])>.<base64url(hmac)>
 * @param ttlSeconds lifetime in seconds.
 * @param opts optional extra fields (triggeredByRef).
 * @param nowMs injectable clock; treated as Unix seconds (defaults to Math.floor(Date.now()/1000)).
 */
export function mintAgentSessionToken(
  agentId: string,
  secret: string,
  ttlSeconds: number,
  opts: { triggeredByRef?: string } = {},
  nowMs: number = Math.floor(Date.now() / 1000),
): string {
  const expiresAt = nowMs + ttlSeconds;
  const ref = opts.triggeredByRef ? Buffer.from(opts.triggeredByRef).toString('base64url') : '';
  const payload = ref ? `${agentId}.${expiresAt}.${ref}` : `${agentId}.${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${PREFIX}${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export interface ParsedSessionToken {
  agentId: string;
  triggeredByRef?: string;
}

/**
 * Returns the full parsed token contents if valid and unexpired, else null.
 * @param nowMs injectable clock; treated as Unix seconds (defaults to Math.floor(Date.now()/1000)).
 */
export function verifyAgentSessionTokenFull(
  token: string,
  secret: string,
  nowMs: number = Math.floor(Date.now() / 1000),
): ParsedSessionToken | null {
  if (!token.startsWith(PREFIX)) return null;
  const body = token.slice(PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const parts = payload.split('.');
  if (parts.length < 2) return null;
  const agentId = parts[0];
  const expiresAt = Number(parts[1]);
  if (!agentId || !Number.isFinite(expiresAt) || nowMs > expiresAt) return null;
  const triggeredByRef = parts[2]
    ? Buffer.from(parts[2], 'base64url').toString('utf8')
    : undefined;
  return { agentId, triggeredByRef };
}

/**
 * Returns the agentId if the token is valid and unexpired, else null.
 * @param nowMs injectable clock; treated as Unix seconds (defaults to Math.floor(Date.now()/1000)).
 */
export function verifyAgentSessionToken(
  token: string,
  secret: string,
  nowMs: number = Math.floor(Date.now() / 1000),
): string | null {
  return verifyAgentSessionTokenFull(token, secret, nowMs)?.agentId ?? null;
}
