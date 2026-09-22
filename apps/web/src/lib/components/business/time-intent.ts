import { writable } from 'svelte/store';
// Invalidation only: no business data or cross-tenant cache.
export const serviceTimeRevision = writable(0);
export interface TimeRequest {
  jobId: string;
  userId: string;
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string;
  operationKey: string;
}
const key = (scope: string) => `pulsar.services.time.v1:${scope}`;
export function readTimeIntent(scope: string): TimeRequest | null {
  const raw = localStorage.getItem(key(scope));
  if (!raw) return null;
  const v = JSON.parse(raw);
  if (
    !v ||
    ![v.jobId, v.userId, v.note].every((x) => typeof x === 'string' && x.length > 0) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.workDate) ||
    !Number.isInteger(v.minutes) ||
    v.minutes < 1 ||
    v.minutes > 1440 ||
    typeof v.billable !== 'boolean' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.operationKey)
  )
    throw new Error(
      'Saisie conservée illisible. Vérifiez les temps avant de réinitialiser le stockage de ce navigateur.',
    );
  return v;
}
export function rememberTimeIntent(scope: string, request: TimeRequest) {
  if (readTimeIntent(scope)) throw new Error('Une saisie attend déjà confirmation.');
  try {
    localStorage.setItem(key(scope), JSON.stringify(request));
  } catch {
    throw new Error('Impossible de conserver la demande dans ce navigateur. Aucun temps envoyé.');
  }
}
export function clearTimeIntent(scope: string, operationKey: string) {
  if (readTimeIntent(scope)?.operationKey === operationKey) localStorage.removeItem(key(scope));
}
