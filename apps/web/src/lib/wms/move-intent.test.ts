import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import {
  moveScope,
  moveStorageError,
  pendingMove,
  rememberMove,
  resolveMove,
  syncMoveIntent,
} from './move-intent';

const request = {
  operationKey: 'ed2685e9-1737-4eb1-846f-dfd277aa46b9',
  itemId: 'item',
  fromBinId: 'a',
  toBinId: 'b',
  qty: 2.125,
  locationId: 'site',
  note: 'Rangement',
};
function session(tenant = 'tenant-a', user = 'user-a') {
  auth.set({ tenant: { id: tenant }, user: { id: user } } as any);
}
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  session();
  syncMoveIntent();
});
describe('durable browser movement intent', () => {
  it('retains the selected lot unchanged on reload', () => {
    const saved = rememberMove({ ...request, lotId: 'lot-039' }, 'Lot 039');
    pendingMove.set(null);
    syncMoveIntent();
    expect(get(pendingMove)).toEqual(saved);
    expect(get(pendingMove)?.request.lotId).toBe('lot-039');
  });
  it('persists an exact snapshot before exposing the pending operation', () => {
    const input = { ...request };
    const intent = rememberMove(input, '2.125 KG : A → B');
    input.qty = 99;
    expect(JSON.parse(localStorage.getItem(`pulsar.wms.move.v1:${moveScope()}`)!)).toEqual(intent);
    expect(intent.request.qty).toBe(2.125);
    expect(get(pendingMove)).toEqual(intent);
    expect(JSON.stringify(intent)).not.toMatch(/accessToken|refreshToken|password/);
  });
  it('restores after reload and refuses to replace an unresolved operation', () => {
    const intent = rememberMove(request, 'Original');
    pendingMove.set(null);
    syncMoveIntent();
    expect(get(pendingMove)).toEqual(intent);
    expect(() => rememberMove({ ...request, qty: 3 }, 'Other')).toThrow(/déjà/);
    expect(get(pendingMove)?.request.qty).toBe(2.125);
  });
  it('isolates tenants and users and never clears another session', () => {
    const intent = rememberMove(request, 'A');
    session('tenant-b');
    syncMoveIntent();
    expect(get(pendingMove)).toBeNull();
    resolveMove(intent);
    session('tenant-a', 'user-b');
    syncMoveIntent();
    expect(get(pendingMove)).toBeNull();
    session();
    syncMoveIntent();
    expect(get(pendingMove)).toEqual(intent);
  });
  it('clears only the matching key, not a newer operation', () => {
    const intent = rememberMove(request, 'First');
    resolveMove(intent);
    expect(get(pendingMove)).toBeNull();
    const next = rememberMove(
      { ...request, operationKey: '67c965e0-b1c0-4f21-8d4e-39f7b09f54f0' },
      'Next',
    );
    resolveMove(intent);
    expect(get(pendingMove)).toEqual(next);
  });
  it('fails closed on corrupt or invalid saved data', () => {
    for (const raw of [
      '{',
      JSON.stringify({ scope: moveScope(), label: 'Bad', request: { ...request, qty: -2 } }),
    ]) {
      localStorage.setItem(`pulsar.wms.move.v1:${moveScope()}`, raw);
      syncMoveIntent();
      expect(get(pendingMove)).toBeNull();
      expect(get(moveStorageError)).toMatch(/Impossible/);
      expect(() => rememberMove(request, 'New')).toThrow(/Impossible/);
      expect(localStorage.getItem(`pulsar.wms.move.v1:${moveScope()}`)).toBe(raw);
    }
  });
  it('fails before sending if persistence is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => rememberMove(request, 'Blocked')).toThrow(/Aucun déplacement envoyé/);
    expect(get(pendingMove)).toBeNull();
  });
  it('requires an authenticated actor', () => {
    auth.set(null);
    expect(() => rememberMove(request, 'Blocked')).toThrow(/Session requise/);
    expect(localStorage.length).toBe(0);
  });
});
