import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { LoginResponse } from '@pulsar/shared';

const STORAGE_KEY = 'pulsar.auth';

function loadInitial(): LoginResponse | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LoginResponse) : null;
  } catch {
    return null;
  }
}

export const auth = writable<LoginResponse | null>(loadInitial());

export function setAuth(session: LoginResponse) {
  if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  auth.set(session);
}

export function clearAuth() {
  if (browser) localStorage.removeItem(STORAGE_KEY);
  auth.set(null);
}

function readSession(): LoginResponse | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LoginResponse) : null;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return readSession()?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return readSession()?.refreshToken ?? null;
}
