import { get, writable } from 'svelte/store';
import { auth } from '$lib/stores/auth';

export interface AdjustRequest {
  operationKey: string;
  itemId: string;
  binId: string;
  lotId?: string;
  qtyDelta: number;
  note?: string;
}
export interface AdjustIntent {
  scope: string;
  request: AdjustRequest;
  label: string;
  createdAt: string;
}
export const pendingAdjust = writable<AdjustIntent | null>(null);
export const adjustStorageError = writable('');
export function adjustScope() {
  const a = get(auth);
  return a ? `${a.tenant.id}:${a.user.id}` : '';
}
const key = (scope: string) => `pulsar.wms.adjust.v1:${scope}`;
function valid(value: AdjustIntent, scope: string) {
  const r = value?.request;
  return (
    value?.scope === scope &&
    typeof value.label === 'string' &&
    typeof value.createdAt === 'string' &&
    r &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.operationKey) &&
    [r.itemId, r.binId].every((v) => typeof v === 'string' && v.length > 0) &&
    Number.isFinite(r.qtyDelta) &&
    r.qtyDelta !== 0 &&
    (r.lotId === undefined || (typeof r.lotId === 'string' && !!r.lotId)) &&
    (r.note === undefined || typeof r.note === 'string') &&
    Object.keys(r).every((k) =>
      ['operationKey', 'itemId', 'binId', 'lotId', 'qtyDelta', 'note'].includes(k),
    )
  );
}
export function syncAdjustIntent() {
  const scope = adjustScope();
  pendingAdjust.set(null);
  adjustStorageError.set('');
  if (!scope || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(key(scope));
    if (!raw) return;
    const value = JSON.parse(raw) as AdjustIntent;
    if (!valid(value, scope)) throw new Error('Invalid intent');
    pendingAdjust.set(value);
  } catch {
    adjustStorageError.set(
      'Impossible de relire l’ajustement conservé. Vérifiez le journal avant toute nouvelle correction.',
    );
  }
}
export function rememberAdjust(request: AdjustRequest, label: string): AdjustIntent {
  syncAdjustIntent();
  if (get(adjustStorageError)) throw new Error(get(adjustStorageError));
  if (get(pendingAdjust))
    throw new Error(
      'Un ajustement attend confirmation. Reprenez cette demande avant d’en créer une autre.',
    );
  const scope = adjustScope();
  if (!scope) throw new Error('Session requise.');
  const intent = {
    scope,
    request: structuredClone(request),
    label,
    createdAt: new Date().toISOString(),
  };
  if (!valid(intent, scope)) throw new Error('Demande d’ajustement invalide.');
  try {
    localStorage.setItem(key(scope), JSON.stringify(intent));
  } catch {
    throw new Error('Impossible de conserver la demande. Aucun ajustement envoyé.');
  }
  pendingAdjust.set(intent);
  return intent;
}
export function resolveAdjust(intent: AdjustIntent) {
  if (adjustScope() !== intent.scope) return;
  const raw = localStorage.getItem(key(intent.scope));
  if (raw && JSON.parse(raw).request?.operationKey === intent.request.operationKey)
    localStorage.removeItem(key(intent.scope));
  syncAdjustIntent();
}
