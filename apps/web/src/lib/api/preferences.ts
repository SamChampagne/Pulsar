import { api } from '$lib/api/client';
import type { DeskLayout } from '@pulsar/shared';

export function getPreferences() {
  return api<{ deskLayout: unknown }>('/me/preferences');
}

export function putDeskLayout(deskLayout: DeskLayout) {
  return api<{ deskLayout: unknown }>('/me/preferences', { method: 'PUT', body: { deskLayout } });
}
