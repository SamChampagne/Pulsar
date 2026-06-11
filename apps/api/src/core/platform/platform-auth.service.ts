import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PlatformJwtPayload, PlatformLoginResponse } from '@pulsar/shared';
import { compare } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<PlatformLoginResponse> {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || user.status !== 'ACTIVE' || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const payload: PlatformJwtPayload = { sub: user.id, email: user.email, platformAdmin: true };
    return {
      // Ops plane: 12 h access token, no refresh token (re-login is acceptable).
      accessToken: await this.jwt.signAsync(payload, { expiresIn: '12h' }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }
}
