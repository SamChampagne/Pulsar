import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import { AuditAction, MODULE_KEYS, TenantStatus, type ModuleKey } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailService } from '../email/email.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/platform.dto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Cross-tenant administration plane. Reachable only by platform staff
 * (`isPlatformAdmin`, enforced by PlatformAdminGuard). Every method takes an
 * explicit tenant id — nothing here is scoped to the caller's own tenant.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    private readonly email: EmailService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  /** Platform-wide rollup for the admin landing page. */
  async overview() {
    const [tenants, active, suspended, users, modules] = await this.prisma.$transaction([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
      this.prisma.tenant.count({ where: { status: TenantStatus.SUSPENDED } }),
      this.prisma.user.count(),
      this.prisma.tenantModule.count({ where: { enabled: true } }),
    ]);
    return { tenants, active, suspended, users, enabledModules: modules };
  }

  async listTenants(query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.TenantWhereInput = query.search
      ? {
          OR: [
            { slug: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true } },
          modules: { where: { enabled: true }, include: { module: { select: { key: true } } } },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return paginated(
      rows.map((t) => this.toSummary(t)),
      total,
      page,
      pageSize,
    );
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } },
        modules: { include: { module: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const definitions = await this.prisma.moduleDefinition.findMany({ orderBy: { key: 'asc' } });
    const byId = new Map(tenant.modules.map((m) => [m.moduleId, m]));
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      userCount: tenant._count.users,
      modules: definitions.map((def) => ({
        key: def.key,
        name: def.name,
        isCore: def.isCore,
        available: def.available,
        enabled: def.isCore || (byId.get(def.id)?.enabled ?? false),
      })),
    };
  }

  /**
   * Provisions a brand-new tenant in one transaction: the tenant, its enabled
   * modules (core + requested), a full-access `admin` system role, and the
   * initial administrator. Without a password the admin is INVITED and a
   * one-shot activation link (72 h) is emailed and returned.
   */
  async createTenant(dto: CreateTenantDto, actingUserId: string) {
    const slug = dto.slug.toLowerCase();
    const clash = await this.prisma.tenant.findUnique({ where: { slug } });
    if (clash) throw new ConflictException(`A tenant with slug "${slug}" already exists`);

    const moduleKeys = await this.resolveModuleKeys(dto.modules ?? []);
    const adminEmail = dto.admin.email.toLowerCase();
    const invited = !dto.admin.password;
    const inviteToken = invited ? randomBytes(32).toString('base64url') : null;

    const { tenant } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug, name: dto.name, status: dto.status ?? TenantStatus.TRIAL },
      });

      const definitions = await tx.moduleDefinition.findMany({
        where: { key: { in: moduleKeys } },
      });
      await tx.tenantModule.createMany({
        data: definitions.map((def) => ({
          tenantId: tenant.id,
          moduleId: def.id,
          enabled: true,
          enabledAt: new Date(),
        })),
      });

      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          key: 'admin',
          name: 'Administrator',
          description: 'Full access to all modules',
          isSystem: true,
        },
      });
      const permissions = await tx.permission.findMany({ select: { id: true } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: adminEmail,
          // Invited admins get an unguessable placeholder until they set a password.
          passwordHash: await hash(dto.admin.password ?? randomBytes(32).toString('hex'), 10),
          status: invited ? 'INVITED' : 'ACTIVE',
          firstName: dto.admin.firstName,
          lastName: dto.admin.lastName,
          roles: { create: { roleId: role.id } },
        },
      });
      if (inviteToken) {
        await tx.userActionToken.create({
          data: {
            userId: admin.id,
            kind: 'INVITATION',
            tokenHash: sha256(inviteToken),
            expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
          },
        });
      }
      return { tenant, admin };
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: actingUserId,
      action: AuditAction.CREATE,
      entityType: 'tenant',
      entityId: tenant.id,
      after: { slug: tenant.slug, name: tenant.name, status: tenant.status, modules: moduleKeys },
    });

    let inviteUrl: string | undefined;
    if (inviteToken) {
      inviteUrl = `${this.config.get('WEB_URL', 'http://localhost:5173')}/reset-password/${inviteToken}`;
      await this.email.send({
        to: adminEmail,
        subject: `Welcome to Pulsar — activate ${tenant.name}`,
        html: `<p>Your Pulsar workspace <strong>${tenant.name}</strong> is ready. Set your password to sign in: <a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 72 hours.</p>`,
        text: `Activate your Pulsar account for ${tenant.name}: ${inviteUrl} (expires in 72 hours)`,
      });
    }

    return {
      ...(await this.getTenant(tenant.id)),
      adminEmail,
      ...(inviteUrl ? { inviteUrl } : {}),
    };
  }

  async rename(id: string, dto: UpdateTenantDto, actingUserId: string) {
    const before = await this.prisma.tenant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Tenant not found');
    if (!dto.name) return this.getTenant(id);
    await this.prisma.tenant.update({ where: { id }, data: { name: dto.name } });
    await this.audit.log({
      tenantId: id,
      userId: actingUserId,
      action: AuditAction.UPDATE,
      entityType: 'tenant',
      entityId: id,
      before: { name: before.name },
      after: { name: dto.name },
    });
    return this.getTenant(id);
  }

  /** Suspend (blocks all logins for the tenant) or re-activate a tenant. */
  async setStatus(id: string, status: TenantStatus, actingUserId: string) {
    const before = await this.prisma.tenant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Tenant not found');
    if (before.status === status) return this.getTenant(id);
    await this.prisma.tenant.update({ where: { id }, data: { status } });
    await this.audit.log({
      tenantId: id,
      userId: actingUserId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'tenant',
      entityId: id,
      before: { status: before.status },
      after: { status },
    });
    return this.getTenant(id);
  }

  /** Enable or disable a business module for a tenant (cross-tenant twin of /modules). */
  async setModule(tenantId: string, moduleKey: string, enabled: boolean, actingUserId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const definition = await this.prisma.moduleDefinition.findUnique({ where: { key: moduleKey } });
    if (!definition) throw new NotFoundException(`Unknown module "${moduleKey}"`);
    if (definition.isCore) throw new BadRequestException('The core module cannot be toggled');
    if (enabled && !definition.available) {
      throw new BadRequestException(`Module "${moduleKey}" is not available yet`);
    }

    await this.prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: definition.id } },
      update: { enabled, enabledAt: enabled ? new Date() : undefined },
      create: {
        tenantId,
        moduleId: definition.id,
        enabled,
        enabledAt: enabled ? new Date() : null,
      },
    });
    this.modulesCache.invalidate(tenantId);
    await this.audit.log({
      tenantId,
      userId: actingUserId,
      action: AuditAction.UPDATE,
      entityType: 'module',
      entityId: moduleKey,
      after: { enabled },
    });
    return this.getTenant(tenantId);
  }

  /** Validates requested module keys exist and are available; always includes core. */
  private async resolveModuleKeys(requested: string[]): Promise<string[]> {
    const keys = [...new Set<string>([MODULE_KEYS.CORE, ...requested])];
    const definitions = await this.prisma.moduleDefinition.findMany({
      where: { key: { in: keys } },
    });
    const byKey = new Map(definitions.map((d) => [d.key, d]));
    for (const key of keys) {
      const def = byKey.get(key);
      if (!def) throw new BadRequestException(`Unknown module "${key}"`);
      if (!def.isCore && !def.available) {
        throw new BadRequestException(`Module "${key}" is not available yet`);
      }
    }
    return keys;
  }

  private toSummary(tenant: {
    id: string;
    slug: string;
    name: string;
    // Prisma's generated enum, structurally identical to the shared TenantStatus.
    status: string;
    createdAt: Date;
    _count: { users: number };
    modules: { module: { key: string } }[];
  }) {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      userCount: tenant._count.users,
      enabledModules: tenant.modules.map((m) => m.module.key as ModuleKey),
    };
  }
}
