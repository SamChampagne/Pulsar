// apps/api/src/core/email/inbound/inbound-ingest.service.spec.ts
import { InboundIngestService } from './inbound-ingest.service';
import { EmailDirection } from '@pulsar/shared';

function rawEmail(overrides: Partial<any> = {}) {
  return {
    from: 'jane@acme.test',
    fromName: 'Jane',
    to: ['sales@us.test'],
    subject: 'Re: Quote',
    html: '<p>hi</p>',
    text: 'hi',
    messageId: '<m1@acme>',
    references: [],
    receivedAt: new Date('2026-06-24T00:00:00Z'),
    attachments: [],
    ...overrides,
  };
}

describe('InboundIngestService', () => {
  it('dedupes on an existing messageId', async () => {
    const prisma: any = {
      emailMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'x', threadId: 't' }) },
    };
    const svc = new InboundIngestService(prisma, {} as any, {} as any, {} as any);
    const r = await svc.ingest('tenant1', rawEmail());
    expect(r.deduped).toBe(true);
  });

  it('creates an UNLINKED thread for an unknown sender', async () => {
    const created: any = {};
    const tx: any = {
      emailThread: { create: jest.fn().mockResolvedValue({ id: 'thr1' }), update: jest.fn() },
      emailMessage: { create: jest.fn().mockResolvedValue({ id: 'msg1' }) },
    };
    const prisma: any = {
      emailMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      crmContact: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const audit: any = { log: jest.fn() };
    const events: any = { emit: jest.fn() };
    const docs: any = { upload: jest.fn() };
    const svc = new InboundIngestService(prisma, docs, audit, events);
    const r = await svc.ingest('tenant1', rawEmail({ references: [], inReplyTo: undefined }));
    expect(r.deduped).toBe(false);
    expect(tx.emailThread.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'UNLINKED' }) }),
    );
    expect(tx.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ direction: EmailDirection.INBOUND }) }),
    );
  });
});
