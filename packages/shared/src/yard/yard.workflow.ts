export enum YardSpotType {
  DOCK_DOOR = 'DOCK_DOOR',
  PARKING = 'PARKING',
  STAGING = 'STAGING',
}

export enum YardDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  OTHER = 'OTHER',
}

export enum YardVisitStatus {
  CHECKED_IN = 'CHECKED_IN',
  ASSIGNED = 'ASSIGNED',
  DEPARTED = 'DEPARTED',
  CANCELLED = 'CANCELLED',
}

export enum DockAppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  ARRIVED = 'ARRIVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

const VISIT_TRANSITIONS: Record<YardVisitStatus, YardVisitStatus[]> = {
  [YardVisitStatus.CHECKED_IN]: [YardVisitStatus.ASSIGNED, YardVisitStatus.DEPARTED, YardVisitStatus.CANCELLED],
  [YardVisitStatus.ASSIGNED]: [YardVisitStatus.CHECKED_IN, YardVisitStatus.DEPARTED, YardVisitStatus.CANCELLED],
  [YardVisitStatus.DEPARTED]: [],
  [YardVisitStatus.CANCELLED]: [],
};

export function canTransitionYardVisit(from: YardVisitStatus, to: YardVisitStatus): boolean {
  if (from === to) return true;
  return VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}

const APPOINTMENT_TRANSITIONS: Record<DockAppointmentStatus, DockAppointmentStatus[]> = {
  [DockAppointmentStatus.SCHEDULED]: [DockAppointmentStatus.ARRIVED, DockAppointmentStatus.CANCELLED, DockAppointmentStatus.NO_SHOW],
  [DockAppointmentStatus.ARRIVED]: [DockAppointmentStatus.COMPLETED, DockAppointmentStatus.CANCELLED],
  [DockAppointmentStatus.COMPLETED]: [],
  [DockAppointmentStatus.CANCELLED]: [],
  [DockAppointmentStatus.NO_SHOW]: [],
};

export function canTransitionDockAppointment(from: DockAppointmentStatus, to: DockAppointmentStatus): boolean {
  if (from === to) return true;
  return APPOINTMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A spot is occupied if any visit pointing to it is in a non-terminal status. */
export function isSpotOccupied(visitStatuses: YardVisitStatus[]): boolean {
  return visitStatuses.some((s) => s === YardVisitStatus.CHECKED_IN || s === YardVisitStatus.ASSIGNED);
}
