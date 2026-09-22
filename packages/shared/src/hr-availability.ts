import { isCalendarDate } from './calendar-date';

/** A point-in-time advisory, never a capacity reservation or a full HR record. */
export type HrAvailabilityState =
  | 'ABSENT'
  | 'NO_APPROVED_ABSENCE'
  | 'EMPLOYEE_NOT_LINKED'
  | 'EMPLOYEE_INACTIVE'
  | 'USER_UNAVAILABLE';
export interface HrAvailabilityInput {
  userId: string;
  scheduledAt: string;
}
export interface HrAvailabilityResult {
  timeZone: string;
  checkedAt: string;
  /** Same order as the request, no employee/leave identifiers, periods or reasons. */
  items: { date: string; state: HrAvailabilityState }[];
}
export const HR_AVAILABILITY_LABELS: Record<HrAvailabilityState, string> = {
  ABSENT: 'Absence approuvée ce jour',
  NO_APPROVED_ABSENCE: 'Aucune absence approuvée ce jour',
  EMPLOYEE_NOT_LINKED: 'Non vérifié · aucun dossier RH lié',
  EMPLOYEE_INACTIVE: 'Non vérifié · dossier RH inactif',
  USER_UNAVAILABLE: 'Non vérifié · compte non affectable',
};

/** Civil day of an instant in the explicitly supplied UI timezone; DST uses Intl's IANA rules. */
export function hrAvailabilityDate(instant: string, timeZone: string): string {
  if (!timeZone || timeZone.length > 100 || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(instant))
    throw new Error('Horaire avec fuseau et fuseau IANA explicite requis.');
  // Date.parse silently normalizes February 30; reject before conversion.
  if (!isCalendarDate(instant.slice(0, 10))) throw new Error('Date prévue invalide.');
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('Horaire invalide.');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const civil = `${part('year')}-${part('month')}-${part('day')}`;
  if (!isCalendarDate(civil)) throw new Error('Date prévue hors plage RH (1900–2199).');
  return civil;
}
