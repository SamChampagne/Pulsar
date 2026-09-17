import { goto } from '$app/navigation';
import type { PortalLoginResponse } from '@pulsar/shared';

const BASE = '/api/v1';
const STORAGE_KEY = 'pulsar.portal';

export class PortalApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Reads the stored portal session (customer-portal plane), or null if absent/corrupt. */
export function getPortalSession(): PortalLoginResponse | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PortalLoginResponse) : null;
  } catch {
    return null;
  }
}

export function setPortalSession(session: PortalLoginResponse) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearPortalSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// Single-flight refresh: concurrent 401s share one refresh round-trip.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getPortalSession()?.refreshToken;
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/portal/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    setPortalSession((await res.json()) as PortalLoginResponse);
    return true;
  } catch {
    return false;
  }
}

interface PortalApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * Typed fetch wrapper for the customer-portal SESSION plane (`/portal/*`):
 * Bearer token from the `pulsar.portal` session, transparent refresh-and-retry
 * on 401, redirect to `/portal/login` when the session is truly gone. Never
 * touches the tenant (`pulsar.auth`) storage or the tenant client's redirect.
 */
export async function portalApi<T>(
  path: string,
  options: PortalApiOptions = {},
  isRetry = false,
): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const token = getPortalSession()?.accessToken ?? null;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // The auth door (`/portal/auth/*`) answers 401 for bad credentials and dead
  // links: those are the caller's message to show, never a lost session — no
  // refresh-and-retry, no wipe, no redirect. Paths are absolute from the API
  // root here (`sessionClient` prefixes `/portal`), so match the full prefix.
  if (response.status === 401 && !path.startsWith('/portal/auth/')) {
    if (!isRetry) {
      refreshing ??= tryRefresh().finally(() => (refreshing = null));
      if (await refreshing) {
        return portalApi<T>(path, options, true);
      }
    }
    clearPortalSession();
    void goto('/portal/login');
    throw new PortalApiError(401, 'Session expired');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : (payload?.message ?? response.statusText);
    throw new PortalApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  // Some endpoints (e.g. void-returning POST actions) reply 200/201 with an empty body.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
