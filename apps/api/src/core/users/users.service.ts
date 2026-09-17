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
import { auditActor } from '../audit-logs/audit-actor';
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
   * the last ACTIVE user holding it. Must be checked with `db` bound to the
   * same transaction as the mutation (deactivate / role removal) that could
   * break this — otherwise the count-then-write is a TOCTOU race.
   *
   * A target that is not itself ACTIVE (INVITED / DISABLED) is never counted by
   * the ACTIVE-admin tally, so it can never *be* the last active admin: revoking
   * it leaves the tenant exactly as many active admins as before.
   */
  private async isLastActiveAdmin(
    db: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const user = await db.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        status: true,
        roles: { select: { role: { select: { isSystem: true, key: true } } } },
      },
    });
    if (!user) return false;
    if (user.status !== 'ACTIVE') return false;
    const hasAdminRole = user.roles.some((r) => r.role.isSystem && r.role.key === 'admin');
    if (!hasAdminRole) return false;
    const activeAdminCount = await db.user.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        roles: { some: { role: { isSystem: true, key: 'admin' } } },
      },
    });
    return activeAdminCount <= 1;
  }

  /** Marks every still-open action token as used (optionally scoped to one `kind`). */
  private async invalidateOpenTokens(
    db: Prisma.TransactionClient,
    userId: string,
    kind?: 'INVITATION' | 'PASSWORD_RESET' | 'OIDC_EXCHANGE',
  ): Promise<void> {
    await db.userActionToken.updateMany({
      where: { userId, usedAt: null, ...(kind ? { kind } : {}) },
      data: { usedAt: new Date() },
    });
  }

  /** Maps a Postgres serialization failure (Serializable isolation) to a retryable 409. */
  private mapTransactionError(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return new ConflictException('Concurrent modification, retry');
    }
    return err;
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
    await this.invalidateOpenTokens(this.prisma, user.id, 'INVITATION');
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
    // Re-fetch so the projection reflects the invitation token just created
    // (project() run on the pre-invitation `user` would report invitation: null).
    return { ...(await this.get(tenantId, user.id)), inviteUrl };
  }

  // `actorId` is accepted for interface parity with deactivate(); the declarative
  // @Audit('user', UPDATE) decorator on the controller already records who acted.
  async update(tenantId: string, id: string, dto: UpdateUserDto, _actorId: string) {
    await this.assertRolesOwned(tenantId, dto.roleIds);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.user.findFirst({
            where: { id, tenantId },
            select: { roles: { select: { role: { select: { id: true, isSystem: true, key: true } } } } },
          });
          if (!existing) throw new NotFoundException('User not found');

          if (dto.roleIds) {
            const currentAdminRole = existing.roles
              .map((r) => r.role)
              .find((r) => r.isSystem && r.key === 'admin');
            if (
              currentAdminRole &&
              !dto.roleIds.includes(currentAdminRole.id) &&
              (await this.isLastActiveAdmin(tx, tenantId, id))
            ) {
              throw new BadRequestException(
                'Cannot remove the administrator role from the last active administrator',
              );
            }
          }

          const updated = await tx.user.update({
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      throw this.mapTransactionError(err);
    }
  }

  async deactivate(tenantId: string, id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('You cannot deactivate your own account');

    let outcome: { changed: boolean; previousStatus?: string };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findFirst({
            where: { id, tenantId },
            select: { status: true },
          });
          if (!user) throw new NotFoundException('User not found');
          if (user.status === 'DISABLED') return { changed: false };
          const previousStatus = user.status;

          if (await this.isLastActiveAdmin(tx, tenantId, id)) {
            throw new BadRequestException('Cannot deactivate the last active administrator');
          }

          const result = await tx.user.updateMany({
            where: { id, tenantId, status: { not: 'DISABLED' } },
            data: { status: 'DISABLED' },
          });
          if (result.count === 0) return { changed: false };

          // A disabled account must not be reachable through a still-live
          // invitation or password-reset link (see auth.service resetPassword,
          // which now also rejects DISABLED users as defense in depth).
          await this.invalidateOpenTokens(tx, id);
          // ...and neither through a refresh token issued before the account was
          // disabled (the access token still expires on its own within 15 min).
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          return { changed: true, previousStatus };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      throw this.mapTransactionError(err);
    }

    if (outcome.changed) {
      await this.audit.log({
        tenantId,
        userId: auditActor(actorId),
        action: AuditAction.STATUS_CHANGE,
        entityType: 'user',
        entityId: id,
        before: { status: outcome.previousStatus },
        after: { status: 'DISABLED' },
      });
    }
    return this.get(tenantId, id);
  }

  async resendInvitation(tenantId: string, id: string, actorId: string): Promise<{ inviteUrl: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, email: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'INVITED') {
      throw new BadRequestException('User is not pending invitation');
    }
    const inviteUrl = await this.issueInvitation(tenantId, { id: user.id, email: user.email });
    await this.audit.log({
      tenantId,
      userId: auditActor(actorId),
      action: AuditAction.UPDATE,
      entityType: 'user',
      entityId: id,
      after: { invitationResent: true },
    });
    return { inviteUrl };
  }

  async reactivate(tenantId: string, id: string, actorId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, email: true, status: true, lastLoginAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'DISABLED') {
      throw new BadRequestException('User is not disabled');
    }

    const nextStatus: 'ACTIVE' | 'INVITED' = user.lastLoginAt ? 'ACTIVE' : 'INVITED';
    // Conditional write: only flips a still-DISABLED row, so a concurrent
    // reactivate/deactivate race loses cleanly instead of double-applying.
    const result = await this.prisma.user.updateMany({
      where: { id, tenantId, status: 'DISABLED' },
      data: { status: nextStatus },
    });
    if (result.count === 0) {
      return this.get(tenantId, id);
    }

    if (nextStatus === 'ACTIVE') {
      await this.audit.log({
        tenantId,
        userId: auditActor(actorId),
        action: AuditAction.STATUS_CHANGE,
        entityType: 'user',
        entityId: id,
        before: { status: 'DISABLED' },
        after: { status: 'ACTIVE' },
      });
      return this.get(tenantId, id);
    }

    const inviteUrl = await this.issueInvitation(tenantId, { id: user.id, email: user.email });
    await this.audit.log({
      tenantId,
      userId: auditActor(actorId),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'user',
      entityId: id,
      before: { status: 'DISABLED' },
      after: { status: 'INVITED' },
    });
    const projected = await this.get(tenantId, id);
    return { ...projected, inviteUrl };
  }
}
