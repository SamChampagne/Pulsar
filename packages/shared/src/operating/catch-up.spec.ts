import { describe, it, expect, vi } from 'vitest';
import { drainInBatches } from './policies';

describe('drainInBatches (bounded domain-event catch-up)', () => {
  it('drains multiple batches until the queue is empty', async () => {
    const batches = [3, 3, 2, 0];
    let i = 0;
    const runBatch = vi.fn(async () => batches[i++]);
    const res = await drainInBatches(runBatch, { maxBatches: 20 });
    expect(res).toEqual({ batches: 4, handled: 8, hitLimit: false, errored: false });
    expect(runBatch).toHaveBeenCalledTimes(4); // stops after the 0-batch, no extra call
  });

  it('stops immediately when the queue is already empty', async () => {
    const runBatch = vi.fn(async () => 0);
    const res = await drainInBatches(runBatch, { maxBatches: 20 });
    expect(res.batches).toBe(1);
    expect(res.handled).toBe(0);
    expect(res.hitLimit).toBe(false);
    expect(runBatch).toHaveBeenCalledTimes(1);
  });

  it('stops at the batch bound (never loops forever) and reports hitLimit', async () => {
    const runBatch = vi.fn(async () => 5); // always more work
    const res = await drainInBatches(runBatch, { maxBatches: 4 });
    expect(res.batches).toBe(4);
    expect(res.handled).toBe(20);
    expect(res.hitLimit).toBe(true);
    expect(runBatch).toHaveBeenCalledTimes(4);
  });

  it('isolates a batch error: stops without throwing, reports errored', async () => {
    let i = 0;
    const runBatch = vi.fn(async () => {
      if (i++ === 1) throw new Error('boom');
      return 3;
    });
    const res = await drainInBatches(runBatch, { maxBatches: 20 });
    expect(res.errored).toBe(true);
    expect(res.handled).toBe(3); // only the first batch counted
    expect(runBatch).toHaveBeenCalledTimes(2); // stopped after the throwing batch
  });

  it('clamps maxBatches to at least 1', async () => {
    const runBatch = vi.fn(async () => 5);
    const res = await drainInBatches(runBatch, { maxBatches: 0 });
    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(res.hitLimit).toBe(true);
  });
});
