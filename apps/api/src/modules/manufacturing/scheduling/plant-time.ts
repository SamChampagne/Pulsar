import { BadRequestException } from '@nestjs/common';
import type { ApsCalendar, ApsBridgeV2Request } from '../../../core/aps/aps.types';

const DAY = 86_400_000;

/** Boundary conversion only: scheduling and elapsed-minute calculations remain in APS. */
export function plantClock(timeZone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new BadRequestException('Fuseau IANA inconnu (exemple : America/Toronto).');
  }
  const wall = (ms: number) => {
    const p = Object.fromEntries(format.formatToParts(ms).map((v) => [v.type, v.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  const offsetsByDay = new Map<string, Set<number>>();
  const instants = new Map<string, number>();
  const instant = (local: string) => {
    const cached = instants.get(local);
    if (cached !== undefined) return cached;
    const naive = Date.parse(`${local}Z`);
    if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== local)
      throw new BadRequestException(`Date locale invalide : ${local}.`);
    const key = local.slice(0, 10);
    let offsets = offsetsByDay.get(key);
    if (!offsets) {
      offsets = new Set<number>();
      // Probe both sides of a transition, including non-hour offsets and skipped dates.
      const noon = Date.parse(`${key}T12:00:00Z`);
      for (let hours = -48; hours <= 48; hours += 6) {
        const probe = noon + hours * 3_600_000;
        offsets.add(Date.parse(`${wall(probe)}Z`) - probe);
      }
      offsetsByDay.set(key, offsets);
    }
    const matches = [...offsets].map((offset) => naive - offset).filter((ms) => wall(ms) === local);
    if (matches.length !== 1)
      throw new BadRequestException(
        `Heure locale ${matches.length ? 'ambiguë' : 'inexistante'} : ${local} (${timeZone}). Ajustez la date ou le quart; aucun décalage automatique n’est appliqué.`,
      );
    instants.set(local, matches[0]);
    return matches[0];
  };
  return { wall, instant };
}

export function plantWindows(
  calendars: ApsCalendar[],
  timeZone: string,
  date: string | undefined,
  days: number,
  now = new Date(),
): Pick<ApsBridgeV2Request, 'horizon_start' | 'horizon_end' | 'calendar_windows'> {
  const clock = plantClock(timeZone);
  const localDate = date ?? clock.wall(now.getTime()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isInteger(days) || days < 1 || days > 365)
    throw new BadRequestException('Date de début ou horizon invalide (1 à 365 jours).');
  const start = clock.instant(`${localDate}T00:00:00`);
  const localStart = Date.parse(`${localDate}T00:00:00Z`);
  const endDate = new Date(localStart + days * DAY).toISOString().slice(0, 10);
  const end = clock.instant(`${endDate}T00:00:00`);
  const wire = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  const calendar_windows: ApsBridgeV2Request['calendar_windows'] = {};
  let totalWindows = 0;
  for (const calendar of calendars) {
    const windows: { start: string; end: string }[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(localStart + i * DAY);
      const weekday = (day.getUTCDay() + 6) % 7;
      for (const shift of calendar.shifts ?? []) {
        if (shift.weekday !== weekday) continue;
        if (
          !/^\d{2}:\d{2}$/.test(shift.start) ||
          !/^\d{2}:\d{2}$/.test(shift.end) ||
          shift.end <= shift.start
        )
          throw new BadRequestException(
            `Calendrier ${calendar.name} : le quart doit finir après son début, le même jour.`,
          );
        const dayString = day.toISOString().slice(0, 10);
        const from = Math.max(start, clock.instant(`${dayString}T${shift.start}:00`));
        const until = Math.min(end, clock.instant(`${dayString}T${shift.end}:00`));
        if (from < until) {
          if (++totalWindows > 100_000)
            throw new BadRequestException('Trop de fenêtres de calendrier; réduisez l’horizon.');
          windows.push({ start: wire(from), end: wire(until) });
        }
      }
    }
    calendar_windows[calendar.id] = windows;
  }
  return { horizon_start: wire(start), horizon_end: wire(end), calendar_windows };
}
