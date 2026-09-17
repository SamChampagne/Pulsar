import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import type { ApiKeysService } from '../api-keys/api-keys.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CryptoService } from '../crypto/crypto.service';
import { InboundHooksService, redactStoredPayload } from './inbound-hooks.service';
import type { ConnectRecordWriter } from './record-writer.service';
import type { EdiService } from './edi.service';

const TOKEN = 'tok_'.padEnd(48, 'x');
const HASH = createHash('sha256').update(TOKEN).digest('hex');

interface HarnessOptions {
  config?: Record<string, unknown>;
  status?: string;
  tenantStatus?: string;
  enabledModules?: string[];
  existingMessage?: Record<string, unknown> | null;
  writeFails?: string;
  /** Number of rows the conditional re-claim of a stuck row reports. */
  reclaimCount?: number;
}

function harness(options: HarnessOptions = {}) {
  const config = options.config ?? { target: 'customer.upsert' };
  const messages: any[] = [];
  const audits: any[] = [];
  const writes: any[] = [];
  const reclaims: any[] = [];
  let existing: any = options.existingMessage ?? null;

  const prisma = {
    integration: {
      findUnique: async ({ where }: any) =>
        where.inboundTokenHash === HASH
          ? {
              id: 'int_1',
              tenantId: 't1',
              name: 'Partner',
              status: options.status ?? 'ENABLED',
              config,
              tenant: { status: options.tenantStatus ?? 'ACTIVE' },
            }
          : null,
    },
    inboundMessage: {
      findFirst: async () => existing,
      create: async ({ data }: any) => {
        const row = { id: `inb_${messages.length + 1}`, ...data };
        messages.push(row);
        existing = row;
        return { id: row.id };
      },
      update: async ({ where, data }: any) => {
        const row = messages.find((m) => m.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        reclaims.push({ where, data });
        const count = options.reclaimCount ?? 1;
        if (count > 0 && existing) {
          existing = { ...existing, updatedAt: new Date() };
          messages.push({ ...existing });
        }
        return { count };
      },
    },
  } as unknown as PrismaService;

  const crypto = {
    decryptJson: (value: unknown) => value as Record<string, unknown>,
  } as unknown as CryptoService;

  const modulesCache = {
    getEnabledKeys: async () =>
      new Set(options.enabledModules ?? ['core', 'transportation', 'wms']),
  } as unknown as TenantModulesCacheService;

  const writer = {
    writeHookTarget: async (principal: any, targetKey: string, data: any) => {
      writes.push({ principal, targetKey, data });
      if (options.writeFails) throw new Error(options.writeFails);
      return {
        entityType: 'customer',
        entityId: 'cus_1',
        created: true,
        summary: 'Client ACME',
      };
    },
  } as unknown as ConnectRecordWriter;

  const audit = {
    log: async (entry: any) => {
      audits.push(entry);
    },
  } as unknown as AuditLogsService;

  const apiKeys = {
    ensureServiceUser: async () => 'svc_user_1',
  } as unknown as ApiKeysService;

  // The EDI plane is only reached when config.format === 'x12' (own spec file).
  const edi = {
    processDelivery: async () => ({ status: 'IMPORTED', summary: 'edi' }),
  } as unknown as EdiService;

  return {
    svc: new InboundHooksService(prisma, crypto, modulesCache, writer, audit, apiKeys, edi),
    messages,
    audits,
    writes,
    reclaims,
  };
}

const rawOf = (body: unknown) => Buffer.from(JSON.stringify(body), 'utf-8');

describe('InboundHooksService — token resolution', () => {
  it('resolves the receiver by the sha256 of the presented token', async () => {
    const { svc, writes } = harness();
    const body = { code: 'ACME', name: 'Acme' };
    const res = await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(res.status).toBe('IMPORTED');
    expect(writes).toHaveLength(1);
    expect(writes[0].targetKey).toBe('customer.upsert');
  });

  it('answers a generic 404 for an unknown token', async () => {
    const { svc } = harness();
    await expect(
      svc.receive({ token: 'nope'.padEnd(40, 'y'), body: {}, rawBody: rawOf({}) }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers the SAME 404 for a disabled integration (no existence leak)', async () => {
    const { svc } = harness({ status: 'DISABLED' });
    await expect(svc.receive({ token: TOKEN, body: {}, rawBody: rawOf({}) })).rejects.toThrow(
      'Unknown inbound hook',
    );
  });

  it('rejects a receiver whose configured target is unknown', async () => {
    const { svc } = harness({ config: { target: 'invoice.pay' } });
    await expect(
      svc.receive({ token: TOKEN, body: {}, rawBody: rawOf({}) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InboundHooksService — HMAC', () => {
  const body = { code: 'ACME', name: 'Acme' };
  const raw = rawOf(body);
  const secret = 's3cr3t';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');

  it('accepts a valid sha256= signature', async () => {
    const { svc } = harness({ config: { target: 'customer.upsert', inboundSecret: secret } });
    const res = await svc.receive({
      token: TOKEN,
      body,
      rawBody: raw,
      signature: `sha256=${signature}`,
    });
    expect(res.status).toBe('IMPORTED');
  });

  it('rejects a wrong signature with 401', async () => {
    const { svc } = harness({ config: { target: 'customer.upsert', inboundSecret: secret } });
    await expect(
      svc.receive({ token: TOKEN, body, rawBody: raw, signature: 'sha256=deadbeef' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing signature when the receiver declares a secret', async () => {
    const { svc } = harness({ config: { target: 'customer.upsert', inboundSecret: secret } });
    await expect(svc.receive({ token: TOKEN, body, rawBody: raw })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('signature over the RAW bytes, not a re-serialization', async () => {
    const { svc } = harness({ config: { target: 'customer.upsert', inboundSecret: secret } });
    const spaced = Buffer.from(JSON.stringify(body, null, 2), 'utf-8');
    const spacedSig = createHmac('sha256', secret).update(spaced).digest('hex');
    // The compact signature must NOT validate the pretty-printed bytes.
    await expect(
      svc.receive({ token: TOKEN, body, rawBody: spaced, signature: `sha256=${signature}` }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const ok = await svc.receive({
      token: TOKEN,
      body,
      rawBody: spaced,
      signature: `sha256=${spacedSig}`,
    });
    expect(ok.status).toBe('IMPORTED');
  });

  it('skips verification when no secret is configured', async () => {
    const { svc } = harness();
    const res = await svc.receive({ token: TOKEN, body, rawBody: raw });
    expect(res.status).toBe('IMPORTED');
  });
});

describe('InboundHooksService — module gate (rule 15)', () => {
  it('403 when the target module is not enabled for the tenant', async () => {
    const { svc } = harness({
      config: { target: 'item.upsert' },
      enabledModules: ['core', 'transportation'],
    });
    await expect(
      svc.receive({ token: TOKEN, body: { sku: 'A' }, rawBody: rawOf({ sku: 'A' }) }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a core target (location.upsert) is never module-gated', async () => {
    const { svc, writes } = harness({
      config: { target: 'location.upsert' },
      enabledModules: ['core'],
    });
    const body = { code: 'L1', name: 'Dépôt', type: 'WAREHOUSE' };
    const res = await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(res.status).toBe('IMPORTED');
    expect(writes[0].targetKey).toBe('location.upsert');
  });
});

describe('InboundHooksService — idempotency', () => {
  it('returns the ORIGINAL result without re-executing the write', async () => {
    const { svc, writes } = harness({
      existingMessage: {
        id: 'inb_prev',
        status: 'IMPORTED',
        error: null,
        refType: 'customer',
        refId: 'cus_9',
      },
    });
    const res = await svc.receive({
      token: TOKEN,
      body: { code: 'ACME' },
      rawBody: rawOf({ code: 'ACME' }),
      idempotencyKey: 'delivery-1',
    });
    expect(res).toEqual({
      inboxId: 'inb_prev',
      status: 'IMPORTED',
      entityType: 'customer',
      entityId: 'cus_9',
      replayed: true,
    });
    expect(writes).toHaveLength(0);
  });

  it('defaults the dedup key to the sha256 of the raw body', async () => {
    const body = { code: 'ACME' };
    const { svc, messages } = harness();
    await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(messages[0].dedupKey).toBe(createHash('sha256').update(rawOf(body)).digest('hex'));
  });

  it('prefers the X-Idempotency-Key header when present', async () => {
    const { svc, messages } = harness();
    await svc.receive({
      token: TOKEN,
      body: { code: 'ACME' },
      rawBody: rawOf({ code: 'ACME' }),
      idempotencyKey: 'delivery-42',
    });
    expect(messages[0].dedupKey).toBe('delivery-42');
  });
});

describe('InboundHooksService — write path', () => {
  it('acts as the tenant service-account scoped to the target permission (rule 13)', async () => {
    const { svc, writes, audits } = harness();
    await svc.receive({
      token: TOKEN,
      body: { code: 'ACME' },
      rawBody: rawOf({ code: 'ACME' }),
    });
    expect(writes[0].principal).toEqual({
      id: 'svc_user_1',
      tenantId: 't1',
      permissions: ['transportation.master-data.manage'],
    });
    expect(audits[0]).toMatchObject({
      tenantId: 't1',
      userId: 'svc_user_1',
      entityType: 'inbound-message',
    });
  });

  it('applies config.mappings (strict) before the write', async () => {
    const { svc, writes } = harness({
      config: {
        target: 'customer.upsert',
        mappings: [
          { source: 'partner.id', target: 'code', transform: 'uppercase' },
          { source: 'partner.label', target: 'name', transform: 'trim' },
        ],
      },
    });
    const body = { partner: { id: 'acme', label: '  Acme Inc  ' }, secret: 'nope' };
    await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(writes[0].data).toEqual({ code: 'ACME', name: 'Acme Inc' });
  });

  it('records FAILED (not a throw) when the mapping uses an unknown transform', async () => {
    const { svc, messages } = harness({
      config: {
        target: 'customer.upsert',
        mappings: [{ source: 'a', target: 'code', transform: 'enum.map' }],
      },
    });
    const res = await svc.receive({ token: TOKEN, body: { a: 'x' }, rawBody: rawOf({ a: 'x' }) });
    expect(res.status).toBe('FAILED');
    expect(res.error).toContain('Unknown transform');
    expect(messages[0].status).toBe('FAILED');
  });

  it('records FAILED with the business error when the write throws', async () => {
    const { svc, messages, audits } = harness({ writeFails: 'Customer code required' });
    const res = await svc.receive({ token: TOKEN, body: {}, rawBody: rawOf({}) });
    expect(res).toMatchObject({ status: 'FAILED', error: 'Customer code required' });
    expect(messages[0].status).toBe('FAILED');
    expect(audits[0].after.status).toBe('FAILED');
  });

  it('rejects a non-object body', async () => {
    const { svc } = harness();
    await expect(
      svc.receive({ token: TOKEN, body: [1, 2], rawBody: rawOf([1, 2]) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a redacted payload copy in the inbox row', async () => {
    const { svc, messages } = harness();
    const body = { code: 'ACME', apiKey: 'super-secret', nested: { password: 'p' } };
    await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(messages[0].parsed.payload).toEqual({
      code: 'ACME',
      apiKey: '***',
      nested: { password: '***' },
    });
  });
});

describe('InboundHooksService — stuck RECEIVED rows', () => {
  const body = { code: 'ACME' };
  const stuck = (ageMs: number) => ({
    id: 'inb_stuck',
    status: 'RECEIVED',
    error: null,
    refType: null,
    refId: null,
    updatedAt: new Date(Date.now() - ageMs),
  });

  it('re-processes a row left RECEIVED by a crashed attempt (> 2 min)', async () => {
    const { svc, writes, reclaims } = harness({ existingMessage: stuck(5 * 60_000) });
    const res = await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(res).toMatchObject({ inboxId: 'inb_stuck', status: 'IMPORTED' });
    expect(res.replayed).toBeUndefined();
    expect(writes).toHaveLength(1);
    // Conditional claim so two concurrent replays cannot both re-run the write.
    expect(reclaims[0].where).toMatchObject({ id: 'inb_stuck', status: 'RECEIVED' });
    expect(reclaims[0].where.updatedAt.lte).toBeInstanceOf(Date);
  });

  it('answers RECEIVED without touching a fresh in-flight row (< 2 min)', async () => {
    const { svc, writes, reclaims } = harness({ existingMessage: stuck(10_000) });
    const res = await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(res).toEqual({ inboxId: 'inb_stuck', status: 'RECEIVED' });
    expect(writes).toHaveLength(0);
    expect(reclaims).toHaveLength(0);
  });

  it('answers RECEIVED when another replay won the re-claim race', async () => {
    const { svc, writes } = harness({
      existingMessage: stuck(5 * 60_000),
      reclaimCount: 0,
    });
    const res = await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
    expect(res).toEqual({ inboxId: 'inb_stuck', status: 'RECEIVED' });
    expect(writes).toHaveLength(0);
  });

  it('a replay reports the REAL stored status, never a collapsed FAILED', async () => {
    for (const status of ['IMPORTED', 'FAILED', 'IGNORED', 'PARSED']) {
      const { svc } = harness({
        existingMessage: {
          id: 'inb_prev',
          status,
          error: status === 'FAILED' ? 'boom' : null,
          refType: null,
          refId: null,
          updatedAt: new Date(),
        },
      });
      const res = await svc.receive({ token: TOKEN, body, rawBody: rawOf(body) });
      expect(res.status).toBe(status);
      expect(res.replayed).toBe(true);
    }
  });
});

describe('InboundHooksService — tenant status', () => {
  it('a SUSPENDED tenant keeps no write surface (generic 404)', async () => {
    const { svc } = harness({ tenantStatus: 'SUSPENDED' });
    await expect(
      svc.receive({ token: TOKEN, body: { code: 'A' }, rawBody: rawOf({ code: 'A' }) }),
    ).rejects.toThrow('Unknown inbound hook');
  });

  it('a TRIAL tenant is live (same convention as AuthService)', async () => {
    const { svc } = harness({ tenantStatus: 'TRIAL' });
    const res = await svc.receive({
      token: TOKEN,
      body: { code: 'A' },
      rawBody: rawOf({ code: 'A' }),
    });
    expect(res.status).toBe('IMPORTED');
  });
});

describe('InboundHooksService — prototype pollution', () => {
  it('records FAILED and never pollutes Object.prototype', async () => {
    const { svc, messages, writes } = harness({
      config: {
        target: 'customer.upsert',
        mappings: [{ source: 'a', target: '__proto__.polluted' }],
      },
    });
    const res = await svc.receive({
      token: TOKEN,
      body: { a: 'boom' },
      rawBody: rawOf({ a: 'boom' }),
    });
    expect(res.status).toBe('FAILED');
    expect(res.error).toContain('Unsafe mapping target');
    expect(messages[0].status).toBe('FAILED');
    expect(writes).toHaveLength(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('redactStoredPayload', () => {
  it('masks secret-looking keys at any depth', () => {
    expect(
      redactStoredPayload({ a: 1, token: 'x', deep: { authorization: 'Bearer y', ok: 2 } }),
    ).toEqual({ a: 1, token: '***', deep: { authorization: '***', ok: 2 } });
  });

  it('caps an oversized payload', () => {
    const big = { blob: 'x'.repeat(20_000) };
    const out = redactStoredPayload(big) as { truncated: boolean; preview: string };
    expect(out.truncated).toBe(true);
    expect(out.preview.length).toBe(8 * 1024);
  });
});
