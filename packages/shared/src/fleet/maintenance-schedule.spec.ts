import { describe, expect, it } from 'vitest';
import { computeScheduleDue, MaintenanceScheduleStatus } from './maintenance-schedule';

const at = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000);

describe('computeScheduleDue — calendar axis', () => {
  it('is OK well before the interval elapses', () => {
    const r = computeScheduleDue({ intervalDays: 90, anchorDate: at(-10), leadDays: 7 });
    expect(r.status).toBe(MaintenanceScheduleStatus.OK);
    expect(r.isDue).toBe(false);
    expect(r.nextDueDate).not.toBeNull();
  });

  it('is DUE_SOON inside the lead window', () => {
    const r = computeScheduleDue({ intervalDays: 30, anchorDate: at(-26), leadDays: 7 });
    expect(r.status).toBe(MaintenanceScheduleStatus.DUE_SOON);
    expect(r.isDue).toBe(false);
  });

  it('is DUE at/just past the interval', () => {
    const r = computeScheduleDue({ intervalDays: 30, anchorDate: at(-31), leadDays: 7 });
    expect(r.status).toBe(MaintenanceScheduleStatus.DUE);
    expect(r.isDue).toBe(true);
  });

  it('is OVERDUE far past the interval', () => {
    const r = computeScheduleDue({ intervalDays: 30, anchorDate: at(-60), leadDays: 7 });
    expect(r.status).toBe(MaintenanceScheduleStatus.OVERDUE);
    expect(r.isDue).toBe(true);
  });
});

describe('computeScheduleDue — odometer axis', () => {
  it('uses km when an anchor and current reading are present', () => {
    const r = computeScheduleDue(
      { intervalKm: 20000, anchorOdometerKm: 100000, anchorDate: at(0) },
      new Date(),
      119000,
    );
    expect(r.nextDueKm).toBe(120000);
    expect(r.kmUntilDue).toBe(1000);
    expect(r.status).toBe(MaintenanceScheduleStatus.DUE_SOON); // within 10% lead (2000 km)
  });

  it('is DUE when the odometer reaches the next service point', () => {
    const r = computeScheduleDue(
      { intervalKm: 20000, anchorOdometerKm: 100000, anchorDate: at(0) },
      new Date(),
      121000,
    );
    expect(r.status).toBe(MaintenanceScheduleStatus.DUE);
    expect(r.isDue).toBe(true);
  });

  it('ignores the km axis when no current reading is available', () => {
    const r = computeScheduleDue({
      intervalKm: 20000,
      anchorOdometerKm: 100000,
      anchorDate: at(0),
    });
    expect(r.nextDueKm).toBeNull();
    expect(r.status).toBe(MaintenanceScheduleStatus.OK);
  });
});

describe('computeScheduleDue — combined', () => {
  it('takes the worst axis', () => {
    const r = computeScheduleDue(
      { intervalDays: 90, intervalKm: 20000, anchorOdometerKm: 100000, anchorDate: at(-10) },
      new Date(),
      125000, // km overdue, days fine
    );
    expect(r.status).toBe(MaintenanceScheduleStatus.OVERDUE);
  });

  it('is OK with no usable interval', () => {
    const r = computeScheduleDue({ anchorDate: at(-1000) });
    expect(r.status).toBe(MaintenanceScheduleStatus.OK);
    expect(r.isDue).toBe(false);
  });
});
