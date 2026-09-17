import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import { AuditAction } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../common/pagination';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MailService } from '../email/mail.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, key: true, name: true } } } },
  actionTokens: {
    where: { kind: 'INVITATION', usedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.UserSelect;

type ProjectableUser = {
  status: string;
  actionTokens?: Array<{ expiresAt: Date }>;
  [key: string]: unknown;
};

/**
 * Strips the raw invitation-token relation from a user record and derives
 * the public `invitation` projection instead — never leak `actionTokens`.
 */
function project<T extends ProjectableUser>(user: T): Omit<T, 'actionTokens'> & {
  invitation: { expiresAt: Date; expired: boolean } | null;
} {
  const { actionTokens, ...rest } = user;
  const pending = actionTokens?.[0];
  const invitation =
    rest.status === 'INVITED' && pending
      ? { expiresAt: pending.expiresAt, expired: pending.expiresAt < new Date() }
      : null;
  return { ...rest, invitation } as Omit<T, 'actionTokens'> & {
    invitation: { expiresAt: Date; expired: boolean } | null;
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditLogsService,
  ) {}

  private async assertRolesOwned(tenantId: string, roleIds: string[] | undefined) {
    if (!roleIds) return;
    await Promise.all(roleIds.map((id) => this.ownership.assertOwned('role', id, tenantId)));
  }

  /**
   * True when `userId` currently holds the tenant's system admin role and is
   * the last ACTIVE user holding it. Must be checked in the same code path
   * as the mutation (deactivate / role removal) that could break this.
   */
  private async isLastActiveAdmin(tenantId: string, userId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { roles: { select: { role: { select: { isSystem: true, key: true } } } } },
    });
    if (!user) return false;
    const hasAdminRole = user.roles.some((r) => r.role.isSystem && r.role.key === 'admin');
    if (!hasAdminRole) return false;
    const activeAdminCount = await this.prisma.user.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        roles: { some: { role: { isSystem: true, key: 'admin' } } },
      },
    });
    return activeAdminCount <= 1;
  }

  /**
   * Invalidates any previously unused invitation token, issues a fresh
   * 72h one, emails it and returns the invite URL. Shared by create(),
   * resendInvitation() and reactivate() so the token semantics stay
   * identical everywhere an invitation is (re)issued.
   */
  private async issueInvitation(
    tenantId: string,
    user: { id: string; email: string },
  ): Promise<string> {
    await this.prisma.userActionToken.updateMany({
      where: { userId: user.id, kind: 'INVITATION', usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.userActionToken.create({
      data: {
        userId: user.id,
        kind: 'INVITATION',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      },
    });
    const inviteUrl = `${this.config.get('WEB_URL', 'http://localhost:5173')}/reset-password/${token}`;
    // Route through the durable outbox so the invitation email is recorded
    // in the tenant's email history.
    void this.mail
      .queue(tenantId, {
        toAddresses: [user.email],
        subject: 'You have been invited to Pulsar',
        html: `<p>Set your password to activate your Pulsar account: <a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 72 hours.</p>`,
        text: `Activate your Pulsar account: ${inviteUrl} (expires in 72 hours)`,
        createdByUserId: undefined,
      })
      .catch(() => undefined);
    return inviteUrl;
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip, take, orderBy: { email: 'asc' }, select: userSelect }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(items.map(project), total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: userSelect });
    if (!user) throw new NotFoundException('User not found');
    return project(user);
  }

  /**
   * Creates a user. Without a password the account is INVITED: a one-shot
   * invitation link (72h) is emailed and also returned so the admin can
   * forward it manually.
   */
  async create(tenantId: string, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (existing) throw new ConflictException('A user with this email already exists');
    await this.assertRolesOwned(tenantId, dto.roleIds);

    const invited = !dto.password;
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        // Invited accounts get an unguessable placeholder until they set a password.
        passwordHash: await hash(dto.password ?? randomBytes(32).toString('hex'), 10),
        status: invited ? 'INVITED' : 'ACTIVE',
        firstName: dto.firstName,
        lastName: dto.lastName,
        roles: dto.roleIds
          ? { create: dto.roleIds.map((roleId) => ({ roleId })) }
          : undefined,
      },
      select: userSelect,
    });

    if (!invited) return project(user);

    const inviteUrl = await this.issueInvitation(tenantId, { id: user.id, email });
    return { ...project(user), inviteUrl };
  }

  // `actorId` is accepted for interface parity with deactivate(); the declarative
  // @Audit('user', UPDATE) decorator on the controller already records who acted.
  async update(tenantId: string, id: string, dto: UpdateUserDto, _actorId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { roles: { select: { role: { select: { id: true, isSystem: true, key: true } } } } },
    });
    if (!existing) throw new NotFoundException('User not found');
    await this.assertRolesOwned(tenantId, dto.roleIds);

    if (dto.roleIds) {
      const currentAdminRole = existing.roles.map((r) => r.role).find((r) => r.isSystem && r.key === 'admin');
      if (
        currentAdminRole &&
        !dto.roleIds.includes(currentAdminRole.id) &&
        (await this.isLastActiveAdmin(tenantId, id))
      ) {
        throw new BadRequestException(
          'Cannot remove the administrator role from the last active administrator',
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        ...(dto.roleIds
          ? { roles: { deleteMany: {}, create: dto.roleIds.map((roleId) => ({ roleId })) } }
          : {}),
      },
      select: userSelect,
    });
    return project(updated);
  }

  async deactivate(tenantId: string, id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('You cannot deactivate your own account');
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.status !== 'DISABLED') {
      const previousStatus = user.status;
      if (await this.isLastActiveAdmin(tenantId, id)) {
        throw new BadRequestException('Cannot deactivate the last active administrator');
      }
      const result = await this.prisma.user.updateMany({
        where: { id, tenantId, status: { not: 'DISABLED' } },
        data: { status: 'DISABLED' },
      });
      if (result.count > 0) {
        await this.audit.log({
          tenantId,
          userId: actorId,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'user',
          entityId: id,
          before: { status: previousStatus },
          after: { status: 'DISABLED' },
        });
      }
    }
    return this.get(tenantId, id);
  }

  async resendInvitation(tenantId: string, id: string, actorId: string): Promise<{ inviteUrl: string }> {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'INVITED') {
      throw new BadRequestException('User is not pending invitation');
    }
    const inviteUrl = await this.issueInvitation(tenantId, { id: user.id, email: user.email });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: AuditAction.UPDATE,
      entityType: 'user',
      entityId: id,
      after: { invitationResent: true },
    });
    return { inviteUrl };
  }

  async reactivate(tenantId: string, id: string, actorId: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'DISABLED') {
      throw new BadRequestException('User is not disabled');
    }
    const before = { status: user.status };

    if (user.lastLoginAt) {
      await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'user',
        entityId: id,
        before,
        after: { status: 'ACTIVE' },
      });
      return this.get(tenantId, id);
    }

    await this.prisma.user.update({ where: { id }, data: { status: 'INVITED' } });
    const inviteUrl = await this.issueInvitation(tenantId, { id: user.id, email: user.email });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'user',
      entityId: id,
      before,
      after: { status: 'INVITED' },
    });
    const projected = await this.get(tenantId, id);
    return { ...projected, inviteUrl };
  }
}
