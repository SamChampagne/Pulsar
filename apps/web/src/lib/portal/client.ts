import { getPortalSession, portalApi, PortalApiError } from './api';

const BASE = '/api/v1';

/**
 * Uniform surface the portal components code against, regardless of whether
 * the caller is reached through a one-shot capability token
 * (`/public/portal/:token/*`, unauthenticated) or a named customer-portal
 * session (`/portal/*`, bearer-authenticated). `path` is always relative to
 * the client's own prefix, e.g. `client.get('/view')`.
 */
export interface PortalClient {
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  download(path: string): Promise<Blob>;
}

/** Session-authenticated client: `/portal/*`, refresh-and-retry via `portalApi`. */
export function sessionClient(): PortalClient {
  const prefix = '/portal';
  return {
    get: (path, query) => portalApi(prefix + path, { query }),
    post: (path, body) => portalApi(prefix + path, { method: 'POST', body }),
    del: (path) => portalApi(prefix + path, { method: 'DELETE' }),
    async download(path) {
      const token = getPortalSession()?.accessToken ?? null;
      const res = await fetch(BASE + prefix + path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new PortalApiError(res.status, res.statusText);
      return res.blob();
    },
  };
}

/**
 * Token-authenticated client: `/public/portal/:token/*`, plain `fetch` with no
 * bearer at all — deliberately NOT the tenant `api()` client, which would
 * attach a staff access token (if one happens to be in `pulsar.auth`) and
 * redirect to `/login` on a 401 that has nothing to do with staff auth.
 */
export function tokenClient(token: string): PortalClient {
  const prefix = `/public/portal/${token}`;

  // The token plane's "view" route is the bare `:token` path (no `/view`
  // suffix) — unlike every other route, and unlike the session plane's
  // `/portal/view`. Translate here so callers can use `client.get('/view')`
  // uniformly on both clients.
  const resolve = (path: string) => (path === '/view' ? '' : path);

  async function raw<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    const url = new URL(BASE + prefix + resolve(path), window.location.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : (payload?.message ?? response.statusText);
      throw new PortalApiError(response.status, message);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    get: (path, query) => raw(path, { query }),
    post: (path, body) => raw(path, { method: 'POST', body }),
    del: (path) => raw(path, { method: 'DELETE' }),
    async download(path) {
      const res = await fetch(BASE + prefix + path);
      if (!res.ok) throw new PortalApiError(res.status, res.statusText);
      return res.blob();
    },
  };
}
