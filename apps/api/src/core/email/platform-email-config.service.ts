import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PlatformEmailConfig } from '@pulsar/database';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { PlatformSmtpDto } from '../platform/dto/platform-services.dto';
import type { SmtpTransportOptions } from './email.service';

export type PlatformActor = { id: string; email: string };

/** Platform SMTP override. No row/ENVIRONMENT preserves the operator's env configuration. */
@Injectable()
export class PlatformEmailConfigService {
  constructor(
    private readonly db: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  project(c: PlatformEmailConfig | null) {
    return {
      mode: c?.mode ?? 'ENVIRONMENT',
      host: c?.host ?? '',
      port: c?.port ?? 587,
      secure: c?.secure ?? false,
      username: c?.username ?? '',
      fromName: c?.fromName ?? '',
      fromEmail: c?.fromEmail ?? '',
      replyTo: c?.replyTo ?? '',
      hasPassword: !!c?.passwordEnc,
      updatedAt: c?.updatedAt.toISOString() ?? null,
      lastTestAt: c?.lastTestAt?.toISOString() ?? null,
      lastTestOk: c?.lastTestOk ?? null,
    };
  }
  async get() {
    return this.project(await this.db.platformEmailConfig.findUnique({ where: { id: 'smtp' } }));
  }

  async save(actor: PlatformActor, dto: PlatformSmtpDto) {
    if (!dto.confirmed || dto.expectedUpdatedAt === undefined)
      throw new BadRequestException('Confirmez la portée et rechargez la configuration.');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-smtp', 0))`;
      const old = await tx.platformEmailConfig.findUnique({ where: { id: 'smtp' } });
      if ((old?.updatedAt.toISOString() ?? null) !== dto.expectedUpdatedAt)
        throw new ConflictException('La configuration a changé. Rechargez avant de sauvegarder.');
      const host = dto.host?.trim() || null,
        username = dto.username?.trim() || null;
      const changedIdentity = old?.host !== host || old?.username !== username;
      const passwordEnc = dto.password
        ? this.crypto.encryptString(dto.password)
        : changedIdentity
          ? null
          : (old?.passwordEnc ?? null);
      if (dto.mode === 'SMTP' && (!host || !dto.fromEmail || (username && !passwordEnc)))
        throw new BadRequestException(
          'SMTP réel exige un hôte, une adresse expéditeur et le secret du compte authentifié.',
        );
      const data = {
        mode: dto.mode,
        host,
        username,
        passwordEnc,
        port: dto.port,
        secure: dto.secure,
        fromName: dto.fromName?.trim() || null,
        fromEmail: dto.fromEmail || null,
        replyTo: dto.replyTo || null,
        lastTestAt: null,
        lastTestOk: null,
        updatedAt: new Date(Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1)),
      };
      const row = await tx.platformEmailConfig.upsert({
        where: { id: 'smtp' },
        create: { id: 'smtp', ...data },
        update: data,
      });
      await tx.platformServiceAudit.create({
        data: {
          actorId: actor.id,
          service: 'platform-email',
          action: 'CONFIGURE',
          detail: {
            previousMode: old?.mode ?? 'ENVIRONMENT',
            mode: row.mode,
            host,
            hasPassword: !!passwordEnc,
            identityChanged: changedIdentity,
          },
        },
      });
      return this.project(row);
    });
  }

  /** undefined = env; null = force simulation; object = captured real SMTP. Never exposed by HTTP. */
  async resolve(): Promise<SmtpTransportOptions | null | undefined> {
    const c = await this.db.platformEmailConfig.findUnique({ where: { id: 'smtp' } });
    if (!c || c.mode === 'ENVIRONMENT') return undefined;
    if (c.mode === 'SIMULATION') return null;
    if (c.mode !== 'SMTP' || !c.host || !c.fromEmail)
      throw new BadRequestException('Configuration SMTP plateforme incomplète.');
    return {
      host: c.host,
      port: c.port,
      secure: c.secure,
      requireTLS: !c.secure,
      user: c.username ?? undefined,
      pass: c.passwordEnc ? this.crypto.decryptString(c.passwordEnc) : undefined,
      from: c.fromName ? `${c.fromName} <${c.fromEmail}>` : c.fromEmail,
      replyTo: c.replyTo ?? undefined,
    };
  }

  /** Explicit authentication/TLS probe only: no message, no delivery claim, no raw provider error. */
  async verify(actor: PlatformActor, transport: SmtpTransportOptions | null, tenantId?: string) {
    if (!transport)
      return {
        ok: false,
        code: 'SIMULATION',
        message: 'Mode simulation : aucun serveur contacté, aucun courriel envoyé.',
      };
    const record = await this.db.platformServiceAudit.create({
      data: {
        actorId: actor.id,
        tenantId,
        service: tenantId ? 'tenant-email' : 'platform-email',
        action: 'VERIFY_STARTED',
        detail: { host: transport.host },
      },
    });
    const client = createTransport({
      host: transport.host,
      port: transport.port,
      secure: transport.secure,
      requireTLS: transport.requireTLS ?? !transport.secure,
      auth: transport.user ? { user: transport.user, pass: transport.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    let ok = false;
    try {
      await client.verify();
      ok = true;
    } catch {
      /* Provider errors can contain account details. */
    } finally {
      client.close();
    }
    await this.db.platformServiceAudit.create({
      data: {
        actorId: actor.id,
        tenantId,
        service: tenantId ? 'tenant-email' : 'platform-email',
        action: 'VERIFY_FINISHED',
        detail: { attemptId: record.id, ok },
      },
    });
    return {
      ok,
      code: ok ? 'CONNECTED' : 'CONNECTION_FAILED',
      message: ok
        ? 'Connexion SMTP et authentification vérifiées. Aucun courriel envoyé; livraison non vérifiée.'
        : 'Échec de connexion SMTP. Vérifiez hôte, port, TLS, accès réseau et identifiants.',
    };
  }
}
