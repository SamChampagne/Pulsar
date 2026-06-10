import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, LoginResponse, ModuleKey, PermissionKey } from '@pulsar/shared';
import { AuditAction } from '@pulsar/shared';
import { compare } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

    const permissions = await this.getUserPermissions(user.id);
    const enabledModules = await this.getEnabledModules(user.tenantId);

    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      permissions,
    };

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

    return {
      accessToken: await this.jwt.signAsync(payload),
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
