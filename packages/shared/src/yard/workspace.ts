/** Display geometry only. Never used for occupancy, routing or capacity. */
export interface YardPlanShape {
  id: string;
  kind: 'BUILDING' | 'AREA' | 'GATE';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface YardPlanPosition {
  id: string;
  posX: number | null;
  posY: number | null;
}
export interface YardWorkspaceVisit {
  id: string;
  visitNumber: string;
  status: string;
  direction: string;
  spotId: string | null;
  appointmentId: string | null;
  trailerRef: string | null;
  driverName: string | null;
  checkInAt: string;
  trailer: { unitNumber: string; plate: string | null } | null;
  carrier: { name: string } | null;
}
export interface YardWorkspaceSpot extends YardPlanPosition {
  code: string;
  type: string;
  isActive: boolean;
}
export interface YardWorkspaceAppointment {
  id: string;
  appointmentNumber: string;
  status: string;
  direction: string;
  spotId: string | null;
  carrierId: string | null;
  windowStart: string;
  windowEnd: string;
  reference: string | null;
  notes: string | null;
  carrier: { name: string } | null;
}
export interface YardWorkspace {
  site: { id: string; code: string; name: string; timezone: string | null };
  timeZone: string;
  timezoneFallback: boolean;
  date: string;
  start: string;
  end: string;
  generatedAt: string;
  planVersion: string;
  shapes: YardPlanShape[];
  spots: YardWorkspaceSpot[];
  visits: YardWorkspaceVisit[];
  appointments: YardWorkspaceAppointment[];
  truncated: { spots: boolean; visits: boolean; appointments: boolean };
}

export const yardDirectionLabel = (s: string) =>
  ({ INBOUND: 'Réception', OUTBOUND: 'Expédition', OTHER: 'Autre' })[s] ?? s;
export const yardSpotLabel = (s: string) =>
  ({ DOCK_DOOR: 'Quai', PARKING: 'Stationnement', STAGING: 'Zone d’attente' })[s] ?? s;
export const yardStatusLabel = (s: string) =>
  ({
    CHECKED_IN: 'À affecter',
    ASSIGNED: 'Affectée',
    DEPARTED: 'Partie',
    CANCELLED: 'Annulée',
    SCHEDULED: 'Prévu',
    ARRIVED: 'Arrivé',
    COMPLETED: 'Terminé',
    NO_SHOW: 'Absent',
  })[s] ?? s;

export function yardDateInZone(instant: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (t: string) => p.find((v) => v.type === t)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** Calendar-day bounds in the site's IANA zone, including 23/25-hour DST days. */
export function yardDayRange(date: string, zone: string | null) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number(date.slice(0, 4)) < 1900 ||
    Number(date.slice(0, 4)) > 9998 ||
    !Number.isFinite(+parsed) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new Error('Date invalide.');
  let timeZone = zone || 'UTC',
    timezoneFallback = !zone;
  try {
    yardDateInZone(parsed, timeZone);
  } catch {
    timeZone = 'UTC';
    timezoneFallback = true;
  }
  const next = new Date(+parsed + 86400000).toISOString().slice(0, 10);
  const midnight = (target: string, base: number) => {
    let lo = base - 36 * 3600000,
      hi = base + 36 * 3600000;
    while (hi - lo > 1) {
      const mid = Math.floor((hi + lo) / 2);
      if (yardDateInZone(new Date(mid), timeZone) < target) lo = mid;
      else hi = mid;
    }
    return new Date(hi).toISOString();
  };
  const start = midnight(date, +parsed),
    end = midnight(next, +parsed + 86400000);
  if (start >= end) throw new Error('Cette date n’existe pas dans le fuseau du site.');
  return {
    timeZone,
    timezoneFallback,
    start,
    end,
  };
}

/** Advisory schedule conflicts; terminal appointments never reserve a window. */
export function yardAppointmentConflicts(
  rows: Pick<YardWorkspaceAppointment, 'id' | 'spotId' | 'status' | 'windowStart' | 'windowEnd'>[],
): string[] {
  const active = rows.filter((a) => a.spotId && ['SCHEDULED', 'ARRIVED'].includes(a.status));
  const conflicts = new Set<string>();
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i],
        b = active[j];
      if (
        a.spotId === b.spotId &&
        +new Date(a.windowStart) < +new Date(b.windowEnd) &&
        +new Date(b.windowStart) < +new Date(a.windowEnd)
      ) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  return [...conflicts];
}
