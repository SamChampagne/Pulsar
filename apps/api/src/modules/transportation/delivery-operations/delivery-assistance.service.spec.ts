import { DeliveryAssistanceService } from './delivery-assistance.service';
describe('delivery assistance context', () => {
  const setup = () => {
    const updatedAt = new Date('2026-10-03T10:00:00Z'),
      load = { id: 'load', status: 'IN_TRANSIT', updatedAt };
    const packages = {
      list: jest
        .fn()
        .mockResolvedValue({
          load,
          shipments: [
            {
              id: 's',
              shipmentNumber: 'S-1',
              status: 'IN_TRANSIT',
              originName: 'A',
              destinationName: 'B',
              packages: [
                {
                  id: 'p',
                  code: 'P-1',
                  status: 'RETURNED',
                  version: 3,
                  label: 'private label',
                  contents: ['not-needed'],
                },
              ],
            },
          ],
        }),
    };
    const exceptions = { list: jest.fn().mockResolvedValue({ load, cases: [], truncated: false }) };
    const fuel = {
      context: jest
        .fn()
        .mockResolvedValue({
          load,
          route: { deliveryPlan: { totals: { liters: 10 } } },
          actual: null,
        }),
    };
    return {
      service: new DeliveryAssistanceService(packages as never, exceptions as never, fuel as never),
      packages,
      exceptions,
      fuel,
    };
  };
  it('uses tenant scoped business services and distinguishes returned from delivered', async () => {
    const { service, packages, exceptions, fuel } = setup();
    const result = await service.context('tenant', 'load');
    for (const fn of [packages.list, exceptions.list, fuel.context])
      expect(fn).toHaveBeenCalledWith('tenant', 'load');
    expect(result.shipments[0].counts).toMatchObject({ delivered: 0, returned: 1 });
    expect(result.shipments[0].packages[0]).not.toHaveProperty('contents');
    expect(result.shipments[0].packages[0]).not.toHaveProperty('label');
    expect(result.fuel.declaredActual).toBeNull();
  });
  it('rejects mixed versions instead of using a stale operational context', async () => {
    const { service, exceptions } = setup();
    exceptions.list.mockResolvedValue({
      load: { updatedAt: new Date('2026-10-03T11:00:00Z') },
      cases: [],
      truncated: false,
    });
    await expect(service.context('tenant', 'load')).rejects.toThrow('La tournée a changé');
  });
});
