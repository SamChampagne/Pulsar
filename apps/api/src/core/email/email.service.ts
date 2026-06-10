import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email channel. Drivers (EMAIL_DRIVER):
 *  - "log" (default): writes the email to the application log — safe for dev/CI.
 *  - "smtp": real delivery through nodemailer (SMTP_* variables).
 * Callers treat sending as best-effort: a mail failure must never break the
 * business operation (same philosophy as audit logging).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: string;
  private readonly from: string;
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    this.driver = config.get<string>('EMAIL_DRIVER', 'log');
    this.from = config.get<string>('EMAIL_FROM', 'Pulsar <no-reply@pulsar.local>');
    if (this.driver === 'smtp') {
      this.transporter = createTransport({
        host: config.getOrThrow<string>('SMTP_HOST'),
        port: config.get<number>('SMTP_PORT', 587),
        secure: config.get<string>('SMTP_SECURE') === 'true',
        auth: config.get('SMTP_USER')
          ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
          : undefined,
      });
    }
  }

  /** Returns true when the email was handed to the driver successfully. */
  async send(email: OutgoingEmail): Promise<boolean> {
    try {
      if (this.transporter) {
        await this.transporter.sendMail({ from: this.from, ...email });
      } else {
        this.logger.log(`[email:log] to=${email.to} subject="${email.subject}"`);
      }
      return true;
    } catch (err) {
      this.logger.warn(`Email to ${email.to} failed: ${String(err)}`);
      return false;
    }
  }
}
