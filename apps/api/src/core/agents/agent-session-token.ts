import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prefix distinguishes session tokens from real `ak_` agent keys. */
const PREFIX = 'as_';

/**
 * Mint a short-lived signed session token for an agent.
 * Format: as_<base64url(agentId.expiresAt)>.<base64url(hmac)>
 * @param ttlSeconds lifetime in seconds.
 * @param nowMs injectable clock; treated as Unix seconds (defaults to Math.floor(Date.now()/1000)).
 */
export function mintAgentSessionToken(
  agentId: string,
  secret: string,
  ttlSeconds: number,
  nowMs: number = Math.floor(Date.now() / 1000),
): string {
  const expiresAt = nowMs + ttlSeconds;
  const payload = `${agentId}.${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${PREFIX}${Buffer.from(payload).toString('base64url')}.${sig}`;
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
  const dotp = payload.lastIndexOf('.');
  if (dotp < 0) return null;
  const agentId = payload.slice(0, dotp);
  const expiresAt = Number(payload.slice(dotp + 1));
  if (!Number.isFinite(expiresAt) || nowMs > expiresAt) return null;
  return agentId || null;
}
