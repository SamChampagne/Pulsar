import type { PortalLoginResponse } from '@pulsar/shared';
import { writable } from 'svelte/store';
import { clearPortalSession, getPortalSession, setPortalSession } from './api';
import type { PortalView } from './types';

/**
 * Reactive mirror of the `pulsar.portal` storage slot, so the authenticated
 * portal shell can render the account (name, company, role, branding) without
 * re-reading localStorage on every keystroke.
 *
 * Storage stays the source of truth — `portalApi` reads the tokens straight
 * from it and silently rotates them on refresh; this store only carries what
 * the UI displays. Mutate it through `startPortalSession`/`endPortalSession`
 * so the two never drift.
 */
export const portalSession = writable<PortalLoginResponse | null>(getPortalSession());

/** The `/portal/view` payload, loaded once by the `(app)` layout and shared by its pages. */
export const portalView = writable<PortalView | null>(null);

/** Re-reads storage into the store (e.g. on entering the shell in a fresh tab). */
export function syncPortalSession(): PortalLoginResponse | null {
  const session = getPortalSession();
  portalSession.set(session);
  return session;
}

/** Persists a fresh login and publishes it to the shell. */
export function startPortalSession(session: PortalLoginResponse): void {
  setPortalSession(session);
  portalSession.set(session);
}

/** Drops the session everywhere: storage, shell and the cached portal view. */
export function endPortalSession(): void {
  clearPortalSession();
  portalSession.set(null);
  portalView.set(null);
}
