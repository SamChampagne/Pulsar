import { DOMAIN_EVENT_TYPES } from '@pulsar/shared';
import { LoadNotificationsService } from './load-notifications.service';
describe('load notifications with returns', () => {
  const setup = () => {
    const findMany = jest.fn().mockResolvedValue([]),
      emit = jest.fn().mockResolvedValue(undefined),
      queue = jest.fn();
    const service = new LoadNotificationsService(
      { shipment: { findMany } } as never,
      { emit } as never,
      { queue } as never,
      { get: () => 'https://example.invalid' } as never,
    );
    return { service, findMany, emit, queue };
  };
  it('does not emit delivered/completed event for a trip closed with returns', async () => {
    const { service, findMany, emit, queue } = setup();
    await service.onCompleted('tenant', {
      id: 'load',
      loadNumber: 'LD-1',
      hasReturnedPackages: true,
    });
    expect(emit).toHaveBeenCalledWith(
      'tenant',
      DOMAIN_EVENT_TYPES.LOAD_CLOSED_WITH_RETURNS,
      expect.anything(),
      expect.anything(),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant',
          loadId: 'load',
          status: { in: ['DELIVERED', 'CLOSED'] },
          deliveryPackages: { none: { tenantId: 'tenant', status: 'RETURNED' } },
        },
      }),
    );
    expect(queue).not.toHaveBeenCalled();
  });
  it('preserves completion event for a normally delivered trip', async () => {
    const { service, emit } = setup();
    await service.onCompleted('tenant', {
      id: 'load',
      loadNumber: 'LD-1',
      hasReturnedPackages: false,
    });
    expect(emit).toHaveBeenCalledWith(
      'tenant',
      DOMAIN_EVENT_TYPES.LOAD_COMPLETED,
      expect.anything(),
      expect.anything(),
    );
  });
});
