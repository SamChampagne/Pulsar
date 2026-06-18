import { api } from '$lib/api/client';
import type { Appearance, DeskLayout } from '@pulsar/shared';

export function getPreferences() {
  return api<{ deskLayout: unknown; appearance: unknown }>('/me/preferences');
}

export function putPreferences(patch: { deskLayout?: DeskLayout; appearance?: Appearance }) {
  return api<{ deskLayout: unknown; appearance: unknown }>('/me/preferences', {
    method: 'PUT',
    body: patch,
  });
}

export function putDeskLayout(deskLayout: DeskLayout) {
  return putPreferences({ deskLayout });
}
