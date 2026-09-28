import { Injectable } from '@nestjs/common';
import type { ImapConfig } from '../email-config.service';
import { ImapPollDriver } from './imap-poll.driver';
import { LogInboundDriver } from './log-inbound.driver';
import type { InboundEmailDriver } from './inbound-driver';

/** Explicit, per-tenant mode. Missing/new modes never enable external reads. */
@Injectable()
export class TenantInboundDriver implements InboundEmailDriver {
  constructor(
    private readonly log: LogInboundDriver,
    private readonly imap: ImapPollDriver,
  ) {}
  fetchNew(config: ImapConfig) {
    return (config.live === true ? this.imap : this.log).fetchNew(config);
  }
  testConnection(config: ImapConfig) {
    return (config.live === true ? this.imap : this.log).testConnection(config);
  }
}
