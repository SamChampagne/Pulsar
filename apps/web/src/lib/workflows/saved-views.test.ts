import { describe, expect, it } from 'vitest';
import { parseWorkViews } from './saved-views';
describe('saved workflow views', () => {
  it('ignores corrupt and unsupported data', () => {
    expect(parseWorkViews('{')).toEqual([]);
    expect(parseWorkViews('{"name":"bad"}')).toEqual([]);
    expect(parseWorkViews('[{"name":"bad","type":"SECRET","search":"","status":""}]')).toEqual([]);
  });
  it('bounds storage and accepts legitimate filters', () => {
    const view = { name: 'À suivre', type: 'SALES_ORDER', search: 'SO-', status: 'CONFIRMED' };
    expect(parseWorkViews(JSON.stringify([view]))).toEqual([view]);
    expect(parseWorkViews(JSON.stringify(Array(20).fill(view)))).toHaveLength(10);
  });
});
