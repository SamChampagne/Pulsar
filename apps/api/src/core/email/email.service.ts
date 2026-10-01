import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { PlatformEmailConfigService } from './platform-email-config.service';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  replyTo?: string;
  from?: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Nodemailer reads these keys directly when spread into sendMail. */
  messageId?: string;
  headers?: Record<string, string>;
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  replyTo?: string;
}

/**
 * Email channel. Drivers (EMAIL_DRIVER):
 *  - "log" (default): writes the email to the application log — safe for dev/CI.
 *  - "smtp": real delivery through nodemailer (SMTP_* variables).
 * Callers treat sending as best-effort: a mail failure must never break the
 * business operation (same philosophy as audit logging).
 *
 * An optional per-call `transport` can be supplied (e.g. from a tenant's stored
 * SMTP config). When given, a one-off transporter is built and used for that
 * single send. Explicit null pins simulation. Otherwise the platform DB setting
 * is resolved, then the legacy environment only when no override is configured.
 * A settings read/decryption failure never silently selects another transport.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: string;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly platform?: PlatformEmailConfigService,
  ) {
    this.driver = config.get<string>('EMAIL_DRIVER', 'log');
    this.from = config.get<string>('EMAIL_FROM', 'Pulsar <no-reply@pulsar.local>');
  }

  /** Capture once before a governed send. null intentionally pins simulation. */
  async captureTransport(): Promise<SmtpTransportOptions | null> {
    const configured = await this.platform?.resolve();
    if (configured !== undefined) return configured;
    if (this.driver !== 'smtp') return null;
    return {
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.config.get('SMTP_PORT', 587)),
      secure: this.config.get('SMTP_SECURE') === 'true',
      user: this.config.get('SMTP_USER'),
      pass: this.config.get('SMTP_PASS'),
      from: this.from,
    };
  }

  async effectiveChannel(): Promise<'smtp' | 'log'> {
    return (await this.captureTransport()) ? 'smtp' : 'log';
  }

  async send(email: OutgoingEmail, transport?: SmtpTransportOptions | null): Promise<boolean> {
    try {
      if (transport === undefined) transport = await this.captureTransport();
      if (transport) {
        // Per-call one-off transporter (e.g. tenant SMTP config).
        const oneOff = createTransport({
          host: transport.host,
          port: transport.port,
          secure: transport.secure,
          ...(transport.requireTLS !== undefined ? { requireTLS: transport.requireTLS } : {}),
          auth: transport.user ? { user: transport.user, pass: transport.pass } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 30_000,
        });
        const from = email.from ?? transport.from ?? this.from;
        try {
          await oneOff.sendMail({ ...email, from, replyTo: email.replyTo ?? transport.replyTo });
        } finally {
          oneOff.close();
        }
      } else {
        this.logger.log(`[email:log] to=${email.to} subject="${email.subject}"`);
      }
      return true;
    } catch (err) {
      this.logger.warn('Email delivery failed; inspect the configured connection.');
      return false;
    }
  }
}
