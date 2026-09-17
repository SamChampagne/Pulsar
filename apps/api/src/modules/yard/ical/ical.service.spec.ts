import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuditEntry, AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
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
    apiUrl?: string;
  } = {},
) {
  const tenantModules = opts.tenantModules ?? [];
  const appointments = opts.appointments ?? [];
  const auditCalls: AuditEntry[] = [];
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

  const audit = {
    log: async (entry: AuditEntry) => {
      auditCalls.push(entry);
    },
  } as unknown as AuditLogsService;

  const config = {
    get: (_key: string, fallback?: string) => opts.apiUrl ?? fallback,
  } as unknown as ConfigService;

  return {
    svc: new YardIcalService(prisma, modulesCache, audit, config),
    tenantModules,
    auditCalls,
  };
}

describe('YardIcalService', () => {
  describe('generateToken', () => {
    it('creates the TenantModule row when none exists yet and stores icalToken + icalTokenRotatedAt', async () => {
      const { svc, tenantModules } = harness();
      const { token } = await svc.generateToken('t1', 'u1');
      expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(tenantModules).toHaveLength(1);
      expect(tenantModules[0].settings.icalToken).toBe(token);
      expect(typeof tenantModules[0].settings.icalTokenRotatedAt).toBe('string');
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
      const { token } = await svc.generateToken('t1', 'u1');
      expect(token).not.toBe('old-token');
      expect(tenantModules[0].settings.icalToken).toBe(token);
      expect(tenantModules[0].settings.foo).toBe('bar');
    });

    it('audits a first-time generation as CREATE, actor = userId, never logging the token', async () => {
      const { svc, auditCalls } = harness();
      await svc.generateToken('t1', 'u1');
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        tenantId: 't1',
        userId: 'u1',
        action: 'CREATE',
        entityType: 'yard-ical-token',
      });
      expect(JSON.stringify(auditCalls[0])).not.toMatch(/[A-Za-z0-9_-]{30,}/);
    });

    it('audits a rotation as UPDATE', async () => {
      const { svc, auditCalls } = harness({
        tenantModules: [
          { tenantId: 't1', moduleId: 'mod-yard', enabled: true, settings: { icalToken: 'old' } },
        ],
      });
      await svc.generateToken('t1', 'u1');
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].action).toBe('UPDATE');
    });
  });

  describe('getStatus', () => {
    it('reports hasToken: false when nothing was ever generated', async () => {
      const { svc } = harness();
      expect(await svc.getStatus('t1')).toEqual({ hasToken: false });
    });

    it('reports hasToken: true + rotatedAt after generation, without leaking the token value', async () => {
      const { svc } = harness();
      const { token } = await svc.generateToken('t1', 'u1');
      const status = await svc.getStatus('t1');
      expect(status.hasToken).toBe(true);
      expect(typeof status.rotatedAt).toBe('string');
      expect(Object.keys(status).sort()).toEqual(['hasToken', 'rotatedAt']);
      expect(JSON.stringify(status)).not.toContain(token);
    });
  });

  describe('buildPublicUrl', () => {
    it('builds the URL from API_URL config, not a request host', () => {
      const { svc } = harness({ apiUrl: 'https://api.example.com' });
      expect(svc.buildPublicUrl('tok123')).toBe(
        'https://api.example.com/api/v1/public/ical/yard/tok123',
      );
    });

    it('strips a trailing slash from API_URL', () => {
      const { svc } = harness({ apiUrl: 'https://api.example.com/' });
      expect(svc.buildPublicUrl('tok123')).toBe(
        'https://api.example.com/api/v1/public/ical/yard/tok123',
      );
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
