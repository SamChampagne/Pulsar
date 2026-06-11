import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformMfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  verifyTotp(secret: string, code: string): boolean {
    // RFC 6238; otplib's default window tolerates ±1 step of clock skew.
    return authenticator.verify({ token: code, secret });
  }

  generateRecoveryCodes(): string[] {
    return Array.from({ length: 8 }, () =>
      randomBytes(10)
        .toString('base64url')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .padEnd(10, '0')
        .slice(0, 10),
    );
  }

  /** Generates a secret + otpauth URI for the enrollment screen. Nothing persisted yet. */
  beginEnrollment(email: string): { secret: string; otpauthUrl: string } {
    const secret = authenticator.generateSecret();
    return { secret, otpauthUrl: authenticator.keyuri(email, 'Pulsar Platform', secret) };
  }

  /** Activates MFA: stores the encrypted secret + hashed one-time recovery codes. */
  async activate(userId: string, secret: string, firstCode: string): Promise<string[]> {
    if (!this.verifyTotp(secret, firstCode)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    const recoveryCodes = this.generateRecoveryCodes();
    const hashed = await Promise.all(recoveryCodes.map((c) => hash(c, 10)));
    await this.prisma.platformUser.update({
      where: { id: userId },
      data: {
        totpSecret: this.crypto.encryptString(secret),
        mfaEnabledAt: new Date(),
        recoveryCodes: hashed,
      },
    });
    return recoveryCodes; // Returned ONCE — never retrievable again.
  }

  /** Second factor check: TOTP first, else a recovery code (consumed on use). */
  async verifySecondFactor(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.platformUser.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) return false;
    if (this.verifyTotp(this.crypto.decryptString(user.totpSecret), code)) return true;
    for (let i = 0; i < user.recoveryCodes.length; i++) {
      if (await compare(code, user.recoveryCodes[i])) {
        await this.prisma.platformUser.update({
          where: { id: user.id },
          data: { recoveryCodes: user.recoveryCodes.filter((_, j) => j !== i) },
        });
        return true;
      }
    }
    return false;
  }
}
