import { describe, it, expect } from 'vitest';
import { StockExitStatus as S, canTransitionStockExit } from './stock-exit';
describe('documented stock exit workflow', () => {
  it('only closes a draft, never reopens or retries a state transition', () => {
    for (const from of Object.values(S))
      for (const to of Object.values(S))
        expect(canTransitionStockExit(from, to)).toBe(from === S.DRAFT && to !== S.DRAFT);
  });
});
