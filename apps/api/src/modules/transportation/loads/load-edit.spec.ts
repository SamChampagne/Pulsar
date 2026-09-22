import { LoadsService } from './loads.service';
function setup(status = 'OPEN', count = 1) {
  const prisma = { load: { updateMany: jest.fn().mockResolvedValue({ count }) } };
  const audit = { log: jest.fn() };
  const service = new LoadsService(
    prisma as never,
    {} as never,
    {} as never,
    audit as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(service, 'get').mockResolvedValue({ id: 'l1', status, notes: 'old' } as never);
  return { service, prisma, audit };
}
describe('load note editing', () => {
  it('uses tenant, status and version in the atomic write and audits', async () => {
    const { service, prisma, audit } = setup();
    const expectedUpdatedAt = '2026-09-21T14:00:00.000Z';
    await service.updateNotes('tenant', 'actor', 'l1', { notes: ' corrected ', expectedUpdatedAt });
    expect(prisma.load.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'l1',
        tenantId: 'tenant',
        status: 'OPEN',
        updatedAt: new Date(expectedUpdatedAt),
      },
      data: { notes: 'corrected' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor',
        before: { notes: 'old' },
        after: { notes: 'corrected' },
      }),
    );
  });
  it.each(['TENDERED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'])(
    'protects %s',
    async (status) => {
      const { service, prisma } = setup(status);
      await expect(
        service.updateNotes('tenant', 'actor', 'l1', {
          notes: 'x',
          expectedUpdatedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow();
      expect(prisma.load.updateMany).not.toHaveBeenCalled();
    },
  );
  it('reports a conflict without an audit on stale data', async () => {
    const { service, audit } = setup('PLANNED', 0);
    await expect(
      service.updateNotes('tenant', 'actor', 'l1', {
        notes: '',
        expectedUpdatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Le chargement a changé');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
