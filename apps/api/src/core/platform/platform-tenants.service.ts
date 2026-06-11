import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, MODULE_CATALOG, MODULE_KEYS } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly audit: AuditLogsService,
  ) {}

  async list() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true } },
        modules: { where: { enabled: true }, include: { module: true } },
      },
    });
    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      userCount: t._count.users,
      enabledModules: t.modules.map((m) => m.module.key),
    }));
  }

  async get(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } },
        modules: { where: { enabled: true }, include: { module: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      userCount: tenant._count.users,
      enabledModules: tenant.modules.map((m) => m.module.key),
    };
  }

  /**
   * Mirrors the seed: tenant + admin role (all catalog permissions) + INVITED
   * admin user with a 72 h invitation link + requested modules enabled.
   */
  async create(platformActor: string, dto: CreatePlatformTenantDto) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Tenant slug "${dto.slug}" already exists`);

    const availableKeys = MODULE_CATALOG.filter((m) => m.available).map((m) => m.key);
    for (const key of dto.modules) {
      if (!availableKeys.includes(key as (typeof availableKeys)[number])) {
        throw new BadRequestException(`Module "${key}" is not available`);
      }
    }
    const moduleKeys = [...new Set([MODULE_KEYS.CORE, ...dto.modules])];

    const inviteToken = randomBytes(32).toString('base64url');
    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { slug: dto.slug, name: dto.name, status: 'ACTIVE' },
      });

      const definitions = await tx.moduleDefinition.findMany({
        where: { key: { in: moduleKeys } },
      });
      for (const def of definitions) {
        await tx.tenantModule.create({
          data: { tenantId: created.id, moduleId: def.id, enabled: true, enabledAt: new Date() },
        });
      }

      const role = await tx.role.create({
        data: {
          tenantId: created.id,
          key: 'admin',
          name: 'Administrator',
          description: 'Full access to all modules',
          isSystem: true,
        },
      });
      const permissions = await tx.permission.findMany();
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });

      const admin = await tx.user.create({
        data: {
          tenantId: created.id,
          email: dto.admin.email.toLowerCase(),
          passwordHash: await hash(randomBytes(32).toString('hex'), 10),
          firstName: dto.admin.firstName,
          lastName: dto.admin.lastName,
          status: 'INVITED',
          roles: { create: [{ roleId: role.id }] },
        },
      });
      await tx.userActionToken.create({
        data: {
          userId: admin.id,
          kind: 'INVITATION',
          tokenHash: sha256(inviteToken),
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
      });
      return created;
    });

    const inviteUrl = `${this.config.get('WEB_URL', 'http://localhost:5173')}/reset-password/${inviteToken}`;
    await this.email.send({
      to: dto.admin.email,
      subject: `Your ${dto.name} workspace on Pulsar is ready`,
      html: `<p>Set your password to activate your administrator account: <a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 72 hours.</p>`,
      text: `Activate your Pulsar administrator account: ${inviteUrl} (expires in 72 hours)`,
    });
    await this.audit.log({
      tenantId: tenant.id,
      userId: undefined,
      action: AuditAction.CREATE,
      entityType: 'tenant',
      entityId: tenant.id,
      after: { slug: tenant.slug, name: tenant.name, modules: moduleKeys, platformActor },
    });
    return { ...(await this.get(tenant.id)), inviteUrl };
  }

  async suspend(platformActor: string, id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'SUSPENDED') {
      throw new BadRequestException('Tenant is already suspended');
    }
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      // Active sessions die with the tenant: no refresh possible while suspended.
      this.prisma.refreshToken.updateMany({
        where: { revokedAt: null, user: { tenantId: id } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      tenantId: id,
      userId: undefined,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'tenant',
      entityId: id,
      before: { status: tenant.status },
      after: { status: 'SUSPENDED', platformActor },
    });
    return this.get(id);
  }

  async reactivate(platformActor: string, id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'SUSPENDED') {
      throw new BadRequestException('Only suspended tenants can be reactivated');
    }
    await this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.log({
      tenantId: id,
      userId: undefined,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'tenant',
      entityId: id,
      before: { status: 'SUSPENDED' },
      after: { status: 'ACTIVE', platformActor },
    });
    return this.get(id);
  }
}
