import { ComplianceDocType, ComplianceSubject } from '@pulsar/shared';
import { ComplianceService } from './compliance.service';

function harness(docs: any[] = []) {
  const store = [...docs];
  const prisma = {
    complianceDocument: {
      findMany: async ({ where }: any) =>
        store.filter((d) => {
          if (where.tenantId && d.tenantId !== where.tenantId) return false;
          if (where.subjectType && d.subjectType !== where.subjectType) return false;
          if (where.subjectId && d.subjectId !== where.subjectId) return false;
          if (where.expiresAt?.lte && new Date(d.expiresAt) > where.expiresAt.lte) return false;
          return true;
        }),
      findFirst: async ({ where }: any) =>
        store.find((d) => d.id === where.id && d.tenantId === where.tenantId) ?? null,
      create: async ({ data }: any) => {
        const row = { id: 'cd' + (store.length + 1), ...data };
        store.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const i = store.findIndex((d) => d.id === where.id && d.tenantId === where.tenantId);
        if (i >= 0) {
          store.splice(i, 1);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    vehicle: { findFirst: async () => ({ id: 'v1' }) },
    trailer: { findFirst: async () => ({ id: 'tr1' }) },
    driver: { findFirst: async () => ({ id: 'd1' }) },
  } as any;
  const ownership = { assertOwned: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new ComplianceService(prisma, ownership, audit), store };
}

const NOW = new Date('2026-06-15T00:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe('ComplianceService.expiring', () => {
  it('returns only docs expiring within the window, with computed status', async () => {
    const h = harness([
      { id: 'a', tenantId: 't1', subjectType: 'VEHICLE', subjectId: 'v1', docType: 'INSURANCE', expiresAt: inDays(5) },
      { id: 'b', tenantId: 't1', subjectType: 'VEHICLE', subjectId: 'v1', docType: 'REGISTRATION', expiresAt: inDays(200) },
      { id: 'c', tenantId: 't1', subjectType: 'VEHICLE', subjectId: 'v1', docType: 'INSPECTION', expiresAt: inDays(-3) },
    ]);
    const res = await h.svc.expiring('t1', 30, NOW.getTime());
    const ids = res.map((d: any) => d.id).sort();
    expect(ids).toEqual(['a', 'c']); // 5d (expiring) + already expired; 200d excluded
    const a = res.find((d: any) => d.id === 'a')!;
    expect(a.status).toBe('EXPIRING');
    const c = res.find((d: any) => d.id === 'c')!;
    expect(c.status).toBe('EXPIRED');
  });

  it('list attaches computed status to every doc', async () => {
    const h = harness([{ id: 'a', tenantId: 't1', subjectType: 'VEHICLE', subjectId: 'v1', docType: 'INSURANCE', expiresAt: inDays(400) }]);
    const res = await h.svc.list('t1', {}, NOW.getTime());
    expect(res[0].status).toBe('VALID');
  });

  it('create validates subject ownership and persists', async () => {
    const h = harness();
    const row = await h.svc.create('t1', 'u1', {
      subjectType: ComplianceSubject.VEHICLE,
      subjectId: 'v1',
      docType: ComplianceDocType.INSURANCE,
      expiresAt: new Date(inDays(100)),
    } as any);
    expect(row.id).toBeTruthy();
    expect(h.store.length).toBe(1);
  });
});
