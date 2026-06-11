import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  PlatformJwtPayload,
  PlatformLoginResponse,
  PlatformStepTokenPayload,
} from '@pulsar/shared';
import { compare } from 'bcryptjs';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformMfaService } from './platform-mfa.service';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly mfa: PlatformMfaService,
  ) {}

  async login(email: string, password: string): Promise<PlatformLoginResponse> {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || user.status !== 'ACTIVE' || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // User already has MFA enabled → issue a step token; access waits for the second factor.
    if (user.mfaEnabledAt) {
      const stepPayload: PlatformStepTokenPayload = {
        sub: user.id,
        email: user.email,
        scope: 'mfa-pending',
      };
      const mfaToken = await this.jwt.signAsync(stepPayload, { expiresIn: '5m' });
      return { mfaRequired: true, mfaToken };
    }

    // MFA not enrolled — check enforcement policy.
    if (this.config.get('PLATFORM_MFA_ENFORCED') === 'true') {
      const { secret, otpauthUrl } = this.mfa.beginEnrollment(user.email);
      const enrollPayload: PlatformStepTokenPayload = {
        sub: user.id,
        email: user.email,
        scope: 'mfa-enroll',
        secretEnc: this.crypto.encryptString(secret),
      };
      const enrollToken = await this.jwt.signAsync(enrollPayload, { expiresIn: '10m' });
      return { mfaEnrollmentRequired: true, enrollToken, otpauthUrl };
    }

    // Normal login — no MFA.
    return this.issueAccessToken(user.id, user.email, user.firstName, user.lastName);
  }

  /**
   * Complete mandatory enrollment from the login flow.
   * enrollToken must have scope 'mfa-enroll'; code confirms the secret.
   */
  async enroll(
    enrollToken: string,
    code: string,
  ): Promise<{ recoveryCodes: string[]; accessToken: string }> {
    let payload: PlatformStepTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformStepTokenPayload>(enrollToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired enrollment token');
    }
    if (payload.scope !== 'mfa-enroll' || !payload.secretEnc) {
      throw new UnauthorizedException('Invalid enrollment token scope');
    }
    const secret = this.crypto.decryptString(payload.secretEnc);
    const recoveryCodes = await this.mfa.activate(payload.sub, secret, code);

    // Enrollment done — update lastLoginAt and issue the full access token.
    await this.prisma.platformUser.update({
      where: { id: payload.sub },
      data: { lastLoginAt: new Date() },
    });
    const user = await this.prisma.platformUser.findUniqueOrThrow({
      where: { id: payload.sub },
    });
    const { accessToken } = await this.issueAccessToken(
      user.id,
      user.email,
      user.firstName,
      user.lastName,
    );
    return { recoveryCodes, accessToken };
  }

  /**
   * Completes the MFA login step when the account already has TOTP enabled.
   * mfaToken must have scope 'mfa-pending'.
   */
  async verifyMfa(
    mfaToken: string,
    code: string,
  ): Promise<{ accessToken: string; user: { id: string; email: string; firstName: string; lastName: string } }> {
    let payload: PlatformStepTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformStepTokenPayload>(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
    if (payload.scope !== 'mfa-pending') {
      throw new UnauthorizedException('Invalid MFA token scope');
    }
    const valid = await this.mfa.verifySecondFactor(payload.sub, code);
    if (!valid) {
      throw new UnauthorizedException('Invalid second factor');
    }
    await this.prisma.platformUser.update({
      where: { id: payload.sub },
      data: { lastLoginAt: new Date() },
    });
    const user = await this.prisma.platformUser.findUniqueOrThrow({
      where: { id: payload.sub },
    });
    return this.issueAccessToken(user.id, user.email, user.firstName, user.lastName);
  }

  /**
   * Authenticated endpoint: start MFA enrollment for an already-logged-in platform admin.
   * Returns the enrollToken + otpauthUrl; the admin calls POST mfa/enroll to confirm.
   */
  async enrollStart(
    userId: string,
    email: string,
  ): Promise<{ enrollToken: string; otpauthUrl: string }> {
    const user = await this.prisma.platformUser.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt) {
      throw new BadRequestException('MFA is already enabled for this account');
    }
    const { secret, otpauthUrl } = this.mfa.beginEnrollment(email);
    const enrollPayload: PlatformStepTokenPayload = {
      sub: userId,
      email,
      scope: 'mfa-enroll',
      secretEnc: this.crypto.encryptString(secret),
    };
    const enrollToken = await this.jwt.signAsync(enrollPayload, { expiresIn: '10m' });
    return { enrollToken, otpauthUrl };
  }

  private async issueAccessToken(
    id: string,
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<{ accessToken: string; user: { id: string; email: string; firstName: string; lastName: string } }> {
    await this.prisma.platformUser.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
    const jwtPayload: PlatformJwtPayload = { sub: id, email, platformAdmin: true };
    return {
      accessToken: await this.jwt.signAsync(jwtPayload, { expiresIn: '12h' }),
      user: { id, email, firstName, lastName },
    };
  }
}
