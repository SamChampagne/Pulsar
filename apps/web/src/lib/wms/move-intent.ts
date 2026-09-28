import { get, writable } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import type { WmsMoveRequest } from '@pulsar/shared';

export interface MoveIntent {
  scope: string;
  request: WmsMoveRequest;
  label: string;
  createdAt: string;
}
export const pendingMove = writable<MoveIntent | null>(null);
export const moveStorageError = writable('');
export function moveScope() {
  const a = get(auth);
  return a ? `${a.tenant.id}:${a.user.id}` : '';
}
const key = (scope: string) => `pulsar.wms.move.v1:${scope}`;
export function syncMoveIntent() {
  const scope = moveScope();
  pendingMove.set(null);
  moveStorageError.set('');
  if (!scope || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(key(scope));
    if (!raw) return;
    const value = JSON.parse(raw) as MoveIntent;
    const r = value.request;
    if (
      value.scope !== scope ||
      typeof value.label !== 'string' ||
      !r ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        r.operationKey,
      ) ||
      ![r.itemId, r.fromBinId, r.toBinId].every((v) => typeof v === 'string' && v.length > 0) ||
      !Number.isFinite(r.qty) ||
      r.qty <= 0 ||
      (r.lotId !== undefined && (typeof r.lotId !== 'string' || !r.lotId.length))
    )
      throw new Error('Invalid intent');
    pendingMove.set(value);
  } catch {
    moveStorageError.set(
      'Impossible de relire le déplacement conservé. Vérifiez le journal avant toute nouvelle opération.',
    );
  }
}
export function rememberMove(request: WmsMoveRequest, label: string): MoveIntent {
  syncMoveIntent();
  if (get(moveStorageError)) throw new Error(get(moveStorageError));
  if (get(pendingMove))
    throw new Error(
      'Un déplacement attend déjà une confirmation. Reprenez cette opération avant d’en créer une autre.',
    );
  const scope = moveScope();
  if (!scope) throw new Error('Session requise.');
  const intent = {
    scope,
    request: structuredClone(request),
    label,
    createdAt: new Date().toISOString(),
  };
  // Persist BEFORE sending. If storage is unavailable, fail closed without moving stock.
  try {
    localStorage.setItem(key(scope), JSON.stringify(intent));
  } catch {
    throw new Error(
      'Impossible de conserver la demande dans ce navigateur. Aucun déplacement envoyé.',
    );
  }
  pendingMove.set(intent);
  return intent;
}
export function resolveMove(intent: MoveIntent) {
  if (moveScope() !== intent.scope) return;
  const raw = localStorage.getItem(key(intent.scope));
  if (raw && JSON.parse(raw).request?.operationKey === intent.request.operationKey)
    localStorage.removeItem(key(intent.scope));
  syncMoveIntent();
}
