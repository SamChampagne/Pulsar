import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import {
  adjustScope,
  adjustStorageError,
  pendingAdjust,
  rememberAdjust,
  resolveAdjust,
  syncAdjustIntent,
} from './adjust-intent';
const request = {
  operationKey: 'ed2685e9-1737-4eb1-846f-dfd277aa46b9',
  itemId: 'item',
  binId: 'bin',
  lotId: 'lot',
  qtyDelta: -2.125,
  note: 'Contrôle',
};
function session(tenant = 'a', user = 'a') {
  auth.set({ tenant: { id: tenant }, user: { id: user } } as any);
}
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  session();
  syncAdjustIntent();
});
describe('durable adjustment intent', () => {
  it('captures exact signed quantity, lot and key independently of later edits', () => {
    const input = { ...request },
      intent = rememberAdjust(input, 'Lot A');
    input.qtyDelta = 99;
    pendingAdjust.set(null);
    syncAdjustIntent();
    expect(get(pendingAdjust)).toEqual(intent);
    expect(intent.request.qtyDelta).toBe(-2.125);
    expect(JSON.stringify(intent)).not.toMatch(/password|accessToken|refreshToken/);
    expect(() => rememberAdjust(request, 'Duplicate')).toThrow(/attend confirmation/);
  });
  it('isolates users and tenants and never clears another pending key', () => {
    const intent = rememberAdjust(request, 'A');
    session('b');
    syncAdjustIntent();
    expect(get(pendingAdjust)).toBeNull();
    resolveAdjust(intent);
    session('a', 'b');
    syncAdjustIntent();
    expect(get(pendingAdjust)).toBeNull();
    session();
    syncAdjustIntent();
    expect(get(pendingAdjust)).toEqual(intent);
    resolveAdjust(intent);
    const next = rememberAdjust(
      { ...request, operationKey: '67c965e0-b1c0-4f21-8d4e-39f7b09f54f0' },
      'B',
    );
    resolveAdjust(intent);
    expect(get(pendingAdjust)).toEqual(next);
  });
  it('fails closed on corrupt or altered requests without deleting the evidence', () => {
    for (const raw of [
      '{',
      JSON.stringify({
        scope: adjustScope(),
        label: 'Bad',
        createdAt: 'now',
        request: { ...request, lotId: null },
      }),
      JSON.stringify({
        scope: adjustScope(),
        label: 'Bad',
        createdAt: 'now',
        request: { ...request, qtyDelta: 0 },
      }),
    ]) {
      localStorage.setItem(`pulsar.wms.adjust.v1:${adjustScope()}`, raw);
      syncAdjustIntent();
      expect(get(adjustStorageError)).toMatch(/Impossible/);
      expect(get(pendingAdjust)).toBeNull();
      expect(() => rememberAdjust(request, 'New')).toThrow(/Impossible/);
      expect(localStorage.getItem(`pulsar.wms.adjust.v1:${adjustScope()}`)).toBe(raw);
    }
  });
  it('requires a session and durable storage before sending', () => {
    auth.set(null);
    expect(() => rememberAdjust(request, 'X')).toThrow(/Session/);
    session();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    expect(() => rememberAdjust(request, 'X')).toThrow(/Aucun ajustement/);
    expect(get(pendingAdjust)).toBeNull();
  });
});
