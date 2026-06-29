import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { ImapConfig } from '../email-config.service';
import type { InboundEmailDriver, RawInboundEmail } from './inbound-driver';

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_PER_POLL = 25;

@Injectable()
export class ImapPollDriver implements InboundEmailDriver {
  private readonly logger = new Logger(ImapPollDriver.name);

  private client(config: ImapConfig): ImapFlow {
    return new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user ?? '', pass: config.pass ?? '' },
      logger: false,
      socketTimeout: CONNECT_TIMEOUT_MS,
    });
  }

  async fetchNew(config: ImapConfig): Promise<RawInboundEmail[]> {
    const client = this.client(config);
    const out: RawInboundEmail[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        // search() returns number[] | false; use || to handle false as well as null/undefined
        const slice = (uids || []).slice(0, MAX_PER_POLL);
        for (const uid of slice) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          out.push(toRaw(parsed));
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }

  async testConnection(config: ImapConfig): Promise<{ ok: boolean; error?: string }> {
    const client = this.client(config);
    try {
      await client.connect();
      await client.logout().catch(() => undefined);
      return { ok: true };
    } catch (err) {
      this.logger.warn(`IMAP testConnection failed: ${String(err)}`);
      return { ok: false, error: String(err).slice(0, 200) };
    }
  }
}

// mailparser ParsedMail → RawInboundEmail
function toRaw(parsed: import('mailparser').ParsedMail): RawInboundEmail {
  const fromAddr = parsed.from?.value?.[0];
  const toList = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
  const toAddresses = toList.flatMap((t) => t.value.map((v) => v.address ?? '').filter(Boolean));
  const refs = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];
  return {
    from: fromAddr?.address ?? '',
    fromName: fromAddr?.name || undefined,
    to: toAddresses,
    subject: parsed.subject ?? '(no subject)',
    html:
      typeof parsed.html === 'string'
        ? parsed.html
        : parsed.textAsHtml ?? `<p>${parsed.text ?? ''}</p>`,
    text: parsed.text ?? undefined,
    messageId: parsed.messageId ?? `<generated-${Date.now()}@pulsar.local>`,
    inReplyTo: parsed.inReplyTo ?? undefined,
    references: refs,
    receivedAt: parsed.date ?? new Date(),
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      content: a.content as Buffer,
      mimeType: a.contentType ?? 'application/octet-stream',
    })),
  };
}
