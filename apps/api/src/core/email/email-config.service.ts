import { Inject, Injectable } from '@nestjs/common';
import type { TenantEmailConfig } from '@pulsar/database';
import { AuditAction } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailService, type SmtpTransportOptions } from './email.service';
import type { UpsertEmailConfigDto } from './dto/email-config.dto';
import { INBOUND_EMAIL_DRIVER, type InboundEmailDriver } from './inbound/inbound-driver';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

/** Public projection — NEVER includes passwordEnc or imapPasswordEnc. */
export interface EmailConfigProjection {
  id: string;
  tenantId: string;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  active: boolean;
  hasPassword: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  imapUsername: string | null;
  hasImapPassword: boolean;
  inboundActive: boolean;
  lastPollAt: Date | null;
  lastPollOk: boolean | null;
}

@Injectable()
export class EmailConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditLogsService,
    private readonly email: EmailService,
    @Inject(INBOUND_EMAIL_DRIVER) private readonly inboundDriver: InboundEmailDriver,
  ) {}

  /**
   * Public, password-free projection for API responses.
   * `hasPassword` signals whether an encrypted password is stored.
   */
  project(config: TenantEmailConfig): EmailConfigProjection {
    return {
      id: config.id,
      tenantId: config.tenantId,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      replyTo: config.replyTo,
      active: config.active,
      hasPassword: !!config.passwordEnc,
      lastTestAt: config.lastTestAt,
      lastTestOk: config.lastTestOk,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapSecure: config.imapSecure,
      imapUsername: config.imapUsername,
      hasImapPassword: !!config.imapPasswordEnc,
      inboundActive: config.inboundActive,
      lastPollAt: config.lastPollAt,
      lastPollOk: config.lastPollOk,
    };
  }

  /**
   * Returns the tenant's email config projection, or null if not yet configured.
   */
  async get(tenantId: string): Promise<EmailConfigProjection | null> {
    const config = await this.prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    return config ? this.project(config) : null;
  }

  /**
   * Creates or updates the tenant SMTP config. Encrypts `password` when provided;
   * preserves the existing `passwordEnc` when omitted (mirrors runtime-config pattern).
   * Audited.
   */
  async upsert(tenantId: string, dto: UpsertEmailConfigDto, userId?: string): Promise<EmailConfigProjection> {
    const hasPassword = typeof dto.password === 'string' && dto.password.length > 0;
    const passwordEnc = hasPassword ? this.crypto.encryptString(dto.password as string) : undefined;

    const hasImapPassword = typeof dto.imapPassword === 'string' && dto.imapPassword.length > 0;
    const imapPasswordEnc = hasImapPassword
      ? this.crypto.encryptString(dto.imapPassword as string)
      : undefined;

    const config = await this.prisma.tenantEmailConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...(dto.host !== undefined ? { host: dto.host } : {}),
        ...(dto.port !== undefined ? { port: dto.port } : {}),
        ...(dto.secure !== undefined ? { secure: dto.secure } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.fromName !== undefined ? { fromName: dto.fromName } : {}),
        ...(dto.fromEmail !== undefined ? { fromEmail: dto.fromEmail } : {}),
        ...(dto.replyTo !== undefined ? { replyTo: dto.replyTo } : {}),
        // Only set passwordEnc when a new password was supplied.
        ...(passwordEnc !== undefined ? { passwordEnc } : {}),
        ...(dto.imapHost !== undefined ? { imapHost: dto.imapHost } : {}),
        ...(dto.imapPort !== undefined ? { imapPort: dto.imapPort } : {}),
        ...(dto.imapSecure !== undefined ? { imapSecure: dto.imapSecure } : {}),
        ...(dto.imapUsername !== undefined ? { imapUsername: dto.imapUsername } : {}),
        ...(dto.inboundActive !== undefined ? { inboundActive: dto.inboundActive } : {}),
        ...(imapPasswordEnc !== undefined ? { imapPasswordEnc } : {}),
      },
      update: {
        ...(dto.host !== undefined ? { host: dto.host } : {}),
        ...(dto.port !== undefined ? { port: dto.port } : {}),
        ...(dto.secure !== undefined ? { secure: dto.secure } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.fromName !== undefined ? { fromName: dto.fromName } : {}),
        ...(dto.fromEmail !== undefined ? { fromEmail: dto.fromEmail } : {}),
        ...(dto.replyTo !== undefined ? { replyTo: dto.replyTo } : {}),
        // Preserve existing passwordEnc when no new password is supplied.
        ...(passwordEnc !== undefined ? { passwordEnc } : {}),
        ...(dto.imapHost !== undefined ? { imapHost: dto.imapHost } : {}),
        ...(dto.imapPort !== undefined ? { imapPort: dto.imapPort } : {}),
        ...(dto.imapSecure !== undefined ? { imapSecure: dto.imapSecure } : {}),
        ...(dto.imapUsername !== undefined ? { imapUsername: dto.imapUsername } : {}),
        ...(dto.inboundActive !== undefined ? { inboundActive: dto.inboundActive } : {}),
        ...(imapPasswordEnc !== undefined ? { imapPasswordEnc } : {}),
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'tenant-email-config',
      after: {
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        username: dto.username,
        fromEmail: dto.fromEmail,
        hasPassword: hasPassword || undefined,
      },
    });

    return this.project(config);
  }

  /**
   * Resolves the tenant config to `SmtpTransportOptions` for use as a per-call
   * transport in `EmailService.send`. Returns null when no config exists (caller
   * falls back to env-level driver).
   */
  async resolve(tenantId: string): Promise<SmtpTransportOptions | null> {
    const config = await this.prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    if (!config || !config.active || !config.host) return null;

    const pass = config.passwordEnc ? this.crypto.decryptString(config.passwordEnc) : undefined;
    const fromParts = [config.fromName, config.fromEmail ? `<${config.fromEmail}>` : undefined]
      .filter(Boolean)
      .join(' ');

    return {
      host: config.host,
      port: config.port ?? 587,
      secure: config.secure,
      user: config.username ?? undefined,
      pass,
      from: fromParts || undefined,
    };
  }

  /** Imap connection options for the inbound poller, or null when not configured/active. */
  async resolveInbound(tenantId: string): Promise<ImapConfig | null> {
    const config = await this.prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    if (!config || !config.inboundActive || !config.imapHost) return null;
    return {
      host: config.imapHost,
      port: config.imapPort ?? 993,
      secure: config.imapSecure,
      user: config.imapUsername ?? undefined,
      pass: config.imapPasswordEnc ? this.crypto.decryptString(config.imapPasswordEnc) : undefined,
    };
  }

  /** Calls the active inbound driver's testConnection. Updates lastPollAt/lastPollOk. */
  async testInbound(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    const config = await this.resolveInbound(tenantId);
    if (!config) return { ok: false, error: 'no active inbound config' };
    const result = await this.inboundDriver.testConnection(config);
    await this.prisma.tenantEmailConfig
      .update({ where: { tenantId }, data: { lastPollAt: new Date(), lastPollOk: result.ok } })
      .catch(() => undefined);
    return result;
  }

  /**
   * Sends a test email via the tenant SMTP config when one is configured, or
   * falls back to the env-level driver (e.g. log in dev/CI) when the tenant
   * has no active config. Updates `lastTestAt` and `lastTestOk` regardless of
   * outcome.
   */
  async sendTest(tenantId: string, to: string): Promise<{ ok: boolean }> {
    const transport = await this.resolve(tenantId);
    const ok = await this.email.send(
      {
        to,
        subject: 'Test Pulsar',
        html: '<p>Test de configuration email Pulsar. Si vous recevez ce message, la configuration est correcte.</p>',
      },
      transport ?? undefined,
    );

    // Persist the test result — best-effort, never throw.
    await this.prisma.tenantEmailConfig
      .upsert({
        where: { tenantId },
        create: { tenantId, lastTestAt: new Date(), lastTestOk: ok },
        update: { lastTestAt: new Date(), lastTestOk: ok },
      })
      .catch(() => undefined);

    return { ok };
  }
}
