import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, PermissionKey } from '@pulsar/shared';
import { ALL_PERMISSION_KEYS } from '@pulsar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const keySelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

const SERVICE_ACCOUNT_EMAIL = 'service-account@pulsar.local';

/**
 * Inbound API keys for machine-to-machine integrations.
 * Keys act as the tenant's hidden **service account** user (DISABLED → cannot
 * sign in, but gives write paths a real user id for audit/FK attribution),
 * carrying the scopes chosen at creation. Write scopes are therefore allowed.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** One hidden service-account user per tenant, created lazily. */
  private async ensureServiceUser(tenantId: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: SERVICE_ACCOUNT_EMAIL } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.user.create({
      data: {
        tenantId,
        email: SERVICE_ACCOUNT_EMAIL,
        // Unguessable placeholder + DISABLED status: this account can never sign in.
        passwordHash: sha256(randomBytes(32).toString('hex')),
        firstName: 'Service',
        lastName: 'Account',
        status: 'DISABLED',
      },
      select: { id: true },
    });
    return created.id;
  }

  list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: keySelect,
    });
  }

  /** Returns the full key once — only the hash is stored. */
  async create(tenantId: string, createdById: string, name: string, scopes: string[]) {
    const valid = new Set<string>(ALL_PERMISSION_KEYS);
    for (const scope of scopes) {
      if (!valid.has(scope)) throw new BadRequestException(`Unknown scope "${scope}"`);
    }
    await this.ensureServiceUser(tenantId);
    const rawKey = `pk_${randomBytes(24).toString('base64url')}`;
    const record = await this.prisma.apiKey.create({
      data: {
        tenantId,
        name,
        prefix: rawKey.slice(0, 11),
        keyHash: sha256(rawKey),
        scopes,
        createdById,
      },
      select: keySelect,
    });
    return { ...record, key: rawKey };
  }

  async revoke(tenantId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!key) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  /** Resolves a raw key into the tenant's service-account principal with the key's scopes. */
  async validate(rawKey: string): Promise<AuthUser> {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(rawKey) } });
    if (!key || key.revokedAt) throw new UnauthorizedException('Invalid API key');
    // Fire-and-forget usage stamp — not worth blocking the request for.
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return {
      id: await this.ensureServiceUser(key.tenantId),
      tenantId: key.tenantId,
      email: `apikey:${key.name}`,
      firstName: 'API',
      lastName: key.name,
      permissions: key.scopes as PermissionKey[],
    };
  }
}
