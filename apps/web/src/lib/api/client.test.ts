/**
 * Tests for the typed fetch wrapper in client.ts.
 *
 * Strategy:
 * - `fetch` is replaced with vi.fn() before each test.
 * - `$app/navigation` is aliased to a stub that exposes `goto` as a vi.fn().
 * - The auth store functions (`getAccessToken`, `getRefreshToken`, `setAuth`,
 *   `clearAuth`) are mocked via vi.mock so tests can control token state
 *   without touching localStorage.
 * - After each test localStorage is cleared and the module-level `refreshing`
 *   promise is reset by re-importing the module (vi.resetModules).
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock $app/navigation before importing the module under test.
// The alias in vitest.config.ts points to src/__mocks__/$app/navigation.ts
// which already exports goto as a vi.fn(). We re-import it here so we can
// spy on it in assertions.
// ---------------------------------------------------------------------------
vi.mock('$app/navigation', () => ({
  goto: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock the auth store so tests never touch localStorage directly.
// ---------------------------------------------------------------------------
vi.mock('$lib/stores/auth', () => ({
  getAccessToken: vi.fn<() => string | null>().mockReturnValue(null),
  getRefreshToken: vi.fn<() => string | null>().mockReturnValue(null),
  setAuth: vi.fn(),
  clearAuth: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — must come AFTER vi.mock() calls.
// ---------------------------------------------------------------------------
import { goto } from '$app/navigation';
import * as authStore from '$lib/stores/auth';
import { api, ApiError } from './client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object usable with vi.fn(). */
function mockResponse(
  status: number,
  body: unknown,
  ok?: boolean,
): Response {
  const bodyText =
    body === null || body === undefined ? '' : JSON.stringify(body);
  const isOk = ok !== undefined ? ok : status >= 200 && status < 300;
  return {
    ok: isOk,
    status,
    statusText: statusTextFor(status),
    json: () => (bodyText ? Promise.resolve(JSON.parse(bodyText)) : Promise.reject(new SyntaxError('empty'))),
    text: () => Promise.resolve(bodyText),
  } as unknown as Response;
}

function statusTextFor(status: number): string {
  const map: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 422: 'Unprocessable Entity', 500: 'Internal Server Error',
  };
  return map[status] ?? 'Unknown';
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  // Wire our mock as globalThis.fetch (jsdom exposes globalThis).
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Ensure window.location.origin is defined in jsdom.
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost' },
    writable: true,
  });

  // Reset all mocks between tests.
  vi.clearAllMocks();

  // Default: no token.
  vi.mocked(authStore.getAccessToken).mockReturnValue(null);
  vi.mocked(authStore.getRefreshToken).mockReturnValue(null);
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('api() — query serialisation', () => {
  it('appends defined, non-empty query params to the URL', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { id: 1 }));

    await api('/shipments', { query: { page: 2, pageSize: 25, status: 'DRAFT' } });

    const called = fetchMock.mock.calls[0][0] as URL;
    expect(called.searchParams.get('page')).toBe('2');
    expect(called.searchParams.get('pageSize')).toBe('25');
    expect(called.searchParams.get('status')).toBe('DRAFT');
  });

  it('skips undefined query values', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

    await api('/shipments', { query: { page: 1, status: undefined } });

    const called = fetchMock.mock.calls[0][0] as URL;
    expect(called.searchParams.has('status')).toBe(false);
    expect(called.searchParams.get('page')).toBe('1');
  });

  it('skips empty-string query values', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

    await api('/shipments', { query: { q: '' } });

    const called = fetchMock.mock.calls[0][0] as URL;
    expect(called.searchParams.has('q')).toBe(false);
  });

  it('calls /api/v1 + path', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
    await api('/loads');
    const called = fetchMock.mock.calls[0][0] as URL;
    expect(called.pathname).toBe('/api/v1/loads');
  });
});

describe('api() — response body handling', () => {
  it('returns parsed JSON for a normal 200', async () => {
    const payload = { id: 'abc', name: 'Test' };
    fetchMock.mockResolvedValueOnce(mockResponse(200, payload));

    const result = await api<typeof payload>('/loads/abc');
    expect(result).toEqual(payload);
  });

  it('returns undefined for a 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(204, null));

    const result = await api<undefined>('/loads/abc', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for a 200 with an empty body', async () => {
    // Some void-returning POST actions reply 200 with an empty body.
    fetchMock.mockResolvedValueOnce(mockResponse(200, null));

    const result = await api<undefined>('/loads/abc/complete', { method: 'POST' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for a 201 with an empty body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(201, null));
    const result = await api<undefined>('/actions', { method: 'POST' });
    expect(result).toBeUndefined();
  });

  it('attaches the Bearer token from getAccessToken()', async () => {
    vi.mocked(authStore.getAccessToken).mockReturnValue('my-jwt');
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

    await api('/me');

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-jwt');
  });

  it('omits the Authorization header when there is no token', async () => {
    vi.mocked(authStore.getAccessToken).mockReturnValue(null);
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

    await api('/public');

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});

describe('api() — error mapping', () => {
  it('throws ApiError with statusCode + string message', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(404, { message: 'Load not found', error: 'Not Found' }, false),
    );

    await expect(api('/loads/nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Load not found',
    });
  });

  it('joins array message into a comma-separated string (NestJS validation errors)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(422, { message: ['field is required', 'must be a string'] }, false),
    );

    await expect(api('/loads', { method: 'POST', body: {} })).rejects.toMatchObject({
      statusCode: 422,
      message: 'field is required, must be a string',
    });
  });

  it('falls back to statusText when payload has no message', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(500, { error: 'Internal Server Error' }, false),
    );

    await expect(api('/loads')).rejects.toMatchObject({
      statusCode: 500,
      message: 'Internal Server Error', // statusText fallback
    });
  });

  it('falls back to statusText when body is not JSON', async () => {
    const htmlRes = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.reject(new SyntaxError('not json')),
      text: () => Promise.resolve('<html>error</html>'),
    } as unknown as Response;

    fetchMock.mockResolvedValueOnce(htmlRes);

    await expect(api('/loads')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Service Unavailable',
    });
  });

  it('attaches the full payload as .body on ApiError', async () => {
    const payload = { message: 'bad', code: 'INVALID_STATE' };
    fetchMock.mockResolvedValueOnce(mockResponse(400, payload, false));

    let caught: ApiError | undefined;
    try {
      await api('/loads');
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.body).toEqual(payload);
  });
});

