import { MailService } from './mail.service';

describe('MailService communication delivery guard', () => {
  const message = {
    id: 'mail',
    tenantId: 'tenant',
    status: 'QUEUED',
    relatedType: 'crm-sequence-step',
    relatedId: 'step',
    attachments: [],
    toAddresses: ['person@example.test'],
    cc: [],
    subject: 'Follow-up',
    html: 'Hello',
  };
  function setup() {
    const prisma = {
      emailMessage: {
        findUnique: jest.fn(async () => message),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
    };
    const provider = { send: jest.fn(async () => true) };
    const config = { resolve: jest.fn(async () => null) };
    const service = new MailService(
      prisma as never,
      provider as never,
      config as never,
      {} as never,
    );
    return { service, prisma, provider };
  }
  it('fails closed when the sequence worker has not registered its guard', async () => {
    const { service, provider, prisma } = setup();
    await service.deliver('mail');
    expect(provider.send).not.toHaveBeenCalled();
    expect(prisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });
  it('a paused sender does not release another worker’s SENDING claim', async () => {
    const { service, provider, prisma } = setup();
    service.registerDeliveryGuard('crm-sequence-step', async () => 'HOLD');
    await service.deliver('mail');
    expect(provider.send).not.toHaveBeenCalled();
    expect(prisma.emailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['QUEUED', 'FAILED'] } }),
        data: { status: 'QUEUED' },
      }),
    );
  });
  it('rechecks immediately before provider handoff and suppresses a withdrawn consent', async () => {
    const { service, provider, prisma } = setup();
    const guard = jest.fn().mockResolvedValueOnce('ALLOW').mockResolvedValueOnce('CANCEL');
    service.registerDeliveryGuard('crm-sequence-step', guard);
    await service.deliver('mail');
    expect(guard).toHaveBeenCalledTimes(2);
    expect(provider.send).not.toHaveBeenCalled();
    expect(prisma.emailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SENDING'] } }),
        data: {
          status: 'FAILED',
          nextAttemptAt: null,
          lastError: 'CANCELLED_BY_COMMUNICATION_GUARD',
        },
      }),
    );
  });
});
