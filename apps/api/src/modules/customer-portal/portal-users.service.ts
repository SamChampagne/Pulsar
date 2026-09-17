import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  PortalActionTokenKind,
  PortalUserRole,
  PortalUserStatus,
} from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { auditActor } from '../../core/audit-logs/audit-actor';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { MailService } from '../../core/email/mail.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const INVITATION_TTL_MS = 72 * 3600 * 1000;

/**
 * Who is acting on a portal account. Staff act with a tenant `User` id (which
 * can go in `AuditLog.userId`); a portal ADMIN managing colleagues acts with a
 * `PortalUser` id, which is NOT a `User` row — it is recorded in the audit
 * payload instead, never in the FK column.
 */
export type PortalActor =
  | { kind: 'staff'; userId: string }
  | { kind: 'portal'; portalUserId: string };

export interface InvitePortalUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role?: PortalUserRole;
}

const portalUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  actionTokens: {
    where: { kind: PortalActionTokenKind.INVITATION, usedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.PortalUserSelect;

type ProjectablePortalUser = {
  status: string;
  actionTokens?: Array<{ expiresAt: Date }>;
  [key: string]: unknown;
};

/**
 * Strips the raw invitation-token relation and derives the public `invitation`
 * projection instead. `passwordHash` is never selected in the first place.
 */
function project<T extends ProjectablePortalUser>(user: T) {
  const { actionTokens, ...rest } = user;
  const pending = actionTokens?.[0];
  const invitation =
    rest.status === PortalUserStatus.INVITED && pending
      ? { expiresAt: pending.expiresAt, expired: pending.expiresAt < new Date() }
      : null;
  return { ...rest, invitation } as Omit<T, 'actionTokens'> & {
    invitation: { expiresAt: Date; expired: boolean } | null;
  };
}

/**
 * Lifecycle of customer-portal accounts, driven either by the shipper's staff
 * (`customer-portal.users.manage`) or by a portal ADMIN managing their own
 * colleagues. Every query is scoped by `tenantId` AND `customerId`: a customer
 * company is the isolation unit inside a tenant.
 *
 * Mirrors `core/users/users.service.ts` (invitation tokens, last-admin guard in
 * a Serializable transaction, conditional `updateMany` writes).
 */
@Injectable()
export class PortalUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Maps a Postgres serialization failure (Serializable isolation) to a retryable 409. */
  private mapTransactionError(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return new ConflictException('Concurrent modification, retry');
    }
    return err;
  }

  /** `AuditLog.userId` only ever carries a real tenant `User` id. */
  private auditUserId(actor: PortalActor): string | undefined {
    return actor.kind === 'staff' ? auditActor(actor.userId) : undefined;
  }

  private actorTrace(actor: PortalActor): Record<string, string> {
    return actor.kind === 'portal' ? { actedByPortalUserId: actor.portalUserId } : {};
  }

  private async shipperName(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? 'Pulsar';
  }

  /** Marks every still-open action token of the account as used. */
  private async invalidateOpenTokens(
    db: Prisma.TransactionClient,
    portalUserId: string,
    kind?: PortalActionTokenKind,
  ): Promise<void> {
    await db.portalActionToken.updateMany({
      where: { portalUserId, usedAt: null, ...(kind ? { kind } : {}) },
      data: { usedAt: new Date() },
    });
  }

  /**
   * Invalidates any previously unused invitation, issues a fresh 72h one,
   * emails it and returns the activation URL. Shared by invite(),
   * resendInvitation() and reactivate() so token semantics never drift.
   */
  private async issueInvitation(
    tenantId: string,
    user: { id: string; email: string; firstName: string },
    shipper: string,
  ): Promise<string> {
    await this.invalidateOpenTokens(this.prisma, user.id, PortalActionTokenKind.INVITATION);
    const token = randomBytes(32).toString('base64url');
    await this.prisma.portalActionToken.create({
      data: {
        portalUserId: user.id,
        kind: PortalActionTokenKind.INVITATION,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    const inviteUrl = `${webUrl}/portal/activate/${token}`;
    // Durable outbox, so the invitation shows up in the shipper's email history.
    await this.mail
      .queue(tenantId, {
        toAddresses: [user.email],
        subject: `Vous êtes invité au portail de ${shipper}`,
        html: `<p>Bonjour ${user.firstName},</p><p>${shipper} vous invite sur son portail client. Choisissez votre mot de passe pour activer votre compte : <a href="${inviteUrl}">${inviteUrl}</a></p><p>Ce lien expire dans 72 heures.</p>`,
        text: `${shipper} vous invite sur son portail client. Activez votre compte : ${inviteUrl} (ce lien expire dans 72 heures)`,
      })
      .catch(() => undefined);
    return inviteUrl;
  }

  async listForCustomer(tenantId: string, customerId: string) {
    const items = await this.prisma.portalUser.findMany({
      where: { tenantId, customerId },
      orderBy: { email: 'asc' },
      select: portalUserSelect,
    });
    return items.map(project);
  }

  async get(tenantId: string, customerId: string, id: string) {
    const found = await this.prisma.portalUser.findFirst({
      where: { id, tenantId, customerId },
      select: portalUserSelect,
    });
    if (!found) throw new NotFoundException('Portal user not found');
    return project(found);
  }

  /**
   * Invites a person to the customer's portal: creates an INVITED account with
   * an unguessable placeholder password and emails a one-shot 72h activation
   * link (also returned so an admin can forward it manually).
   */
  async invite(
    tenantId: string,
    customerId: string,
    dto: InvitePortalUserInput,
    actor: PortalActor,
  ) {
    const email = dto.email.toLowerCase();
    // The customerId comes from the URL (staff) or the principal (portal); it is
    // still re-checked against the tenant before anything is written (rule 9).
    await this.ownership.assertOwned('customer', customerId, tenantId);

    const existing = await this.prisma.portalUser.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A portal user with this email already exists');
    }

    const role = dto.role ?? PortalUserRole.MEMBER;
    let created: { id: string };
    try {
      created = await this.prisma.portalUser.create({
        data: {
          tenantId,
          customerId,
          email,
          // Placeholder until the invitee sets a real one; never login-usable.
          passwordHash: await hash(randomBytes(32).toString('hex'), 10),
          firstName: dto.firstName,
          lastName: dto.lastName,
          role,
          status: PortalUserStatus.INVITED,
        },
        select: { id: true },
      });
    } catch (err) {
      // The pre-check above is a snapshot: two concurrent invites of the same
      // address both pass it, and the `tenantId_email` unique index arbitrates.
      // The loser must get the same 409 as the sequential case, not a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A portal user with this email already exists');
      }
      throw err;
    }

    const inviteUrl = await this.issueInvitation(
      tenantId,
      { id: created.id, email, firstName: dto.firstName },
      await this.shipperName(tenantId),
    );

    await this.audit.log({
      tenantId,
      userId: this.auditUserId(actor),
      action: AuditAction.CREATE,
      entityType: 'portal-user',
      entityId: created.id,
      after: {
        email,
        role,
        customerId,
        ...(actor.kind === 'portal' ? { invitedByPortalUserId: actor.portalUserId } : {}),
      },
    });

    // Re-read so the projection reflects the invitation just issued.
    return { ...(await this.get(tenantId, customerId, created.id)), inviteUrl };
  }

  async resendInvitation(
    tenantId: string,
    customerId: string,
    id: string,
    actor: PortalActor,
  ): Promise<{ inviteUrl: string }> {
    const user = await this.prisma.portalUser.findFirst({
      where: { id, tenantId, customerId },
      select: { id: true, email: true, firstName: true, status: true },
    });
    if (!user) throw new NotFoundException('Portal user not found');
    if (user.status !== PortalUserStatus.INVITED) {
      throw new BadRequestException('Portal user is not pending invitation');
    }
    const inviteUrl = await this.issueInvitation(tenantId, user, await this.shipperName(tenantId));
    await this.audit.log({
      tenantId,
      userId: this.auditUserId(actor),
      action: AuditAction.UPDATE,
      entityType: 'portal-user',
      entityId: id,
      after: { invitationResent: true, ...this.actorTrace(actor) },
    });
    return { inviteUrl };
  }

  /**
   * Deactivates a portal account: the status flip, the invalidation of open
   * links and the revocation of live sessions happen in one Serializable
   * transaction, together with the last-admin count (otherwise the
   * count-then-write is a TOCTOU race).
   */
  async deactivate(tenantId: string, customerId: string, id: string, actor: PortalActor) {
    if (actor.kind === 'portal' && actor.portalUserId === id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    let outcome: { changed: boolean; previousStatus?: string };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.portalUser.findFirst({
            where: { id, tenantId, customerId },
            select: { status: true, role: true },
          });
          if (!user) throw new NotFoundException('Portal user not found');
          if (user.status === PortalUserStatus.DISABLED) return { changed: false };
          const previousStatus = user.status;

          // A customer company must keep at least one ACTIVE portal admin, or
          // nobody on the customer side can manage colleagues any more.
          if (user.status === PortalUserStatus.ACTIVE && user.role === PortalUserRole.ADMIN) {
            const activeAdmins = await tx.portalUser.count({
              where: {
                tenantId,
                customerId,
                status: PortalUserStatus.ACTIVE,
                role: PortalUserRole.ADMIN,
              },
            });
            if (activeAdmins <= 1) {
              throw new BadRequestException(
                'Cannot deactivate the last active portal administrator',
              );
            }
          }

          const result = await tx.portalUser.updateMany({
            where: { id, tenantId, customerId, status: { not: PortalUserStatus.DISABLED } },
            data: { status: PortalUserStatus.DISABLED },
          });
          if (result.count === 0) return { changed: false };

          // No live activation / reset link, and no live session, may survive.
          await this.invalidateOpenTokens(tx, id);
          await tx.portalRefreshToken.updateMany({
            where: { portalUserId: id, revokedAt: null },
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
        userId: this.auditUserId(actor),
        action: AuditAction.STATUS_CHANGE,
        entityType: 'portal-user',
        entityId: id,
        before: { status: outcome.previousStatus },
        after: { status: PortalUserStatus.DISABLED, ...this.actorTrace(actor) },
      });
    }
    return this.get(tenantId, customerId, id);
  }

  /**
   * Re-enables a disabled account: straight to ACTIVE when it already had a
   * working password (it has logged in before), back to INVITED with a fresh
   * activation link otherwise.
   */
  async reactivate(tenantId: string, customerId: string, id: string, actor: PortalActor) {
    const user = await this.prisma.portalUser.findFirst({
      where: { id, tenantId, customerId },
      select: { id: true, email: true, firstName: true, status: true, lastLoginAt: true },
    });
    if (!user) throw new NotFoundException('Portal user not found');
    if (user.status !== PortalUserStatus.DISABLED) {
      throw new BadRequestException('Portal user is not disabled');
    }

    const nextStatus = user.lastLoginAt ? PortalUserStatus.ACTIVE : PortalUserStatus.INVITED;
    // Conditional write: a concurrent reactivate/deactivate race loses cleanly
    // instead of double-applying.
    const result = await this.prisma.portalUser.updateMany({
      where: { id, tenantId, customerId, status: PortalUserStatus.DISABLED },
      data: { status: nextStatus },
    });
    if (result.count === 0) {
      return this.get(tenantId, customerId, id);
    }

    await this.audit.log({
      tenantId,
      userId: this.auditUserId(actor),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'portal-user',
      entityId: id,
      before: { status: PortalUserStatus.DISABLED },
      after: { status: nextStatus, ...this.actorTrace(actor) },
    });

    if (nextStatus === PortalUserStatus.ACTIVE) {
      return this.get(tenantId, customerId, id);
    }
    const inviteUrl = await this.issueInvitation(tenantId, user, await this.shipperName(tenantId));
    return { ...(await this.get(tenantId, customerId, id)), inviteUrl };
  }
}
