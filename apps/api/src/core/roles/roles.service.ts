import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, resolveRoleTemplates, type ModuleKey } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { auditActor } from '../audit-logs/audit-actor';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

const roleInclude = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantModules: TenantModulesCacheService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async templates(tenantId: string) {
    const enabled = [...(await this.tenantModules.getEnabledKeys(tenantId))] as ModuleKey[];
    const existing = new Set(
      (await this.prisma.role.findMany({ where: { tenantId }, select: { key: true } })).map(
        (r) => r.key,
      ),
    );
    return resolveRoleTemplates(enabled).map((t) => ({ ...t, exists: existing.has(t.key) }));
  }

  async createFromTemplate(tenantId: string, templateKey: string) {
    const enabled = [...(await this.tenantModules.getEnabledKeys(tenantId))] as ModuleKey[];
    const template = resolveRoleTemplates(enabled).find((t) => t.key === templateKey);
    if (!template) {
      throw new BadRequestException(`Unknown or unavailable role template "${templateKey}"`);
    }
    return this.create(tenantId, {
      key: template.key,
      name: template.name,
      description: template.description,
      permissionKeys: template.permissionKeys,
    });
  }

  list(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: roleInclude,
    });
  }

  async get(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, tenantId },
      include: roleInclude,
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(tenantId: string, dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { tenantId_key: { tenantId, key: dto.key } },
    });
    if (existing) throw new ConflictException(`Role "${dto.key}" already exists`);

    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys ?? []);
    return this.prisma.role.create({
      data: {
        tenantId,
        key: dto.key,
        name: dto.name,
        description: dto.description,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.get(tenantId, id);
    if (role.isSystem && dto.permissionKeys) {
      throw new BadRequestException('Permissions of system roles cannot be changed');
    }
    const permissionIds = dto.permissionKeys
      ? await this.resolvePermissionIds(dto.permissionKeys)
      : undefined;
    return this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        ...(permissionIds
          ? {
              permissions: {
                deleteMany: {},
                create: permissionIds.map((permissionId) => ({ permissionId })),
              },
            }
          : {}),
      },
      include: roleInclude,
    });
  }

  async remove(tenantId: string, id: string, userId?: string) {
    const role = await this.get(tenantId, id);
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    if (role._count.users > 0) {
      throw new BadRequestException(`Role is assigned to ${role._count.users} user(s)`);
    }
    await this.prisma.role.delete({ where: { id } });
    await this.auditLogs.log({
      tenantId,
      userId: auditActor(userId),
      action: AuditAction.DELETE,
      entityType: 'role',
      entityId: id,
      before: { key: role.key, name: role.name },
    });
    return { deleted: true };
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    const found = new Set(permissions.map((p) => p.key));
    const unknown = keys.filter((k) => !found.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission keys: ${unknown.join(', ')}`);
    }
    return permissions.map((p) => p.id);
  }
}
