import { Injectable, Logger } from '@nestjs/common';
import type { ImapConfig } from '../email-config.service';
import type { InboundEmailDriver, RawInboundEmail } from './inbound-driver';

/** Dev/CI driver: never polls a real server. Inbound arrives via the simulate endpoint. */
@Injectable()
export class LogInboundDriver implements InboundEmailDriver {
  private readonly logger = new Logger(LogInboundDriver.name);

  async fetchNew(_config: ImapConfig): Promise<RawInboundEmail[]> {
    return [];
  }

  async testConnection(_config: ImapConfig): Promise<{ ok: boolean; error?: string }> {
    this.logger.log('[inbound:log] testConnection → ok (log driver)');
    return { ok: true };
  }
}
