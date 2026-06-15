import { describe, expect, it } from 'vitest';
import {
  DockAppointmentStatus,
  YardVisitStatus,
  canTransitionDockAppointment,
  canTransitionYardVisit,
  isSpotOccupied,
} from './yard.workflow';

describe('canTransitionYardVisit', () => {
  it('allows the yard lifecycle', () => {
    expect(canTransitionYardVisit(YardVisitStatus.CHECKED_IN, YardVisitStatus.ASSIGNED)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.ASSIGNED, YardVisitStatus.CHECKED_IN)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.CHECKED_IN, YardVisitStatus.DEPARTED)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.ASSIGNED, YardVisitStatus.DEPARTED)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.CHECKED_IN, YardVisitStatus.CANCELLED)).toBe(true);
  });
  it('is a no-op when from===to', () => {
    expect(canTransitionYardVisit(YardVisitStatus.ASSIGNED, YardVisitStatus.ASSIGNED)).toBe(true);
  });
  it('rejects out of terminal states', () => {
    expect(canTransitionYardVisit(YardVisitStatus.DEPARTED, YardVisitStatus.ASSIGNED)).toBe(false);
    expect(canTransitionYardVisit(YardVisitStatus.CANCELLED, YardVisitStatus.CHECKED_IN)).toBe(false);
  });
});

describe('canTransitionDockAppointment', () => {
  it('allows the appointment lifecycle', () => {
    expect(canTransitionDockAppointment(DockAppointmentStatus.SCHEDULED, DockAppointmentStatus.ARRIVED)).toBe(true);
    expect(canTransitionDockAppointment(DockAppointmentStatus.ARRIVED, DockAppointmentStatus.COMPLETED)).toBe(true);
    expect(canTransitionDockAppointment(DockAppointmentStatus.SCHEDULED, DockAppointmentStatus.CANCELLED)).toBe(true);
    expect(canTransitionDockAppointment(DockAppointmentStatus.SCHEDULED, DockAppointmentStatus.NO_SHOW)).toBe(true);
  });
  it('rejects COMPLETED→anything and ARRIVED→NO_SHOW', () => {
    expect(canTransitionDockAppointment(DockAppointmentStatus.COMPLETED, DockAppointmentStatus.CANCELLED)).toBe(false);
    expect(canTransitionDockAppointment(DockAppointmentStatus.ARRIVED, DockAppointmentStatus.NO_SHOW)).toBe(false);
  });
});

describe('isSpotOccupied', () => {
  it('is occupied when an active visit is present', () => {
    expect(isSpotOccupied([YardVisitStatus.ASSIGNED])).toBe(true);
    expect(isSpotOccupied([YardVisitStatus.CHECKED_IN])).toBe(true);
  });
  it('is free when empty or only terminal visits', () => {
    expect(isSpotOccupied([])).toBe(false);
    expect(isSpotOccupied([YardVisitStatus.DEPARTED, YardVisitStatus.CANCELLED])).toBe(false);
  });
});
