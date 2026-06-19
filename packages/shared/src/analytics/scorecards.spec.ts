import { describe, it, expect } from 'vitest';
import {
  computeUptimePct,
  computeOccupancyPct,
  computeReadinessPct,
  computeAvgMaintenanceDays,
  computeAvgDwellMinutes,
  maxSeverity,
  bucketizeByDay,
  buildExceptionHeatmap,
} from './scorecards';
import type { HeatmapTask } from './scorecards';

// ---------------------------------------------------------------------------
// computeUptimePct / computeOccupancyPct / computeReadinessPct (ratio helpers)
// ---------------------------------------------------------------------------
describe('computeUptimePct', () => {
  it('returns availability percentage (1 decimal)', () => {
    expect(computeUptimePct(3, 4)).toBe(75.0);
  });
  it('returns null when total is 0', () => {
    expect(computeUptimePct(0, 0)).toBeNull();
  });
  it('returns null when total is negative (defensive)', () => {
    expect(computeUptimePct(1, -2)).toBeNull();
  });
  it('returns 0 when none available', () => {
    expect(computeUptimePct(0, 5)).toBe(0.0);
  });
  it('rounds to 1 decimal', () => {
    expect(computeUptimePct(1, 3)).toBe(33.3);
  });
});

describe('computeOccupancyPct', () => {
  it('returns occupancy percentage', () => {
    expect(computeOccupancyPct(2, 8)).toBe(25.0);
  });
  it('returns null when total is 0', () => {
    expect(computeOccupancyPct(0, 0)).toBeNull();
  });
  it('returns 100 when all spots occupied', () => {
    expect(computeOccupancyPct(5, 5)).toBe(100.0);
  });
});

describe('computeReadinessPct', () => {
  it('returns completed/(open+completed)', () => {
    expect(computeReadinessPct(1, 3)).toBe(75.0);
  });
  it('returns null when there are no pick orders', () => {
    expect(computeReadinessPct(0, 0)).toBeNull();
  });
  it('returns 0 when nothing completed', () => {
    expect(computeReadinessPct(4, 0)).toBe(0.0);
  });
  it('returns 100 when all completed', () => {
    expect(computeReadinessPct(0, 3)).toBe(100.0);
  });
});

