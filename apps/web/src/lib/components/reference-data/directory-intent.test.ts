import { beforeEach, describe, expect, it } from 'vitest';
import { PartyDirectoryKind } from '@pulsar/shared';
import {
  readDirectoryIntent,
  rememberDirectoryIntent,
  clearDirectoryIntent,
  type DirectoryIntent,
} from './directory-intent';
const intent: DirectoryIntent = {
  id: null,
  body: {
    operationKey: 'a211989a-16ca-44b0-9b6c-5c888b22b0ea',
    reason: 'Nouvel interlocuteur',
    entry: {
      kind: PartyDirectoryKind.CONTACT,
      label: 'Camille',
      role: 'Réception',
      active: true,
      validFrom: null,
      validUntil: null,
      email: '',
      phone: '',
      address: null,
      notes: '',
    },
  },
};
describe('Directory response-loss intent', () => {
  beforeEach(() => sessionStorage.clear());
  it('keeps exact input across reads, scoped to tenant/user/owner', () => {
    rememberDirectoryIntent('tenant:user:owner', intent);
    expect(readDirectoryIntent('tenant:user:owner')).toEqual(intent);
    expect(readDirectoryIntent('tenant:other:owner')).toBeNull();
    expect(() => rememberDirectoryIntent('tenant:user:owner', intent)).toThrow();
    clearDirectoryIntent('tenant:user:owner', 'different');
    expect(readDirectoryIntent('tenant:user:owner')).toEqual(intent);
    clearDirectoryIntent('tenant:user:owner', intent.body.operationKey);
    expect(readDirectoryIntent('tenant:user:owner')).toBeNull();
  });
  it('blocks corrupt, foreign or path-injected pending data', () => {
    for (const v of [
      'broken',
      JSON.stringify({
        ...intent,
        id: '../../users',
        body: { ...intent.body, expectedVersion: 1 },
      }),
      JSON.stringify({
        ...intent,
        body: { ...intent.body, entry: { ...intent.body.entry, permissions: ['admin'] } },
      }),
    ]) {
      sessionStorage.setItem('pulsar.directory.pending.v1:x', v);
      expect(() => readDirectoryIntent('x')).toThrow();
    }
  });
});
