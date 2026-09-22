import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readTimeIntent,
  rememberTimeIntent,
  clearTimeIntent,
  type TimeRequest,
} from './time-intent';
const request: TimeRequest = {
  jobId: 'job',
  userId: 'user',
  workDate: '2026-09-21',
  minutes: 75,
  billable: true,
  note: 'Inspection',
  operationKey: '72663d0a-716c-4c92-8d8c-8c8978a684a3',
};
describe('Service time pending submissions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('retains exactly the original request and only clears its operation key', () => {
    rememberTimeIntent('tenant:user', request);
    expect(readTimeIntent('tenant:user')).toEqual(request);
    clearTimeIntent('tenant:user', 'wrong');
    expect(readTimeIntent('tenant:user')).toEqual(request);
    expect(() => rememberTimeIntent('tenant:user', request)).toThrow();
    clearTimeIntent('tenant:user', request.operationKey);
    expect(readTimeIntent('tenant:user')).toBeNull();
  });
  it('isolates pending submissions by tenant and user', () => {
    rememberTimeIntent('a:user', request);
    expect(readTimeIntent('b:user')).toBeNull();
    expect(readTimeIntent('a:other')).toBeNull();
  });
  it('fails closed when persisted data is invalid', () => {
    localStorage.setItem(
      'pulsar.services.time.v1:a:user',
      JSON.stringify({ ...request, minutes: -1 }),
    );
    expect(() => readTimeIntent('a:user')).toThrow('illisible');
    expect(() => rememberTimeIntent('a:user', request)).toThrow();
  });
  it('refuses to send when browser storage cannot preserve the request', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(() => rememberTimeIntent('a:user', request)).toThrow('Aucun temps envoyé');
  });
});
