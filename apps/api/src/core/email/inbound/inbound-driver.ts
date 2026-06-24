import type { ImapConfig } from '../email-config.service';

export interface RawInboundAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export interface RawInboundEmail {
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  receivedAt: Date;
  attachments: RawInboundAttachment[];
}

export interface InboundEmailDriver {
  /** Fetch unseen messages and mark them seen. Best-effort; throws on hard connection errors. */
  fetchNew(config: ImapConfig): Promise<RawInboundEmail[]>;
  testConnection(config: ImapConfig): Promise<{ ok: boolean; error?: string }>;
}

export const INBOUND_EMAIL_DRIVER = Symbol('INBOUND_EMAIL_DRIVER');
