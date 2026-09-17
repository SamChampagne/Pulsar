/**
 * Pure RFC 5545 (iCalendar) writer — no Node imports, browser-safe. Used by
 * partner-facing calendar feeds (e.g. the yard dock-appointment feed).
 *
 * Deliberately minimal: one VEVENT per input event, UTC floating-free
 * DTSTART/DTEND, CRLF line endings and 75-octet line folding as required by
 * the spec for interoperability with real calendar clients (Outlook, Google
 * Calendar, Apple Calendar).
 */

export interface IcsEvent {
  /** Globally unique identifier for this event (stable across regenerations). */
  uid: string;
  start: Date | string;
  end: Date | string;
  summary: string;
  location?: string;
  description?: string;
}

export interface IcsOptions {
  /** PRODID value; defaults to a generic Pulsar identifier. */
  prodId?: string;
  /** X-WR-CALNAME — the calendar's display name in most clients. */
  calName?: string;
  /** "Now" used for DTSTAMP; defaults to `new Date()`. Inject for deterministic tests/output. */
  now?: Date;
}

const DEFAULT_PROD_ID = '-//Pulsar//iCal Feed//EN';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Formats a date as a UTC iCalendar DATE-TIME: `YYYYMMDDTHHMMSSZ`. */
function toIcsDateUtc(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Escapes a TEXT value per RFC 5545 §3.3.11: backslash, comma, semicolon and
 * newline are backslash-escaped (backslash first, so the escapes it
 * introduces are never themselves re-escaped).
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds one unfolded content line to at most 75 octets per physical line
 * (RFC 5545 §3.1), continuing on the next line with a single leading space.
 * Splits on Unicode code points so a multi-byte UTF-8 character is never cut
 * in half.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const codePoints = Array.from(line);
  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  // First physical line budgets the full 75 octets; every continuation line
  // carries one leading space, so it budgets 74 octets of content (74 + 1 = 75).
  let limit = 75;
  for (const ch of codePoints) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      segments.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += ch;
    currentBytes += chBytes;
  }
  segments.push(current);
  return segments.join('\r\n ');
}

/**
 * Builds a complete RFC 5545 VCALENDAR document containing one VEVENT per
 * input event. Pure function: given the same events and the same `now` it
 * returns the same string (DTSTAMP is the only field derived from "now").
 */
export function buildIcs(events: IcsEvent[], opts: IcsOptions = {}): string {
  const dtstamp = toIcsDateUtc(opts.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId ?? DEFAULT_PROD_ID}`,
    'CALSCALE:GREGORIAN',
  ];
  if (opts.calName) lines.push(`X-WR-CALNAME:${escapeText(opts.calName)}`);

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(ev.uid)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toIcsDateUtc(ev.start)}`);
    lines.push(`DTEND:${toIcsDateUtc(ev.end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
