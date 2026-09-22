import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  readPartIntent,
  rememberPartIntent,
  clearPartIntent,
  type PartIntent,
} from './part-intent';
const request: PartIntent = {
  jobId: 'job',
  body: {
    operationKey: '72663d0a-716c-4c92-8d8c-8c8978a684a3',
    expectedUpdatedAt: '2026-09-21T22:00:00.000Z',
    catalogItemId: 'product',
    binId: 'bin',
    quantity: 1.25,
    note: 'Pose',
  },
};
describe('Durable part operations', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('replays exactly and isolates tenant, person and job', () => {
    rememberPartIntent('tenant:user:job', request);
    expect(readPartIntent('tenant:user:job')).toEqual(request);
    expect(readPartIntent('other:user:job')).toBeNull();
    expect(readPartIntent('tenant:other:job')).toBeNull();
    expect(readPartIntent('tenant:user:other')).toBeNull();
    expect(() => rememberPartIntent('tenant:user:job', request)).toThrow();
    clearPartIntent('tenant:user:job', 'wrong');
    expect(readPartIntent('tenant:user:job')).toEqual(request);
    clearPartIntent('tenant:user:job', request.body.operationKey);
    expect(readPartIntent('tenant:user:job')).toBeNull();
  });
  it('retains compensating return requests', () => {
    const r = {
      jobId: 'job',
      partId: 'part',
      body: {
        operationKey: request.body.operationKey,
        expectedUpdatedAt: request.body.expectedUpdatedAt,
        reason: 'Retour physique',
      },
    };
    rememberPartIntent('s', r);
    expect(readPartIntent('s')).toEqual(r);
  });
  it('fails closed on corruption and storage failure', () => {
    localStorage.setItem(
      'pulsar.services.parts.v1:s',
      JSON.stringify({ ...request, body: { ...request.body, quantity: -1 } }),
    );
    expect(() => readPartIntent('s')).toThrow('illisible');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(() => rememberPartIntent('other', request)).toThrow('Aucun mouvement envoyé');
  });
});
