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

/**
 * Inbound API keys for machine-to-machine integrations.
 * v1 restriction: only `*.read` scopes are accepted — write paths attribute
 * actions to a user id, which an API key does not have. Service accounts will
 * lift this (see TODO.md).
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

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
      if (!scope.endsWith('.read')) {
        throw new BadRequestException(
          `API keys only support read scopes for now ("${scope}" is not a .read permission)`,
        );
      }
    }
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

  /** Resolves a raw key into a synthetic AuthUser carrying the key's scopes. */
  async validate(rawKey: string): Promise<AuthUser> {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(rawKey) } });
    if (!key || key.revokedAt) throw new UnauthorizedException('Invalid API key');
    // Fire-and-forget usage stamp — not worth blocking the request for.
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return {
      id: `apikey:${key.id}`,
      tenantId: key.tenantId,
      email: `apikey:${key.name}`,
      firstName: 'API',
      lastName: key.name,
      permissions: key.scopes as PermissionKey[],
    };
  }
}
