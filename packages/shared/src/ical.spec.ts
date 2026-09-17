import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIcs } from './ical';

/** Reverses RFC 5545 line folding: a CRLF immediately followed by a space is a fold, not a line break. */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n /g, '')
    .split('\r\n')
    .filter((l) => l.length > 0);
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

describe('buildIcs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps events in VCALENDAR/VEVENT with CRLF line endings', () => {
    const ics = buildIcs([
      {
        uid: 'evt-1@pulsar',
        start: new Date('2026-09-20T14:00:00.000Z'),
        end: new Date('2026-09-20T15:30:00.000Z'),
        summary: 'RDV quai DA-1',
      },
    ]);
    expect(ics.match(/(?<!\r)\n/g)).toBeNull(); // every newline is part of a CRLF pair
    const lines = unfold(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('UID:evt-1@pulsar');
    expect(lines).toContain('END:VEVENT');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
  });

  it('formats DTSTART/DTEND as UTC YYYYMMDDTHHMMSSZ and stamps DTSTAMP from "now"', () => {
    const ics = buildIcs([
      {
        uid: 'evt-2@pulsar',
        start: '2026-09-20T14:05:09.000Z',
        end: '2026-09-20T15:30:00.000Z',
        summary: 'Fenêtre',
      },
    ]);
    const lines = unfold(ics);
    expect(lines).toContain('DTSTART:20260920T140509Z');
    expect(lines).toContain('DTEND:20260920T153000Z');
    expect(lines).toContain('DTSTAMP:20260917T120000Z');
  });

  it('escapes commas, semicolons, backslashes and newlines in TEXT fields', () => {
    const ics = buildIcs([
      {
        uid: 'evt-3@pulsar',
        start: '2026-09-20T14:00:00.000Z',
        end: '2026-09-20T15:00:00.000Z',
        summary: 'A, B; C\\D',
        description: 'Line one\nLine two',
      },
    ]);
    const lines = unfold(ics);
    expect(lines).toContain('SUMMARY:A\\, B\\; C\\\\D');
    expect(lines).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('includes LOCATION only when provided, and X-WR-CALNAME when calName is set', () => {
    const withLocation = unfold(
      buildIcs(
        [
          {
            uid: 'e@p',
            start: '2026-01-01T00:00:00Z',
            end: '2026-01-01T01:00:00Z',
            summary: 's',
            location: 'Quai 3',
          },
        ],
        { calName: 'Mon calendrier' },
      ),
    );
    expect(withLocation).toContain('LOCATION:Quai 3');
    expect(withLocation).toContain('X-WR-CALNAME:Mon calendrier');

    const withoutLocation = unfold(
      buildIcs([
        { uid: 'e@p', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', summary: 's' },
      ]),
    );
    expect(withoutLocation.some((l) => l.startsWith('LOCATION:'))).toBe(false);
    expect(withoutLocation.some((l) => l.startsWith('X-WR-CALNAME:'))).toBe(false);
  });

  it('folds long lines at 75 octets, continuation lines starting with a single space', () => {
    const longSummary = 'S'.repeat(200);
    const ics = buildIcs([
      {
        uid: 'evt-4@pulsar',
        start: '2026-01-01T00:00:00Z',
        end: '2026-01-01T01:00:00Z',
        summary: longSummary,
      },
    ]);
    // Every raw physical line (before unfolding) must be <= 75 octets.
    const physicalLines = ics.split('\r\n').filter((l) => l.length > 0);
    for (const line of physicalLines) {
      expect(byteLength(line)).toBeLessThanOrEqual(75);
    }
    // At least one continuation line (starts with a space) was produced.
    expect(physicalLines.some((l) => l.startsWith(' '))).toBe(true);
    // Unfolding reconstructs the exact original SUMMARY content.
    const lines = unfold(ics);
    expect(lines).toContain(`SUMMARY:${longSummary}`);
  });

  it('does not split a multi-byte UTF-8 character across a fold boundary', () => {
    // Multi-byte accented/emoji characters repeated well past the fold threshold.
    const longSummary = 'é'.repeat(100) + '🚚'.repeat(20);
    const ics = buildIcs([
      {
        uid: 'evt-5@pulsar',
        start: '2026-01-01T00:00:00Z',
        end: '2026-01-01T01:00:00Z',
        summary: longSummary,
      },
    ]);
    const physicalLines = ics.split('\r\n').filter((l) => l.length > 0);
    for (const line of physicalLines) {
      expect(byteLength(line)).toBeLessThanOrEqual(75);
      // A line must be valid UTF-16 (no lone surrogate from a split code point).
      expect(() => Array.from(line)).not.toThrow();
    }
    const lines = unfold(ics);
    expect(lines).toContain(`SUMMARY:${longSummary}`);
  });

  it('is deterministic given fixed dates and system time', () => {
    const events = [
      {
        uid: 'evt-6@pulsar',
        start: '2026-01-01T00:00:00Z',
        end: '2026-01-01T01:00:00Z',
        summary: 'Fixe',
      },
    ];
    const a = buildIcs(events, { calName: 'Cal' });
    const b = buildIcs(events, { calName: 'Cal' });
    expect(a).toBe(b);
  });

  it('produces an empty-events calendar with no VEVENT blocks', () => {
    const ics = buildIcs([]);
    expect(ics).not.toContain('BEGIN:VEVENT');
    const lines = unfold(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
  });
});
