import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface FakeApiKeyRow {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdById: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function harness(rows: FakeApiKeyRow[] = []) {
  const users = new Map<string, { id: string }>();
  const prisma = {
    apiKey: {
      findUnique: async ({ where }: { where: { keyHash?: string; id?: string } }) => {
        if (where.keyHash) return rows.find((r) => r.keyHash === where.keyHash) ?? null;
        return rows.find((r) => r.id === where.id) ?? null;
      },
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        rows.filter((r) => r.tenantId === where.tenantId),
      create: async ({ data }: { data: Partial<FakeApiKeyRow> }) => {
        const row: FakeApiKeyRow = {
          id: `key-${rows.length + 1}`,
          tenantId: data.tenantId!,
          name: data.name!,
          prefix: data.prefix!,
          keyHash: data.keyHash!,
          scopes: data.scopes ?? [],
          expiresAt: data.expiresAt ?? null,
          revokedAt: null,
          createdById: data.createdById ?? null,
          lastUsedAt: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeApiKeyRow> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    user: {
      findUnique: async ({
        where,
      }: {
        where: { tenantId_email: { tenantId: string; email: string } };
      }) => {
        const key = `${where.tenantId_email.tenantId}:${where.tenantId_email.email}`;
        return users.has(key) ? { id: users.get(key)!.id } : null;
      },
      create: async ({ data }: { data: { tenantId: string; email: string } }) => {
        const id = `svc-user-${users.size + 1}`;
        users.set(`${data.tenantId}:${data.email}`, { id });
        return { id };
      },
    },
  } as unknown as PrismaService;
  return { svc: new ApiKeysService(prisma), rows };
}

describe('ApiKeysService', () => {
  describe('create', () => {
    it('rejects an expiresAt in the past', async () => {
      const { svc } = harness();
      await expect(
        svc.create(
          't1',
          'u1',
          'Partner',
          ['transportation.tracking.read'],
          new Date(Date.now() - 1000),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists a future expiresAt', async () => {
      const { svc, rows } = harness();
      const future = new Date(Date.now() + 60_000);
      const created = await svc.create(
        't1',
        'u1',
        'Partner',
        ['transportation.tracking.read'],
        future,
      );
      expect(created.expiresAt).toEqual(future);
      expect(rows[0].expiresAt).toEqual(future);
    });

    it('persists no expiry when omitted', async () => {
      const { svc } = harness();
      const created = await svc.create('t1', 'u1', 'Partner', ['transportation.tracking.read']);
      expect(created.expiresAt).toBeNull();
    });
  });

  describe('validate', () => {
    it('resolves an unexpired key', async () => {
      const rawKey = 'pk_test-valid';
      const { svc } = harness([
        {
          id: 'k1',
          tenantId: 't1',
          name: 'Partner',
          prefix: 'pk_test-va',
          keyHash: sha256(rawKey),
          scopes: ['transportation.tracking.read'],
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          createdById: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      ]);
      const user = await svc.validate(rawKey);
      expect(user.tenantId).toBe('t1');
      expect(user.permissions).toEqual(['transportation.tracking.read']);
    });

    it('rejects an expired key with the same generic message as an invalid key', async () => {
      const rawKey = 'pk_test-expired';
      const { svc } = harness([
        {
          id: 'k1',
          tenantId: 't1',
          name: 'Partner',
          prefix: 'pk_test-ex',
          keyHash: sha256(rawKey),
          scopes: ['transportation.tracking.read'],
          expiresAt: new Date(Date.now() - 1000),
          revokedAt: null,
          createdById: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      ]);

      const expired = await svc.validate(rawKey).catch((e: unknown) => e);
      expect(expired).toBeInstanceOf(UnauthorizedException);

      const unknown = await svc.validate('pk_does-not-exist').catch((e: unknown) => e);
      expect(unknown).toBeInstanceOf(UnauthorizedException);

      expect((expired as UnauthorizedException).message).toBe(
        (unknown as UnauthorizedException).message,
      );
    });

    it('rejects a revoked key', async () => {
      const rawKey = 'pk_test-revoked';
      const { svc } = harness([
        {
          id: 'k1',
          tenantId: 't1',
          name: 'Partner',
          prefix: 'pk_test-re',
          keyHash: sha256(rawKey),
          scopes: [],
          expiresAt: null,
          revokedAt: new Date(),
          createdById: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      ]);
      await expect(svc.validate(rawKey)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a key with no expiry set', async () => {
      const rawKey = 'pk_test-noexp';
      const { svc } = harness([
        {
          id: 'k1',
          tenantId: 't1',
          name: 'Partner',
          prefix: 'pk_test-no',
          keyHash: sha256(rawKey),
          scopes: [],
          expiresAt: null,
          revokedAt: null,
          createdById: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      ]);
      await expect(svc.validate(rawKey)).resolves.toBeDefined();
    });
  });
});
