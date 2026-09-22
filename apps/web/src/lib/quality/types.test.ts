import { describe, it, expect } from 'vitest';
import { readInspectionIntent } from './types';
const body = {
  planId: 'plan',
  title: 'Pièce A',
  sourceKind: 'SUPPORT',
  sourceId: 'sav',
  operationKey: '7e87e7df-e0ee-42f5-9918-2d73b148ed56',
};
describe('Durable quality creation intent', () => {
  it('preserves the operation identity and exact content', () => {
    expect(readInspectionIntent(JSON.stringify(body))).toEqual(body);
  });
  it('rejects corrupted storage instead of silently replacing an uncertain request', () => {
    for (const v of [
      null,
      {},
      { ...body, operationKey: 'bad' },
      { ...body, sourceId: null },
      { ...body, sourceKind: 'INVALID' },
    ])
      expect(() => readInspectionIntent(JSON.stringify(v))).toThrow();
  });
});
