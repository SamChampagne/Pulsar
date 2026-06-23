import { Injectable } from '@nestjs/common';
import type { TenantEmailConfig } from '@pulsar/database';
import { AuditAction } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailService, type SmtpTransportOptions } from './email.service';
import type { UpsertEmailConfigDto } from './dto/email-config.dto';

/** Public projection — NEVER includes passwordEnc. */
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
}

@Injectable()
export class EmailConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditLogsService,
    private readonly email: EmailService,
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
