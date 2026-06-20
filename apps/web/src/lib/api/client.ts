import { goto } from '$app/navigation';
import { clearAuth, getAccessToken, getRefreshToken, setAuth } from '$lib/stores/auth';
import type { LoginResponse } from '@pulsar/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  body?: unknown;
  constructor(
    public statusCode: number,
    message: string,
    body?: unknown,
  ) {
    super(message);
    this.body = body;
  }
}

// Single-flight refresh: concurrent 401s share one refresh round-trip.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    setAuth((await res.json()) as LoginResponse);
    return true;
  } catch {
    return false;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * Typed fetch wrapper: Bearer token, transparent refresh-and-retry on 401,
 * redirect to /login when the session is truly gone.
 */
export async function api<T>(path: string, options: ApiOptions = {}, isRetry = false): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const token = getAccessToken();
  if (token === 'demo-token') {
    if (path === '/notifications' || path === '/agent-actions') return [] as T;
    if (path === '/me/preferences') {
      if ((options.method ?? 'GET') === 'PUT') return (options.body ?? {}) as T;
      return { deskLayout: null, appearance: null } as T;
    }
    if (path === '/fleet/overview') {
      return { openWorkOrders: 0, maintenanceDue: [], complianceExpiring: [], complianceExpired: [] } as T;
    }
    if ((options.method ?? 'GET') === 'GET') {
      if (options.query?.pageSize !== undefined) {
        return { items: [], total: 0, page: 1, pageSize: Number(options.query.pageSize) || 100 } as T;
      }
      return [] as T;
    }
    return undefined as T;
  }
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && !path.startsWith('/auth/')) {
    if (!isRetry) {
      refreshing ??= tryRefresh().finally(() => (refreshing = null));
      if (await refreshing) {
        return api<T>(path, options, true);
      }
    }
    clearAuth();
    void goto('/login');
    throw new ApiError(401, 'Session expired');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : (payload?.message ?? response.statusText);
    throw new ApiError(response.status, message, payload);
  }

  if (response.status === 204) return undefined as T;
  // Some endpoints (e.g. void-returning POST actions) reply 200/201 with an empty body.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
