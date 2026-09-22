import { calendarDate } from './calendar-date';
export enum HrSkillKind {
  COMPETENCE = 'COMPETENCE',
  AUTHORIZATION = 'AUTHORIZATION',
}
export enum HrQualificationStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}
export const canTransitionHrQualification = (
  from: HrQualificationStatus,
  to: HrQualificationStatus,
) => from === HrQualificationStatus.ACTIVE && to === HrQualificationStatus.REVOKED;
export function qualificationDates(start: string, end: string | null) {
  const validFrom = calendarDate(start),
    expiresOn = end === null ? null : calendarDate(end);
  if (expiresOn && expiresOn < validFrom) throw new Error('La fin précède le début de validité.');
  return { validFrom, expiresOn };
}
export function qualificationState(
  q: { status: string; validFrom: string; expiresOn: string | null },
  day: string,
) {
  calendarDate(day);
  if (q.status === 'REVOKED') return 'REVOKED';
  if (q.validFrom.slice(0, 10) > day) return 'UPCOMING';
  if (q.expiresOn && q.expiresOn.slice(0, 10) < day) return 'EXPIRED';
  return 'VALID';
}
export const QUALIFICATION_LABELS = {
  VALID: 'Valide à cette date',
  UPCOMING: 'À venir',
  EXPIRED: 'Expirée',
  REVOKED: 'Révoquée',
};
