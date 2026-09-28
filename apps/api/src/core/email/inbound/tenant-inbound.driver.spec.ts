import { TenantInboundDriver } from './tenant-inbound.driver';
import { LogInboundDriver } from './log-inbound.driver';
import { ImapPollDriver } from './imap-poll.driver';
describe('Per-tenant inbound driver', () => {
  it('never contacts IMAP without an explicit live mode, independently of server defaults', async () => {
    const log = {
      fetchNew: jest.fn(async () => []),
      testConnection: jest.fn(async () => ({ ok: true })),
    };
    const imap = {
      fetchNew: jest.fn(async () => []),
      testConnection: jest.fn(async () => ({ ok: true })),
    };
    const driver = new TenantInboundDriver(
      log as unknown as LogInboundDriver,
      imap as unknown as ImapPollDriver,
    );
    const config = { host: 'imap.example.test', port: 993, secure: true };
    await driver.fetchNew(config);
    await driver.testConnection({ ...config, live: false });
    expect(imap.fetchNew).not.toHaveBeenCalled();
    expect(imap.testConnection).not.toHaveBeenCalled();
    await driver.fetchNew({ ...config, live: true });
    await driver.testConnection({ ...config, live: true });
    expect(imap.fetchNew).toHaveBeenCalledTimes(1);
    expect(imap.testConnection).toHaveBeenCalledTimes(1);
  });
});
