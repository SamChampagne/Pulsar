import { DockAppointmentStatus } from '@pulsar/shared';
import { AppointmentsService } from './appointments.service';

function harness(status = DockAppointmentStatus.SCHEDULED) {
  const appt: any = { id: 'a1', tenantId: 't1', status };
  const prisma = {
    location: { findFirst: async () => ({ id: 'loc1', tenantId: 't1' }) },
    dockAppointment: {
      findFirst: async () => appt,
      updateMany: async ({ where, data }: any) => {
        const ok = where.status === appt.status || (where.status?.in ?? []).includes(appt.status);
        if (ok) {
          Object.assign(appt, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  } as any;
  const sequences = { nextNumber: async () => 'DA-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  const customFields = { validateValues: async () => undefined } as any;
  return { svc: new AppointmentsService(prisma, sequences, ownership, audit, domainEvents, customFields), appt };
}

describe('AppointmentsService transitions', () => {
  it('arrive flips SCHEDULED→ARRIVED', async () => {
    const h = harness();
    await h.svc.arrive('t1', 'u1', 'a1');
    expect(h.appt.status).toBe(DockAppointmentStatus.ARRIVED);
  });
  it('complete from ARRIVED', async () => {
    const h = harness(DockAppointmentStatus.ARRIVED);
    await h.svc.complete('t1', 'u1', 'a1');
    expect(h.appt.status).toBe(DockAppointmentStatus.COMPLETED);
  });
  it('rejects completing a SCHEDULED appointment', async () => {
    const h = harness(DockAppointmentStatus.SCHEDULED);
    await expect(h.svc.complete('t1', 'u1', 'a1')).rejects.toThrow();
  });
});
