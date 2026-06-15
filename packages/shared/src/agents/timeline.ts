// Pure, browser-safe.

export interface TimelineEntry {
  at: string;        // ISO timestamp
  kind: string;      // 'run' | 'action' | 'lifecycle'
  summary: string;
  ref?: string;
}

/** Flatten, sort by `at` descending (ISO strings compare lexicographically), truncate to `limit`. */
export function mergeTimeline(sources: TimelineEntry[][], limit: number): TimelineEntry[] {
  return sources
    .flat()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
