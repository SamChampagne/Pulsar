import { describe, it, expect } from 'vitest';
import { mergeTimeline, type TimelineEntry } from './timeline';

const e = (at: string, kind: string): TimelineEntry => ({ at, kind, summary: `${kind}@${at}` });

describe('mergeTimeline', () => {
  it('merges sources sorted by `at` descending', () => {
    const a = [e('2026-06-10T00:00:00.000Z', 'run'), e('2026-06-12T00:00:00.000Z', 'run')];
    const b = [e('2026-06-11T00:00:00.000Z', 'action')];
    const out = mergeTimeline([a, b], 10);
    expect(out.map((x) => x.at)).toEqual([
      '2026-06-12T00:00:00.000Z',
      '2026-06-11T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z',
    ]);
  });
  it('truncates to limit', () => {
    const a = [e('2026-06-03T00:00:00.000Z', 'x'), e('2026-06-02T00:00:00.000Z', 'x'), e('2026-06-01T00:00:00.000Z', 'x')];
    expect(mergeTimeline([a], 2).length).toBe(2);
  });
  it('handles empty sources', () => {
    expect(mergeTimeline([[], []], 5)).toEqual([]);
  });
});
