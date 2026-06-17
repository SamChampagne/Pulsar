/**
 * Yard time clocks (pure, no Node imports). Dwell = how long a trailer has been
 * in the yard; beyond the free window it becomes billable detention. Appointment
 * timing flags lateness against the booked window. Both are computed on read —
 * never persisted — and tick live in the UI from checkInAt / windowEnd.
 */

export const DEFAULT_FREE_DWELL_MINUTES = 120;

export type DwellStatus = 'IN_YARD' | 'WARNING' | 'DETENTION' | 'DEPARTED';

export interface DwellInput {
  checkInAt: Date | string;
  checkOutAt?: Date | string | null;
  /** Free dwell window before detention accrues (minutes). */
  freeMinutes?: number | null;
}

export interface Dwell {
  minutes: number;
  status: DwellStatus;
  /** Minutes beyond the free window (0 until exceeded). */
  detentionMinutes: number;
}

export function computeDwell(input: DwellInput, now: Date = new Date()): Dwell {
  const free = input.freeMinutes ?? DEFAULT_FREE_DWELL_MINUTES;
  const start = new Date(input.checkInAt).getTime();
  const end = input.checkOutAt ? new Date(input.checkOutAt).getTime() : now.getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const detentionMinutes = Math.max(0, minutes - free);

  let status: DwellStatus;
  if (input.checkOutAt) status = 'DEPARTED';
  else if (minutes > free) status = 'DETENTION';
  else if (minutes >= free * 0.75) status = 'WARNING';
  else status = 'IN_YARD';

  return { minutes, status, detentionMinutes };
}

export type AppointmentTimingStatus = 'UPCOMING' | 'DUE' | 'LATE' | 'DONE' | 'CLOSED';

export interface AppointmentTimingInput {
  windowStart: Date | string;
  windowEnd: Date | string;
  /** DockAppointmentStatus value. */
  status: string;
}

export interface AppointmentTiming {
  status: AppointmentTimingStatus;
  minutesLate: number;
}

export function computeAppointmentTiming(
  input: AppointmentTimingInput,
  now: Date = new Date(),
): AppointmentTiming {
  if (input.status === 'ARRIVED' || input.status === 'COMPLETED') {
    return { status: 'DONE', minutesLate: 0 };
  }
  if (input.status === 'CANCELLED' || input.status === 'NO_SHOW') {
    return { status: 'CLOSED', minutesLate: 0 };
  }
  // SCHEDULED
  const t = now.getTime();
  const ws = new Date(input.windowStart).getTime();
  const we = new Date(input.windowEnd).getTime();
  if (t > we) return { status: 'LATE', minutesLate: Math.round((t - we) / 60_000) };
  if (t >= ws) return { status: 'DUE', minutesLate: 0 };
  return { status: 'UPCOMING', minutesLate: 0 };
}
