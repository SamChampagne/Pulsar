// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest';
import {
  readSupplierScheduleIntent as read,
  rememberSupplierScheduleIntent as remember,
} from './supplier-schedule-intent';
const key = 'pulsar:schedule:tenant:user:invoice',
  id = 'invoice';
const p = () => ({
  path: '/billing/supplier-schedules/invoice/invoice/confirm',
  body: { operationKey: '12345678-1234-4234-8234-123456789012', note: 'Exact original body' },
});
describe('schedule recovery', () => {
  beforeEach(() => localStorage.clear());
  it('keeps an exact request through retries', () => {
    remember(key, id, p());
    remember(key, id, p());
    expect(read(key, id)).toEqual(p());
  });
  it('cannot replace an uncertain request', () => {
    remember(key, id, p());
    expect(() => remember(key, id, { ...p(), body: { ...p().body, note: 'Changed' } })).toThrow();
    expect(read(key, id)).toEqual(p());
  });
  it('rejects a request for another invoice', () => {
    remember(key, id, p());
    expect(() => read(key, 'other')).toThrow();
  });
  it.each(['{', '{}', 'null'])('fails closed on corrupt storage %s', (raw) => {
    localStorage.setItem(key, raw);
    expect(() => read(key, id)).toThrow();
  });
});