describe('api() — 401 refresh + retry flow', () => {
  /**
   * Helper that resets the module-level `refreshing` promise between tests
   * so single-flight state does not bleed across tests.
   * We achieve isolation by re-importing the module each test through
   * vi.resetModules() — but since vi.mock is hoisted, a simpler approach is
   * to just clear the mock call counts and make the fetch mock deliver a
   * fresh 401 → success sequence per test.
   */

  it('retries the original request after a successful refresh', async () => {
    vi.mocked(authStore.getRefreshToken).mockReturnValue('rt-abc');

    const freshSession = {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: { id: 'u1', email: 'a@b.com', tenantId: 't1', firstName: 'A', lastName: 'B', permissions: [] },
      tenant: { id: 't1', slug: 'acme', name: 'Acme', enabledModules: [] },
    };

    // Call 1: original request → 401
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }, false));
    // Call 2: refresh → 200 with new session
    fetchMock.mockResolvedValueOnce(mockResponse(200, freshSession));
    // Call 3: retry → 200 with real data
    fetchMock.mockResolvedValueOnce(mockResponse(200, { id: 'load-1' }));

    const result = await api('/loads/load-1');

    expect(result).toEqual({ id: 'load-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Refresh call must go to /auth/refresh (tryRefresh passes a string, not a URL object)
    const refreshCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(refreshCallUrl).toContain('/auth/refresh');
    // setAuth must have been called with the fresh session
    expect(authStore.setAuth).toHaveBeenCalledWith(freshSession);
  });

  it('clears auth and redirects to /login when refresh fails', async () => {
    vi.mocked(authStore.getRefreshToken).mockReturnValue('rt-expired');

    // Original → 401
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }, false));
    // Refresh → 401 (token expired)
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }, false));

    await expect(api('/loads')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Session expired',
    });

    expect(authStore.clearAuth).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith('/login');
  });

  it('clears auth and redirects when there is no refresh token', async () => {
    vi.mocked(authStore.getRefreshToken).mockReturnValue(null);

    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }, false));

    await expect(api('/loads')).rejects.toMatchObject({ statusCode: 401 });

    expect(authStore.clearAuth).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith('/login');
    // No refresh attempt — only one fetch call
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT attempt refresh for requests to /auth/* paths', async () => {
    vi.mocked(authStore.getRefreshToken).mockReturnValue('rt-abc');

    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Bad credentials' }, false));

    // /auth/login should NOT trigger the refresh flow even with a refresh token
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      statusCode: 401,
    });

    // Only one fetch call — no refresh round-trip
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares a single refresh round-trip for concurrent 401s (single-flight)', async () => {
    vi.mocked(authStore.getRefreshToken).mockReturnValue('rt-shared');

    const freshSession = {
      accessToken: 'new-shared',
      refreshToken: 'new-r',
      user: { id: 'u1', email: 'a@b.com', tenantId: 't1', firstName: 'A', lastName: 'B', permissions: [] },
      tenant: { id: 't1', slug: 'acme', name: 'Acme', enabledModules: [] },
    };

    // Both concurrent calls get a 401 on their first fetch
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }, false)) // call A first try
      .mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }, false)) // call B first try
      .mockResolvedValueOnce(mockResponse(200, freshSession))                        // one shared refresh
      .mockResolvedValueOnce(mockResponse(200, { id: 'a' }))                        // call A retry
      .mockResolvedValueOnce(mockResponse(200, { id: 'b' }));                       // call B retry

    const [resultA, resultB] = await Promise.all([
      api('/loads/a'),
      api('/loads/b'),
    ]);

    expect(resultA).toEqual({ id: 'a' });
    expect(resultB).toEqual({ id: 'b' });

    // There should be exactly ONE /auth/refresh call, not two
    // tryRefresh passes a plain string URL (not a URL object)
    const allCalls = fetchMock.mock.calls as Array<[string | URL, ...unknown[]]>;
    const refreshCalls = allCalls.filter(([url]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('api() — request shape', () => {
  it('serialises the body as JSON', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(201, { id: 'new' }));

    const body = { name: 'Freight', weight: 100 };
    await api('/shipments', { method: 'POST', body });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.body).toBe(JSON.stringify(body));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends no body when options.body is undefined', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));

    await api('/loads');

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.body).toBeUndefined();
  });

  it('defaults to GET method', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
    await api('/loads');
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe('GET');
  });
});
