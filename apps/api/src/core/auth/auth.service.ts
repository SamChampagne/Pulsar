import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, LoginResponse, ModuleKey, PermissionKey } from '@pulsar/shared';
import { AuditAction } from '@pulsar/shared';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LoginDto } from './dto/login.dto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        status: 'ACTIVE',
        ...(dto.tenant ? { tenant: { slug: dto.tenant } } : {}),
      },
      include: { tenant: true },
    });
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.tenant.status === 'SUSPENDED') {
      throw new UnauthorizedException('Tenant is suspended');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: user.id,
    });

    return this.buildSession(user.id);
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a fresh pair is
   * issued. Permissions are re-read from the database, so role changes take
   * effect at the next refresh (not only at the next login).
   */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is disabled');
    }
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.buildSession(record.userId);
  }

  async logout(refreshToken: string): Promise<{ loggedOut: boolean }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  private async buildSession(userId: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tenant: true },
    });
    const permissions = await this.getUserPermissions(user.id);
    const enabledModules = await this.getEnabledModules(user.tenantId);

    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      permissions,
    };

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshDays = this.config.get<number>('REFRESH_EXPIRES_DAYS', 30);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshDays * 24 * 3600 * 1000),
      },
    });

    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        permissions,
      },
      tenant: {
        id: user.tenant.id,
        slug: user.tenant.slug,
        name: user.tenant.name,
        enabledModules,
      },
    };
  }

  /** Flattens role → permission assignments into a unique list of permission keys. */
  async getUserPermissions(userId: string): Promise<PermissionKey[]> {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const keys = assignments.flatMap((a) =>
      a.role.permissions.map((rp) => rp.permission.key as PermissionKey),
    );
    return [...new Set(keys)];
  }

  async getEnabledModules(tenantId: string): Promise<ModuleKey[]> {
    const modules = await this.prisma.tenantModule.findMany({
      where: { tenantId, enabled: true },
      include: { module: true },
    });
    return modules.map((m) => m.module.key as ModuleKey);
  }
}
