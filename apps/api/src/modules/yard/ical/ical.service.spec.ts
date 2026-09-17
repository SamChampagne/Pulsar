import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { YardIcalService } from './ical.service';

interface TenantModuleRow {
  tenantId: string;
  moduleId: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

function harness(
  opts: {
    tenantModules?: TenantModuleRow[];
    appointments?: unknown[];
    yardEnabledKeys?: Set<string>;
  } = {},
) {
  const tenantModules = opts.tenantModules ?? [];
  const appointments = opts.appointments ?? [];
  const yardModuleId = 'mod-yard';

  const prisma = {
    moduleDefinition: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key === 'yard' ? { id: yardModuleId } : null,
    },
    tenantModule: {
      findUnique: async ({
        where,
      }: {
        where: { tenantId_moduleId: { tenantId: string; moduleId: string } };
      }) =>
        tenantModules.find(
          (r) =>
            r.tenantId === where.tenantId_moduleId.tenantId &&
            r.moduleId === where.tenantId_moduleId.moduleId,
        ) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { moduleId: string; settings: { path: string[]; equals: unknown } };
      }) =>
        tenantModules.find(
          (r) =>
            r.moduleId === where.moduleId &&
            r.settings[where.settings.path[0]] === where.settings.equals,
        ) ?? null,
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { tenantId_moduleId: { tenantId: string; moduleId: string } };
        update: { settings: Record<string, unknown> };
        create: TenantModuleRow;
      }) => {
        const existing = tenantModules.find(
          (r) =>
            r.tenantId === where.tenantId_moduleId.tenantId &&
            r.moduleId === where.tenantId_moduleId.moduleId,
        );
        if (existing) {
          existing.settings = update.settings;
          return existing;
        }
        const row: TenantModuleRow = { ...create };
        tenantModules.push(row);
        return row;
      },
    },
    dockAppointment: {
      findMany: async () => appointments,
    },
  } as unknown as PrismaService;

  const modulesCache = {
    invalidate: () => undefined,
    getEnabledKeys: async () => opts.yardEnabledKeys ?? new Set(['yard']),
  } as unknown as TenantModulesCacheService;

  return { svc: new YardIcalService(prisma, modulesCache), tenantModules };
}

describe('YardIcalService', () => {
  describe('generateToken', () => {
    it('creates the TenantModule row when none exists yet and stores icalToken', async () => {
      const { svc, tenantModules } = harness();
      const { token } = await svc.generateToken('t1');
      expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(tenantModules).toHaveLength(1);
      expect(tenantModules[0].settings.icalToken).toBe(token);
    });

    it('rotating overwrites the previous token and preserves other settings', async () => {
      const { svc, tenantModules } = harness({
        tenantModules: [
          {
            tenantId: 't1',
            moduleId: 'mod-yard',
            enabled: true,
            settings: { icalToken: 'old-token', foo: 'bar' },
          },
        ],
      });
      const { token } = await svc.generateToken('t1');
      expect(token).not.toBe('old-token');
      expect(tenantModules[0].settings.icalToken).toBe(token);
      expect(tenantModules[0].settings.foo).toBe('bar');
    });
  });

  describe('buildFeed', () => {
    it('throws NotFoundException for an unknown token', async () => {
      const { svc } = harness();
      await expect(svc.buildFeed('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the tenant row is disabled', async () => {
      const { svc } = harness({
        tenantModules: [
          { tenantId: 't1', moduleId: 'mod-yard', enabled: false, settings: { icalToken: 'tok' } },
        ],
      });
      await expect(svc.buildFeed('tok')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the module cache reports it disabled (rule 15 re-check)', async () => {
      const { svc } = harness({
        tenantModules: [
          { tenantId: 't1', moduleId: 'mod-yard', enabled: true, settings: { icalToken: 'tok' } },
        ],
        yardEnabledKeys: new Set(),
      });
      await expect(svc.buildFeed('tok')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('builds a VCALENDAR feed with one VEVENT per appointment, never leaking tenantId', async () => {
      const { svc } = harness({
        tenantModules: [
          { tenantId: 't1', moduleId: 'mod-yard', enabled: true, settings: { icalToken: 'tok' } },
        ],
        appointments: [
          {
            appointmentNumber: 'DA-0001',
            windowStart: new Date('2026-09-20T14:00:00.000Z'),
            windowEnd: new Date('2026-09-20T15:00:00.000Z'),
            reference: 'PO-42',
            spot: { code: 'DOOR-1' },
            carrier: { name: 'ACME Trucking' },
            visits: [{ trailerRef: 'TR-1', trailer: null }],
          },
        ],
      });
      const ics = await svc.buildFeed('tok');
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('UID:dock-appointment-DA-0001@pulsar');
      expect(ics).toContain('DTSTART:20260920T140000Z');
      expect(ics).toContain('SUMMARY:RDV quai DA-0001');
      expect(ics).toContain('DOOR-1');
      expect(ics).toContain('LOCATION:DOOR-1');
      expect(ics).not.toContain('t1');
    });
  });
});
