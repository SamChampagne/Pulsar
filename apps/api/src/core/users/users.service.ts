import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../common/pagination';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
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
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  private async assertRolesOwned(tenantId: string, roleIds: string[] | undefined) {
    if (!roleIds) return;
    await Promise.all(roleIds.map((id) => this.ownership.assertOwned('role', id, tenantId)));
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
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: userSelect });
    if (!user) throw new NotFoundException('User not found');
    return user;
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

    if (!invited) return user;

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
    await this.email.send({
      to: email,
      subject: 'You have been invited to Pulsar',
      html: `<p>Set your password to activate your Pulsar account: <a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 72 hours.</p>`,
      text: `Activate your Pulsar account: ${inviteUrl} (expires in 72 hours)`,
    });
    return { ...user, inviteUrl };
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.get(tenantId, id);
    await this.assertRolesOwned(tenantId, dto.roleIds);
    return this.prisma.user.update({
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
  }

  async deactivate(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: { status: 'DISABLED' },
      select: userSelect,
    });
  }
}
