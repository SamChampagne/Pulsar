import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PortalJwtPayload, PortalLoginResponse, PortalUserRole } from '@pulsar/shared';
import { MODULE_KEYS, PortalActionTokenKind, PortalUserStatus } from '@pulsar/shared';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { EmailConfigService } from '../../../core/email/email-config.service';
import { EmailService } from '../../../core/email/email.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Portal access tokens live 8h; the pair rotates through a 30-day refresh token. */
const ACCESS_TTL = '8h';
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;
/** Same generic answer for unknown email / wrong password / non-ACTIVE account. */
const GENERIC_CREDENTIALS = 'Invalid credentials';
/** Same wording as PortalGuard so a caller cannot tell the two checks apart. */
const MODULE_DISABLED = 'The customer portal is not enabled for this shipper';

interface PortalLoginInput {
  email: string;
  password: string;
  tenant?: string;
}

/**
 * Authentication service of the third plane (customer-portal accounts).
 * Mirrors `core/auth/auth.service.ts`: a single issuance chokepoint
 * (`issuePortalSession`) re-gates every session whatever the caller checked,
 * refresh tokens are stored as sha256 hashes and rotate on use, and the
 * password-reset endpoints never disclose whether an account exists.
 */
@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly emailConfig: EmailConfigService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  private webUrl(): string {
    return this.config.get('WEB_URL', 'http://localhost:5173') as string;
  }

  /**
   * Password login. The tenant slug is optional; it is only required when the
   * same email is a portal account in more than one shipper's tenant (portal
   * emails are unique per tenant, not globally).
   */
  async login(dto: PortalLoginInput): Promise<PortalLoginResponse> {
    const email = dto.email.toLowerCase();
    const candidates = await this.prisma.portalUser.findMany({
      where: {
        email,
        ...(dto.tenant ? { tenant: { slug: dto.tenant } } : {}),
      },
      select: { id: true, passwordHash: true, status: true },
    });
    if (candidates.length === 0) {
      throw new UnauthorizedException(GENERIC_CREDENTIALS);
    }
    if (candidates.length > 1) {
      // Disambiguation is required before any credential check: we cannot know
      // which account the password belongs to.
      throw new BadRequestException('tenant required');
    }

    const candidate = candidates[0];
    const passwordOk = await compare(dto.password, candidate.passwordHash);
    // Status is checked after the password so a wrong password and a disabled
    // account are indistinguishable from the outside.
    if (!passwordOk || candidate.status !== PortalUserStatus.ACTIVE) {
      throw new UnauthorizedException(GENERIC_CREDENTIALS);
    }

    await this.prisma.portalUser.update({
      where: { id: candidate.id },
      data: { lastLoginAt: new Date() },
    });
    return this.issuePortalSession(candidate.id);
  }

  /**
   * Single session-issuance path (access token + rotating refresh token).
   * Every caller — password login, refresh, activation — goes through these
   * gates: account ACTIVE, customer company active, tenant not suspended, and
   * the CUSTOMER_PORTAL module still enabled (rule 15, the portal routes are
   * `@Public()` and bypass ModulesGuard).
   */
  async issuePortalSession(portalUserId: string): Promise<PortalLoginResponse> {
    const user = await this.prisma.portalUser.findUnique({
      where: { id: portalUserId },
      include: {
        customer: { select: { id: true, name: true, isActive: true } },
        tenant: { select: { id: true, name: true, status: true, settings: true } },
      },
    });
    if (!user || user.status !== PortalUserStatus.ACTIVE) {
      throw new UnauthorizedException('Portal account is not active');
    }
    if (!user.customer?.isActive) {
      throw new UnauthorizedException('Portal account is not active');
    }
    if (user.tenant.status === 'SUSPENDED') {
      throw new UnauthorizedException('Tenant is suspended');
    }
    const enabled = await this.modulesCache.getEnabledKeys(user.tenantId);
    if (!enabled.has(MODULE_KEYS.CUSTOMER_PORTAL)) {
      throw new ForbiddenException(MODULE_DISABLED);
    }

    const payload: PortalJwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      customerId: user.customerId,
      email: user.email,
      role: user.role as PortalUserRole,
      portal: true,
    };

    // Opaque and long; only its hash is stored, so a database read never yields
    // a usable token.
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.portalRefreshToken.create({
      data: {
        portalUserId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });

    const branding = ((user.tenant.settings as Record<string, unknown> | null)?.branding ??
      {}) as Record<string, unknown>;

    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: ACCESS_TTL }),
      refreshToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        customerId: user.customerId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role as PortalUserRole,
      },
      customer: { id: user.customer.id, name: user.customer.name },
      shipper: { name: user.tenant.name },
      // Explicit projection: `settings` is free-form JSON and must not be echoed.
      branding: {
        logoUrl: typeof branding.logoUrl === 'string' ? branding.logoUrl : undefined,
        accentColor: typeof branding.accentColor === 'string' ? branding.accentColor : undefined,
      },
    };
  }

  /** Rotates a refresh token: the presented one is revoked and a fresh pair issued. */
  async refresh(refreshToken: string): Promise<PortalLoginResponse> {
    const record = await this.prisma.portalRefreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Revoked before re-issuing: a replayed token can never mint a second pair,
    // and a rotation that then fails the gates leaves nothing usable behind.
    await this.prisma.portalRefreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issuePortalSession(record.portalUserId);
  }

  async logout(refreshToken: string): Promise<{ loggedOut: boolean }> {
    await this.prisma.portalRefreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Always the same answer: logging out an unknown token must not confirm it.
    return { loggedOut: true };
  }

  /**
   * Starts a password reset. Always resolves to a generic acknowledgement so
   * the endpoint cannot be used to enumerate portal accounts.
   */
  async requestPasswordReset(email: string, tenantSlug?: string): Promise<{ ok: boolean }> {
    const user = await this.prisma.portalUser.findFirst({
      where: {
        email: email.toLowerCase(),
        // INVITED accounts recover through their invitation link, DISABLED ones
        // must not be reachable at all.
        status: PortalUserStatus.ACTIVE,
        ...(tenantSlug ? { tenant: { slug: tenantSlug } } : {}),
      },
      select: { id: true, email: true, firstName: true, tenantId: true },
    });
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.portalActionToken.create({
        data: {
          portalUserId: user.id,
          kind: PortalActionTokenKind.PASSWORD_RESET,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      });
      const url = `${this.webUrl()}/portal/reset/${token}`;
      // Deliberately the low-level EmailService, NOT the MailService outbox
      // (same reasoning as core/auth/auth.service.ts): the outbox is readable by
      // the shipper's staff, and a live reset link is a credential — it must
      // never be stored where anyone but the recipient can replay it.
      // Invitations stay on the outbox: their link is legitimately staff-visible.
      const transport = await this.emailConfig.resolve(user.tenantId);
      await this.email
        .send(
          {
            to: user.email,
            subject: 'Réinitialisation de votre mot de passe',
            html: `<p>Bonjour ${user.firstName},</p><p>Pour choisir un nouveau mot de passe, suivez ce lien : <a href="${url}">${url}</a></p><p>Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`,
            text: `Réinitialisez votre mot de passe : ${url} (ce lien expire dans 1 heure)`,
          },
          transport ?? undefined,
        )
        .catch(() => undefined);
    }
    return { ok: true };
  }

  /**
   * Consumes an INVITATION or PASSWORD_RESET token and sets the new password.
   * Also activates the account (this is how an invited user gets in) and
   * revokes every live session of the (possibly compromised) account.
   */
  async resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
    const record = await this.prisma.portalActionToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    // A deactivated account must never be resurrected through a link issued
    // before it was disabled — checked before any write.
    const owner = await this.prisma.portalUser.findUnique({
      where: { id: record.portalUserId },
      select: { status: true },
    });
    if (!owner || owner.status === PortalUserStatus.DISABLED) {
      throw new BadRequestException('Account is disabled');
    }

    const passwordHash = await hash(password, 10);
    await this.prisma.$transaction(async (tx) => {
      // Conditional claim: two concurrent redemptions of the same link cannot
      // both succeed (single use).
      const claimed = await tx.portalActionToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new UnauthorizedException('Invalid or expired link');
      }
      // Conditional write, not a blind update: the status read above is a
      // snapshot, so a deactivate landing between the two would otherwise be
      // overwritten and the account resurrected (TOCTOU). A rejected claim
      // rolls the token consumption back with the transaction.
      const activated = await tx.portalUser.updateMany({
        where: { id: record.portalUserId, status: { not: PortalUserStatus.DISABLED } },
        data: { passwordHash, status: PortalUserStatus.ACTIVE },
      });
      if (activated.count === 0) {
        throw new BadRequestException('Account is disabled');
      }
      await tx.portalRefreshToken.updateMany({
        where: { portalUserId: record.portalUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { ok: true };
  }
}
