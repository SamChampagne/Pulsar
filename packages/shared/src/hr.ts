import { calendarDate } from './calendar-date';

export enum HrLeaveStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}
export enum HrLeaveKind {
  TIME_OFF = 'TIME_OFF',
  UNAVAILABLE = 'UNAVAILABLE',
  OTHER = 'OTHER',
}
export const HR_LEAVE_LABELS: Record<HrLeaveStatus, string> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'À approuver',
  APPROVED: 'Approuvée',
  REJECTED: 'Refusée',
  CANCELLED: 'Annulée',
};
export const HR_LEAVE_KIND_LABELS: Record<HrLeaveKind, string> = {
  TIME_OFF: 'Congé',
  UNAVAILABLE: 'Indisponibilité',
  OTHER: 'Autre absence',
};
const transitions: Record<HrLeaveStatus, readonly HrLeaveStatus[]> = {
  DRAFT: [HrLeaveStatus.SUBMITTED, HrLeaveStatus.CANCELLED],
  SUBMITTED: [
    HrLeaveStatus.DRAFT,
    HrLeaveStatus.APPROVED,
    HrLeaveStatus.REJECTED,
    HrLeaveStatus.CANCELLED,
  ],
  APPROVED: [HrLeaveStatus.CANCELLED],
  REJECTED: [HrLeaveStatus.DRAFT, HrLeaveStatus.CANCELLED],
  CANCELLED: [],
};
export const canTransitionHrLeave = (from: HrLeaveStatus, to: HrLeaveStatus): boolean =>
  transitions[from]?.includes(to) ?? false;
/** Inclusive civil dates, not a payroll duration or a statutory leave calculation. */
export function hrLeaveDates(start: unknown, end: unknown) {
  const startDate = calendarDate(start),
    endDate = calendarDate(end);
  if (endDate < startDate) throw new Error('La fin doit être égale ou postérieure au début.');
  if (endDate.getTime() - startDate.getTime() > 365 * 86400000)
    throw new Error('Une demande couvre au maximum 366 dates civiles.');
  return { startDate, endDate };
}
