import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoginResponse } from '@pulsar/shared';
import { AuditAction } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { generators, Issuer } from 'openid-client';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { packOidcState, unpackOidcState } from './oidc-state';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const MASK = '***';

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** Encrypted (enc:v1) at rest; plaintext or '***' mask on the wire. */
  clientSecret: string;
  defaultRoleId: string;
}

export interface OidcClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
}

@Injectable()
export class OidcService {
  private readonly issuerCache = new Map<string, { issuer: Issuer; fetchedAt: number }>();
  private static readonly ISSUER_TTL_MS = 60 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly audit: AuditLogsService,
  ) {}

  // --- Tenant admin config ---------------------------------------------------

  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const stored = tenant.authConfig as OidcConfig | null;
    if (!stored)
      return { enabled: false, issuer: '', clientId: '', clientSecret: '', defaultRoleId: '' };
    return { ...stored, clientSecret: stored.clientSecret ? MASK : '' };
  }

  async putConfig(tenantId: string, userId: string, input: OidcConfig) {
    const role = await this.prisma.role.findFirst({
      where: { id: input.defaultRoleId, tenantId },
    });
    if (!role) throw new BadRequestException('defaultRoleId does not belong to this tenant');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const stored = tenant.authConfig as OidcConfig | null;
    const clientSecret =
      input.clientSecret === MASK && stored
        ? stored.clientSecret // client echoed the mask: keep the stored secret
        : this.crypto.encryptString(input.clientSecret);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { authConfig: { ...input, clientSecret } },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'oidc-config',
      entityId: tenantId,
      // Never the secret — only whether it changed.
      before: stored
        ? { enabled: stored.enabled, issuer: stored.issuer, clientId: stored.clientId }
        : undefined,
      after: {
        enabled: input.enabled,
        issuer: input.issuer,
        clientId: input.clientId,
        defaultRoleId: input.defaultRoleId,
        clientSecretChanged: input.clientSecret !== MASK,
      },
    });
    return this.getConfig(tenantId);
  }

  // --- Flow --------------------------------------------------------------------

  private async tenantWithOidc(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    const config = tenant?.authConfig as OidcConfig | null;
    if (!tenant || tenant.status === 'SUSPENDED' || !config?.enabled) {
      throw new NotFoundException('SSO is not enabled for this organization');
    }
    return { tenant, config };
  }

  private async discoverIssuer(url: string, forceRefresh = false): Promise<Issuer> {
    const cached = this.issuerCache.get(url);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < OidcService.ISSUER_TTL_MS) {
      return cached.issuer;
    }
    const issuer = await Issuer.discover(url);
    this.issuerCache.set(url, { issuer, fetchedAt: Date.now() });
    return issuer;
  }

  private async clientFor(config: OidcConfig, slug: string, forceRefresh = false) {
    const issuer = await this.discoverIssuer(config.issuer, forceRefresh);
    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    return new issuer.Client({
      client_id: config.clientId,
      client_secret: this.crypto.decryptString(config.clientSecret),
      redirect_uris: [`${apiUrl}/api/v1/auth/oidc/${slug}/callback`],
      response_types: ['code'],
    });
  }

  /** Step 1: build the IdP authorization URL (PKCE + nonce inside encrypted state). */
  async start(slug: string): Promise<string> {
    const { config } = await this.tenantWithOidc(slug);
    const client = await this.clientFor(config, slug);
    const verifier = generators.codeVerifier();
    const nonce = generators.nonce();
    return client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: generators.codeChallenge(verifier),
      code_challenge_method: 'S256',
      nonce,
      state: packOidcState(this.crypto, { verifier, nonce, issuedAt: Date.now(), tenantSlug: slug }),
    });
  }

  /** Step 2: IdP callback — exchange the code, resolve the user, mint a one-shot exchange code. */
  async callback(slug: string, params: Record<string, string>): Promise<string> {
    const { tenant, config } = await this.tenantWithOidc(slug);
    const state = unpackOidcState(this.crypto, params.state ?? '');
    if (state.tenantSlug !== slug) {
      throw new UnauthorizedException('OIDC state does not belong to this organization');
    }
    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    const redirectUri = `${apiUrl}/api/v1/auth/oidc/${slug}/callback`;
    const callbackChecks = { state: params.state, nonce: state.nonce, code_verifier: state.verifier };

    let tokenSet;
    try {
      const client = await this.clientFor(config, slug);
      tokenSet = await client.callback(redirectUri, params, callbackChecks);
    } catch (err) {
      // openid-client OP errors carry an OAuth `error` code (invalid_grant, invalid_client…):
      // those are real auth failures — retrying with a fresh discovery cannot fix them.
      // Only transport/discovery-level failures (no error code) warrant the one retry.
      if ((err as { error?: string }).error) throw err;
      const freshClient = await this.clientFor(config, slug, true);
      tokenSet = await freshClient.callback(redirectUri, params, callbackChecks);
    }
    const claims = tokenSet.claims() as OidcClaims;
    if (!claims.email) throw new UnauthorizedException('IdP did not provide an email claim');

    const { user, provisioned } = await this.prisma.$transaction(async (tx) =>
      this.lookupOrProvision(tx as never, tenant.id, claims, config.defaultRoleId),
    );

    const code = randomBytes(32).toString('base64url');
    await this.prisma.userActionToken.create({
      data: {
        userId: user.id,
        kind: 'OIDC_EXCHANGE',
        tokenHash: sha256(code),
        expiresAt: new Date(Date.now() + 60_000), // one-shot, 60 s
      },
    });
    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: user.id,
      after: { method: 'oidc', provisioned },
    });
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    return `${webUrl}/oidc/complete?code=${code}`;
  }

  /** Step 3: the SPA trades the one-shot code for the standard session pair. */
  async exchange(code: string): Promise<LoginResponse> {
    const tokenHash = sha256(code);
    // Atomic one-shot claim: the conditional UPDATE is the uniqueness guarantee.
    // A read-then-write pair would let two concurrent exchanges both pass the
    // usedAt check; here only one request can match usedAt: null.
    const claimed = await this.prisma.userActionToken.updateMany({
      where: { tokenHash, kind: 'OIDC_EXCHANGE', usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired exchange code');
    }
    const record = await this.prisma.userActionToken.findUniqueOrThrow({ where: { tokenHash } });
    return this.auth.issueSession(record.userId);
  }

  // --- User resolution (unit-tested) -------------------------------------------

  /** sub first; email fallback binds the sub; otherwise provision ACTIVE + default role. */
  async lookupOrProvision(
    tx: Pick<PrismaService, 'user'>,
    tenantId: string,
    claims: OidcClaims,
    defaultRoleId: string,
  ): Promise<{ user: { id: string }; provisioned: boolean }> {
    const bySub = await tx.user.findFirst({
      where: { tenantId, oidcSubject: claims.sub },
    });
    if (bySub) {
      if (bySub.status === 'DISABLED') throw new UnauthorizedException('Account is disabled');
      return { user: bySub, provisioned: false };
    }
    // The email claim is only trusted as a BINDING key when the IdP asserts it
    // verified (absent claim = legacy IdP, accepted; explicit false = refused —
    // an attacker-set unverified email must not capture an existing account).
    const emailTrustedForBinding = claims.email_verified !== false;
    const byEmail =
      claims.email && emailTrustedForBinding
        ? await tx.user.findFirst({ where: { tenantId, email: claims.email.toLowerCase() } })
        : null;
    if (byEmail) {
      if (byEmail.status === 'DISABLED') throw new UnauthorizedException('Account is disabled');
      const bound = await tx.user.update({
        where: { id: byEmail.id },
        data: { oidcSubject: claims.sub, status: 'ACTIVE' },
      });
      return { user: bound, provisioned: false };
    }
    const created = await tx.user.create({
      data: {
        tenantId,
        email: claims.email!.toLowerCase(),
        oidcSubject: claims.sub,
        passwordHash: await hash(randomBytes(32).toString('hex'), 10),
        firstName: claims.given_name ?? '',
        lastName: claims.family_name ?? '',
        status: 'ACTIVE',
        roles: { create: [{ roleId: defaultRoleId }] },
      },
    });
    return { user: created, provisioned: true };
  }
}
