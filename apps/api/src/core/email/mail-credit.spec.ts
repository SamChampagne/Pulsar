import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { MailService } from './mail.service';
describe.each(['customer-credit', 'customer-invoice'])('%s PDF delivery safety', (kind) => {
  function setup(channel: 'smtp' | 'log' = 'smtp') {
    const bytes = Buffer.from('%PDF immutable proof');
    const msg = {
      id: 'mail',
      tenantId: 'tenant',
      status: 'QUEUED',
      relatedType: kind,
      relatedId: 'credit',
      deliveryChannel: channel,
      deliveryUncertain: false,
      attachments: [{ documentId: 'doc', filename: 'credit.pdf' }],
      toAddresses: ['client@example.test'],
      subject: 'Credit',
      html: 'Credit',
      text: 'Credit',
    };
    const db = {
      emailMessage: {
        findUnique: jest.fn(async () => msg),
        updateMany: jest.fn(async (args: any) => {
          Object.assign(msg, args.data);
          return { count: 1 };
        }),
        update: jest.fn(async (args: any) => Object.assign(msg, args.data)),
      },
      customerCreditNote: {
        findFirst: jest.fn(async () => ({
          documentId: 'doc',
          documentHash: createHash('sha256').update(bytes).digest('hex'),
        })),
      },
    };
    const extendedDb = { ...db, customerInvoice: db.customerCreditNote };
    const provider = { channel, send: jest.fn(async () => true) };
    const config = { resolve: jest.fn(async () => null as object | null) };
    const docs = { download: jest.fn(async () => ({ stream: Readable.from([bytes]) })) };
    const service = new MailService(
      extendedDb as never,
      provider as never,
      config as never,
      docs as never,
    );
    const guard = jest.fn(async () => 'ALLOW' as 'ALLOW' | 'HOLD' | 'CANCEL');
    service.registerDeliveryGuard(kind, guard);
    return { service, db, provider, docs, config, guard, msg };
  }
  it('attaches the exact PDF and does not resend a completed delivery', async () => {
    const { service, provider, msg, docs } = setup();
    await service.deliver('mail');
    await service.deliver('mail');
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0]).toEqual([
      expect.objectContaining({
        attachments: [{ filename: 'credit.pdf', content: Buffer.from('%PDF immutable proof') }],
      }),
      undefined,
    ]);
    expect(docs.download).toHaveBeenCalledWith('tenant', 'doc', `${kind}-pdf`);
    expect(msg).toMatchObject({ status: 'SENT', deliveryUncertain: false });
  });
  it('fails closed on a missing PDF, no attachment, wrong hash or absent credit', async () => {
    for (const issue of ['missing', 'empty', 'hash', 'note']) {
      const { service, provider, docs, db, msg } = setup();
      if (issue === 'missing') docs.download.mockRejectedValueOnce(new Error('Missing file'));
      if (issue === 'empty') msg.attachments = [];
      if (issue === 'hash')
        docs.download.mockResolvedValueOnce({ stream: Readable.from(['wrong']) });
      if (issue === 'note') db.customerCreditNote.findFirst.mockResolvedValueOnce(null as never);
      await service.deliver('mail');
      expect(provider.send).not.toHaveBeenCalled();
      expect(msg).toMatchObject({
        status: 'FAILED',
        deliveryUncertain: false,
        nextAttemptAt: null,
      });
    }
  });
  it('never upgrades a queued simulation to SMTP', async () => {
    const { service, provider, config, msg } = setup('log');
    config.resolve.mockResolvedValue({ host: 'smtp.example.test' });
    await service.deliver('mail');
    expect(provider.send).not.toHaveBeenCalled();
    expect(msg).toMatchObject({ status: 'FAILED', deliveryUncertain: false });
  });
  it('persists uncertainty before handoff and never retries an ambiguous provider result', async () => {
    const { service, provider, msg } = setup();
    provider.send.mockImplementation(async () => {
      expect(msg).toMatchObject({ status: 'SENDING', deliveryUncertain: true });
      return false;
    });
    await service.deliver('mail');
    await service.deliver('mail');
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(msg).toMatchObject({ status: 'FAILED', deliveryUncertain: true, nextAttemptAt: null });
  });
  it('does not resend after the provider succeeded but the SENT write failed', async () => {
    const { service, db, provider, msg } = setup();
    db.emailMessage.update.mockImplementation(async (args: any) => {
      if (args.data.status === 'SENT') throw new Error('Lost DB reply');
      return Object.assign(msg, args.data);
    });
    await service.deliver('mail');
    await service.deliver('mail');
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(msg).toMatchObject({ status: 'FAILED', deliveryUncertain: true });
  });
  it('rechecks module availability before handoff and respects another worker claim', async () => {
    const { service, guard, provider, db } = setup();
    guard.mockResolvedValueOnce('ALLOW').mockResolvedValueOnce('CANCEL');
    await service.deliver('mail');
    expect(provider.send).not.toHaveBeenCalled();
    const other = setup();
    other.db.emailMessage.updateMany.mockResolvedValueOnce({ count: 0 });
    await other.service.deliver('mail');
    expect(other.provider.send).not.toHaveBeenCalled();
    expect(other.db.emailMessage.update).not.toHaveBeenCalled();
    expect(db.emailMessage.updateMany).toHaveBeenCalled();
  });
  it('rejects a forged generic compose request before persistence', async () => {
    const { service, db } = setup();
    await expect(
      service.queue('tenant', {
        relatedType: kind,
        toAddresses: ['x@example.test'],
        subject: 'x',
        html: 'x',
      }),
    ).rejects.toThrow('Facturation');
    expect(db.emailMessage.findUnique).not.toHaveBeenCalled();
  });
  if (kind === 'customer-invoice')
    it('holds legacy invoices without a reviewed channel and never retries them', async () => {
      const { service, msg, provider } = setup();
      msg.deliveryChannel = null as never;
      await service.deliver('mail');
      await service.deliver('mail');
      expect(provider.send).not.toHaveBeenCalled();
      expect(msg).toMatchObject({
        status: 'FAILED',
        nextAttemptAt: null,
        lastError: 'INVOICE_LEGACY_REVIEW_REQUIRED',
      });
    });
});
