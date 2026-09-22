import { api } from '$lib/api/client';
import type {
  Appearance,
  DeskLayout,
  ModuleTours,
  ModuleTourProgress,
  TourModuleKey,
} from '@pulsar/shared';

export function getPreferences() {
  return api<{
    deskLayout: unknown;
    appearance: unknown;
    releaseNotesSeenAt?: string | null;
    moduleTours?: ModuleTours;
  }>('/me/preferences');
}

export function putModuleTour(moduleKey: TourModuleKey, progress: ModuleTourProgress) {
  return api<{ moduleTours: ModuleTours }>('/me/preferences', {
    method: 'PUT',
    body: { moduleTour: { moduleKey, ...progress } },
  });
}

export function putPreferences(patch: { deskLayout?: DeskLayout; appearance?: Appearance }) {
  return api<{ deskLayout: unknown; appearance: unknown; releaseNotesSeenAt?: string | null }>(
    '/me/preferences',
    {
      method: 'PUT',
      body: patch,
    },
  );
}

export function putDeskLayout(deskLayout: DeskLayout) {
  return putPreferences({ deskLayout });
}