// ---------------------------------------------------------------------------
// computeAvgMaintenanceDays
// ---------------------------------------------------------------------------
describe('computeAvgMaintenanceDays', () => {
  it('returns null for empty input', () => {
    expect(computeAvgMaintenanceDays([])).toBeNull();
  });

  it('averages completed durations in days (1 decimal)', () => {
    const orders = [
      { openedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-03T00:00:00.000Z' }, // 2 days
      { openedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-05T00:00:00.000Z' }, // 4 days
    ];
    expect(computeAvgMaintenanceDays(orders)).toBe(3.0);
  });

  it('skips unfinished orders (no completedAt)', () => {
    const orders = [
      { openedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-03T00:00:00.000Z' }, // 2 days
      { openedAt: '2026-01-01T00:00:00.000Z', completedAt: null }, // skipped
    ];
    expect(computeAvgMaintenanceDays(orders)).toBe(2.0);
  });

  it('returns null when all entries are unfinished', () => {
    expect(
      computeAvgMaintenanceDays([{ openedAt: '2026-01-01T00:00:00.000Z', completedAt: null }]),
    ).toBeNull();
  });

  it('accepts Date objects', () => {
    const orders = [
      { openedAt: new Date('2026-01-01T00:00:00.000Z'), completedAt: new Date('2026-01-02T12:00:00.000Z') }, // 1.5 days
    ];
    expect(computeAvgMaintenanceDays(orders)).toBe(1.5);
  });

  it('skips negative durations (completed before opened)', () => {
    const orders = [
      { openedAt: '2026-01-05T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' }, // negative → skip
      { openedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-03T00:00:00.000Z' }, // 2 days
    ];
    expect(computeAvgMaintenanceDays(orders)).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// computeAvgDwellMinutes
// ---------------------------------------------------------------------------
describe('computeAvgDwellMinutes', () => {
  it('returns null for empty input', () => {
    expect(computeAvgDwellMinutes([])).toBeNull();
  });

  it('averages dwell in minutes (rounded)', () => {
    const visits = [
      { checkInAt: '2026-01-01T10:00:00.000Z', checkOutAt: '2026-01-01T10:30:00.000Z' }, // 30 min
      { checkInAt: '2026-01-01T10:00:00.000Z', checkOutAt: '2026-01-01T11:30:00.000Z' }, // 90 min
    ];
    expect(computeAvgDwellMinutes(visits)).toBe(60);
  });

  it('skips visits without checkOutAt (still on-site)', () => {
    const visits = [
      { checkInAt: '2026-01-01T10:00:00.000Z', checkOutAt: '2026-01-01T10:40:00.000Z' }, // 40 min
      { checkInAt: '2026-01-01T10:00:00.000Z', checkOutAt: null }, // skipped
    ];
    expect(computeAvgDwellMinutes(visits)).toBe(40);
  });

  it('returns null when no visit has checked out', () => {
    expect(
      computeAvgDwellMinutes([{ checkInAt: '2026-01-01T10:00:00.000Z', checkOutAt: null }]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// maxSeverity
// ---------------------------------------------------------------------------
describe('maxSeverity', () => {
  it('CRITICAL beats WARNING', () => {
    expect(maxSeverity('WARNING', 'CRITICAL')).toBe('CRITICAL');
    expect(maxSeverity('CRITICAL', 'WARNING')).toBe('CRITICAL');
  });
  it('WARNING beats INFO', () => {
    expect(maxSeverity('INFO', 'WARNING')).toBe('WARNING');
  });
  it('returns same when equal', () => {
    expect(maxSeverity('INFO', 'INFO')).toBe('INFO');
  });
});

// ---------------------------------------------------------------------------
// bucketizeByDay
// ---------------------------------------------------------------------------
describe('bucketizeByDay', () => {
  it('returns UTC YYYY-MM-DD', () => {
    expect(bucketizeByDay('2026-06-19T15:42:00.000Z')).toBe('2026-06-19');
  });
  it('handles invalid dates defensively', () => {
    expect(bucketizeByDay('not-a-date')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// buildExceptionHeatmap
// ---------------------------------------------------------------------------
describe('buildExceptionHeatmap', () => {
  it('produces a contiguous day bucket axis spanning the window', () => {
    const hm = buildExceptionHeatmap([], 7);
    expect(hm.buckets).toHaveLength(7);
    expect(hm.categories).toEqual([]);
    expect(hm.cells).toEqual([]);
    expect(hm.topCategories).toEqual([]);
    // buckets are chronological
    const sorted = [...hm.buckets].sort();
    expect(hm.buckets).toEqual(sorted);
  });

  it('buckets tasks by day and category, counting per cell', () => {
    const tasks: HeatmapTask[] = [
      { category: 'LATE_DELIVERY', severity: 'WARNING', createdAt: '2026-06-19T08:00:00.000Z' },
      { category: 'LATE_DELIVERY', severity: 'INFO', createdAt: '2026-06-19T20:00:00.000Z' },
      { category: 'STOCKOUT', severity: 'CRITICAL', createdAt: '2026-06-19T09:00:00.000Z' },
    ];
    const hm = buildExceptionHeatmap(tasks, 30);
    const late = hm.cells.find((c) => c.category === 'LATE_DELIVERY' && c.bucket === '2026-06-19');
    expect(late?.count).toBe(2);
    const stock = hm.cells.find((c) => c.category === 'STOCKOUT' && c.bucket === '2026-06-19');
    expect(stock?.count).toBe(1);
  });

  it('takes severityMax per cell with CRITICAL > WARNING > INFO precedence', () => {
    const tasks: HeatmapTask[] = [
      { category: 'X', severity: 'INFO', createdAt: '2026-06-19T01:00:00.000Z' },
      { category: 'X', severity: 'CRITICAL', createdAt: '2026-06-19T02:00:00.000Z' },
      { category: 'X', severity: 'WARNING', createdAt: '2026-06-19T03:00:00.000Z' },
    ];
    const hm = buildExceptionHeatmap(tasks, 30);
    const cell = hm.cells.find((c) => c.category === 'X' && c.bucket === '2026-06-19');
    expect(cell?.severityMax).toBe('CRITICAL');
    expect(cell?.count).toBe(3);
  });

  it('orders categories by total count desc, ties by name asc', () => {
    const tasks: HeatmapTask[] = [
      { category: 'B', severity: 'INFO', createdAt: '2026-06-19T01:00:00.000Z' },
      { category: 'B', severity: 'INFO', createdAt: '2026-06-19T02:00:00.000Z' },
      { category: 'A', severity: 'INFO', createdAt: '2026-06-19T03:00:00.000Z' },
      { category: 'C', severity: 'INFO', createdAt: '2026-06-19T04:00:00.000Z' },
    ];
    const hm = buildExceptionHeatmap(tasks, 30);
    // B has 2, A and C have 1 each (A before C by name)
    expect(hm.categories).toEqual(['B', 'A', 'C']);
  });

  it('limits topCategories to 5 ordered by count', () => {
    const tasks: HeatmapTask[] = [];
    const counts: Record<string, number> = { c1: 6, c2: 5, c3: 4, c4: 3, c5: 2, c6: 1 };
    for (const [cat, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        tasks.push({ category: cat, severity: 'INFO', createdAt: '2026-06-19T00:00:00.000Z' });
      }
    }
    const hm = buildExceptionHeatmap(tasks, 30);
    expect(hm.topCategories).toHaveLength(5);
    expect(hm.topCategories.map((t) => t.category)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(hm.topCategories[0]).toEqual({ category: 'c1', count: 6 });
  });
});
