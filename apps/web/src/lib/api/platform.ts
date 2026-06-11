import { goto } from '$app/navigation';

const BASE = '/api/v1';
const TOKEN_KEY = 'pulsar_platform_token';

export const getPlatformToken = () => localStorage.getItem(TOKEN_KEY);
export const setPlatformToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearPlatformToken = () => localStorage.removeItem(TOKEN_KEY);

export class PlatformApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal client for the platform plane: Bearer token, no refresh (12 h token). */
export async function platformApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getPlatformToken();
  const response = await fetch(BASE + path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401 && !path.endsWith('/auth/login')) {
    clearPlatformToken();
    void goto('/platform/login');
    throw new PlatformApiError(401, 'Platform session expired');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : (payload?.message ?? response.statusText);
    throw new PlatformApiError(response.status, message);
  }
  return (await response.json()) as T;
}
