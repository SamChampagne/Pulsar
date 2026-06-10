# Phase 6A — CryptoService & durcissement SOC2 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiffrer les secrets au repos (AES-256-GCM, format `enc:v1:`), livrer le script de rechiffrement qui rend la rotation de clé exécutable, documenter les runbooks, et produire le doc de découverte Fleet.

**Architecture:** Primitives crypto pures (`crypto.util.ts`, testables sans Nest) + `CryptoService` injectable qui valide `ENCRYPTION_KEY` au boot (constructeur → l'API refuse de démarrer sans clé valide). `Integration.config` est chiffré à l'écriture (la colonne Json stocke alors une *string* `enc:v1:...`), déchiffré en interne (webhooks), masqué dans les réponses API. Migration lazy : les lignes en clair restent lisibles (passthrough) jusqu'à réécriture ou passage du script.

**Tech Stack:** NestJS 11, node:crypto (AES-256-GCM), Prisma, jest (nouvelle config unitaire API), tsx pour le script CLI.

**Référence spec:** `docs/superpowers/specs/2026-06-10-phase-6-commercial-readiness-design.md` section 4 + section 5 (Fleet doc).

**Dépendances:** aucune. Les plans B/C/D peuvent suivre ; le plan C (OIDC) consomme `CryptoService` et étendra le script de rechiffrement à `Tenant.authConfig`.

---

### Task 1: Infra de tests unitaires API (jest)

L'API n'a qu'une config jest e2e (`test/jest-e2e.json`). On ajoute une config unitaire qui ramasse `src/**/*.spec.ts`, et un script `test` (le `pnpm test` racine est `pnpm -r --if-present test`, il le ramassera automatiquement).

**Files:**
- Create: `apps/api/test/jest-unit.json`
- Modify: `apps/api/package.json` (scripts)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Créer la config jest unitaire**

`apps/api/test/jest-unit.json` :

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "../src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": {
    "^.+\\.ts$": ["ts-jest", { "tsconfig": "<rootDir>/../tsconfig.json" }]
  },
  "testEnvironment": "node"
}
```

- [ ] **Step 2: Ajouter le script `test` à l'API**

Dans `apps/api/package.json`, section `scripts`, ajouter après `"typecheck"` :

```json
"test": "jest --config test/jest-unit.json",
```

- [ ] **Step 3: Vérifier que jest tourne (0 test = exit 0 attendu via passWithNoTests)**

Ajuster le script si nécessaire : `"test": "jest --config test/jest-unit.json --passWithNoTests"`.

Run: `pnpm --filter @pulsar/api test`
Expected: `No tests found, exiting with code 0`

- [ ] **Step 4: Ajouter l'étape CI**

Dans `.github/workflows/ci.yml`, après l'étape `Unit tests (shared)`, ajouter :

```yaml
      - name: Unit tests (api)
        run: pnpm --filter @pulsar/api test
```

Et dans le bloc `env:` du job (à côté de `JWT_SECRET`), ajouter :

```yaml
      ENCRYPTION_KEY: 1qK0pZ8Yw3mB6dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4=
```

(clé CI uniquement — 32 octets base64 ; toute valeur base64 de 32 octets convient.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/jest-unit.json apps/api/package.json .github/workflows/ci.yml
git commit -m "test(api): jest unit config + CI step"
```

---

### Task 2: Primitives crypto pures (TDD)

**Files:**
- Create: `apps/api/src/core/crypto/crypto.util.ts`
- Test: `apps/api/src/core/crypto/crypto.util.spec.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/api/src/core/crypto/crypto.util.spec.ts` :

```ts
import {
  decryptValue,
  encryptValue,
  isEncrypted,
  parseEncryptionKey,
} from './crypto.util';

const KEY = parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'));

describe('crypto.util', () => {
  it('round-trips a value', () => {
    const encrypted = encryptValue(KEY, '{"secret":"hunter2"}');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decryptValue(KEY, encrypted)).toBe('{"secret":"hunter2"}');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptValue(KEY, 'x')).not.toBe(encryptValue(KEY, 'x'));
  });

  it('passes plaintext through decrypt unchanged (legacy rows)', () => {
    expect(decryptValue(KEY, 'not-encrypted')).toBe('not-encrypted');
    expect(isEncrypted('not-encrypted')).toBe(false);
  });

  it('rejects a tampered ciphertext (GCM auth)', () => {
    const encrypted = encryptValue(KEY, 'payload');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => decryptValue(KEY, tampered)).toThrow();
  });

  it('rejects a wrong key', () => {
    const other = parseEncryptionKey(Buffer.alloc(32, 9).toString('base64'));
    const encrypted = encryptValue(KEY, 'payload');
    expect(() => decryptValue(other, encrypted)).toThrow();
  });

  it('parseEncryptionKey rejects missing or short keys', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY/);
    expect(() => parseEncryptionKey('dG9vLXNob3J0')).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — `Cannot find module './crypto.util'`

- [ ] **Step 3: Implémenter**

`apps/api/src/core/crypto/crypto.util.ts` :

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Encrypted-at-rest format: enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64> */
const PREFIX = 'enc:v1:';

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is required (32 bytes, base64). Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256-GCM).');
  }
  return key;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptValue(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Values without the enc:v1: prefix are legacy plaintext and pass through unchanged. */
export function decryptValue(key: Buffer, value: string): string {
  if (!isEncrypted(value)) return value;
  const [iv, tag, ciphertext] = value.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/crypto/
git commit -m "feat(api): AES-256-GCM crypto primitives (enc:v1 format)"
```

---

### Task 3: CryptoService + CryptoModule (validation au boot)

Le constructeur appelle `parseEncryptionKey` : si la clé manque ou est invalide, Nest échoue à l'instanciation → l'API refuse de démarrer (exigence du spec).

**Files:**
- Create: `apps/api/src/core/crypto/crypto.service.ts`
- Create: `apps/api/src/core/crypto/crypto.module.ts`
- Test: `apps/api/src/core/crypto/crypto.service.spec.ts`
- Modify: `.env.example`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/core/crypto/crypto.service.spec.ts` :

```ts
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const configWith = (key: string | undefined) =>
  ({ get: () => key }) as unknown as ConfigService;

const VALID_KEY = Buffer.alloc(32, 5).toString('base64');

describe('CryptoService', () => {
  it('refuses to construct without a valid key (API must not boot)', () => {
    expect(() => new CryptoService(configWith(undefined))).toThrow(/ENCRYPTION_KEY/);
    expect(() => new CryptoService(configWith('bm90LTMyLWJ5dGVz'))).toThrow(/32 bytes/);
  });

  it('round-trips JSON configs', () => {
    const service = new CryptoService(configWith(VALID_KEY));
    const stored = service.encryptJson({ url: 'https://x', secret: 's3cret' });
    expect(typeof stored).toBe('string');
    expect(service.decryptJson(stored)).toEqual({ url: 'https://x', secret: 's3cret' });
  });

  it('decryptJson passes legacy plain objects through', () => {
    const service = new CryptoService(configWith(VALID_KEY));
    expect(service.decryptJson({ url: 'https://x' })).toEqual({ url: 'https://x' });
    expect(service.decryptJson(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — `Cannot find module './crypto.service'`

- [ ] **Step 3: Implémenter service + module**

`apps/api/src/core/crypto/crypto.service.ts` :

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptValue, encryptValue, isEncrypted, parseEncryptionKey } from './crypto.util';

/**
 * Secrets-at-rest encryption (AES-256-GCM, format enc:v1:...).
 * The key is validated in the constructor: the API refuses to boot without a
 * valid ENCRYPTION_KEY — same fail-fast posture as JWT_SECRET (getOrThrow).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = parseEncryptionKey(config.get<string>('ENCRYPTION_KEY'));
  }

  encryptString(plain: string): string {
    return encryptValue(this.key, plain);
  }

  decryptString(value: string): string {
    return decryptValue(this.key, value);
  }

  encryptJson(value: Record<string, unknown>): string {
    return encryptValue(this.key, JSON.stringify(value));
  }

  /** Accepts enc:v1 strings, legacy plain objects, or null/undefined. */
  decryptJson<T = Record<string, unknown>>(stored: unknown): T {
    if (isEncrypted(stored)) {
      return JSON.parse(decryptValue(this.key, stored)) as T;
    }
    return (stored ?? {}) as T;
  }
}
```

`apps/api/src/core/crypto/crypto.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS

- [ ] **Step 5: Documenter la clé dans `.env.example`**

Dans `.env.example`, après le bloc `# --- Auth ---`, ajouter :

```
# --- Secrets at rest ---
# 32 bytes, base64. The API refuses to start without it.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=q8mB3dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4wY6zI1tQ=
```

Mettre aussi à jour le `.env` local de la même façon (sinon `pnpm dev` ne démarre plus après la Task 4).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/crypto/ .env.example
git commit -m "feat(api): CryptoService with boot-time ENCRYPTION_KEY validation"
```

---

### Task 4: Chiffrer Integration.config (écriture, lecture interne, masquage API)

**Files:**
- Modify: `apps/api/src/core/integrations/integrations.service.ts`
- Modify: `apps/api/src/core/integrations/integrations.module.ts` (import CryptoModule)
- Modify: `apps/api/src/core/integrations/webhooks.service.ts` (déchiffrer avant usage)
- Test: `apps/api/src/core/integrations/integrations-config.spec.ts`

- [ ] **Step 1: Écrire le test du masquage/round-trip (il échoue)**

`apps/api/src/core/integrations/integrations-config.spec.ts` :

```ts
import { maskConfig, mergePreservingMasked } from './integrations.service';

describe('integration config masking', () => {
  it('masks sensitive keys, keeps the rest', () => {
    expect(maskConfig({ url: 'https://x', secret: 's3cret', apiToken: 't' })).toEqual({
      url: 'https://x',
      secret: '***',
      apiToken: '***',
    });
  });

  it('keeps empty sensitive values untouched (no fake ***)', () => {
    expect(maskConfig({ secret: '' })).toEqual({ secret: '' });
  });

  it('mergePreservingMasked keeps the stored secret when the client sends ***', () => {
    const stored = { url: 'https://old', secret: 's3cret' };
    const incoming = { url: 'https://new', secret: '***' };
    expect(mergePreservingMasked(incoming, stored)).toEqual({
      url: 'https://new',
      secret: 's3cret',
    });
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — `maskConfig` n'existe pas

- [ ] **Step 3: Implémenter dans IntegrationsService**

Remplacer `apps/api/src/core/integrations/integrations.service.ts` par :

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

export interface UpsertIntegrationInput {
  key: string;
  name: string;
  config?: Record<string, unknown>;
  status?: 'DISABLED' | 'ENABLED' | 'ERROR';
}

const SENSITIVE_KEY = /secret|password|token|key/i;
const MASK = '***';

/** API responses never expose secret values — they are replaced by "***". */
export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([k, v]) => [k, SENSITIVE_KEY.test(k) && v ? MASK : v]),
  );
}

/** A client echoing back "***" means "keep the stored secret unchanged". */
export function mergePreservingMasked(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(incoming).map(([k, v]) => [k, v === MASK ? stored[k] : v]),
  );
}

/**
 * Integration *configuration* registry (EDI, telematics, ERP connectors...).
 * Configs are encrypted at rest (enc:v1 string in the Json column); legacy
 * plaintext rows are read transparently and re-encrypted on next write
 * (see apps/api/scripts/reencrypt-secrets.ts for the batch path).
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Internal consumers (webhooks) get the decrypted config. */
  decryptedConfig<T = Record<string, unknown>>(stored: unknown): T {
    return this.crypto.decryptJson<T>(stored);
  }

  private present(integration: { config: unknown } & Record<string, unknown>) {
    return { ...integration, config: maskConfig(this.crypto.decryptJson(integration.config)) };
  }

  async list(tenantId: string) {
    const rows = await this.prisma.integration.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.present(row));
  }

  async create(tenantId: string, input: UpsertIntegrationInput) {
    const existing = await this.prisma.integration.findUnique({
      where: { tenantId_key: { tenantId, key: input.key } },
    });
    if (existing) throw new ConflictException(`Integration "${input.key}" already exists`);
    const created = await this.prisma.integration.create({
      data: {
        tenantId,
        key: input.key,
        name: input.name,
        status: input.status ?? 'DISABLED',
        config: this.crypto.encryptJson(input.config ?? {}) as Prisma.InputJsonValue,
      },
    });
    return this.present(created);
  }

  async update(tenantId: string, id: string, input: Partial<UpsertIntegrationInput>) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    const stored = this.crypto.decryptJson(integration.config);
    const updated = await this.prisma.integration.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        ...(input.config
          ? {
              config: this.crypto.encryptJson(
                mergePreservingMasked(input.config, stored),
              ) as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    return this.present(updated);
  }

  async listDeliveries(tenantId: string, integrationId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return this.prisma.webhookDelivery.findMany({
      where: { tenantId, integrationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
```

- [ ] **Step 4: Déchiffrer dans WebhooksService**

Dans `apps/api/src/core/integrations/webhooks.service.ts` :

1. Ajouter l'import et l'injection :

```ts
import { CryptoService } from '../crypto/crypto.service';
// ...
constructor(
  private readonly prisma: PrismaService,
  private readonly crypto: CryptoService,
) {}
```

2. Dans `emit()`, remplacer la ligne `const config = hook.config as WebhookConfig;` par :

```ts
const config = this.crypto.decryptJson<WebhookConfig>(hook.config);
```

3. Dans `attempt()`, remplacer `const config = delivery.integration.config as WebhookConfig;` par :

```ts
const config = this.crypto.decryptJson<WebhookConfig>(delivery.integration.config);
```

- [ ] **Step 5: Importer CryptoModule dans IntegrationsModule**

Dans `apps/api/src/core/integrations/integrations.module.ts`, ajouter `CryptoModule` au tableau `imports` :

```ts
import { CryptoModule } from '../crypto/crypto.module';
// dans @Module({ imports: [...] }) :
imports: [CryptoModule /* , ...imports existants */],
```

(Conserver les imports existants du module tels quels.)

- [ ] **Step 6: Tests + build**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS

Run: `pnpm --filter @pulsar/api typecheck`
Expected: exit 0

- [ ] **Step 7: Vérification e2e manuelle rapide (DB seedée requise)**

Run: `pnpm test:e2e`
Expected: les suites existantes passent (aucune ne lit `config` en clair côté API ; les webhooks des suites passent car `decryptJson` accepte l'ancien format).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/core/integrations/
git commit -m "feat(api): encrypt Integration.config at rest, mask secrets in responses"
```

---

### Task 5: Script de rechiffrement (rotation + chiffrement initial)

Logique testable exportée dans `src`, CLI mince dans `scripts/`. Couvre `Integration.config` ; le plan C (OIDC) ajoutera `Tenant.authConfig` à `RE_ENCRYPT_TARGETS` — un commentaire le balise.

**Files:**
- Create: `apps/api/src/core/crypto/reencrypt.ts`
- Create: `apps/api/scripts/reencrypt-secrets.ts`
- Test: `apps/api/src/core/crypto/reencrypt.spec.ts`
- Modify: `apps/api/package.json` (script + devDependency `tsx`)

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/core/crypto/reencrypt.spec.ts` :

```ts
import { decryptValue, encryptValue, isEncrypted, parseEncryptionKey } from './crypto.util';
import { reencryptIntegrations } from './reencrypt';

const OLD = parseEncryptionKey(Buffer.alloc(32, 1).toString('base64'));
const NEW = parseEncryptionKey(Buffer.alloc(32, 2).toString('base64'));

function fakePrisma(rows: { id: string; config: unknown }[]) {
  const updates: { id: string; config: string }[] = [];
  return {
    updates,
    integration: {
      findMany: async () => rows,
      update: async ({ where, data }: { where: { id: string }; data: { config: string } }) => {
        updates.push({ id: where.id, config: data.config });
      },
    },
  };
}

describe('reencryptIntegrations', () => {
  it('re-encrypts encrypted rows with the new key', async () => {
    const prisma = fakePrisma([{ id: 'a', config: encryptValue(OLD, '{"secret":"s"}') }]);
    const count = await reencryptIntegrations(prisma as never, OLD, NEW);
    expect(count).toBe(1);
    expect(decryptValue(NEW, prisma.updates[0].config)).toBe('{"secret":"s"}');
  });

  it('encrypts legacy plaintext rows (initial sweep)', async () => {
    const prisma = fakePrisma([{ id: 'b', config: { url: 'https://x' } }]);
    await reencryptIntegrations(prisma as never, null, NEW);
    expect(isEncrypted(prisma.updates[0].config)).toBe(true);
    expect(decryptValue(NEW, prisma.updates[0].config)).toBe('{"url":"https://x"}');
  });

  it('fails loudly when a row is encrypted but no old key is provided', async () => {
    const prisma = fakePrisma([{ id: 'c', config: encryptValue(OLD, '{}') }]);
    await expect(reencryptIntegrations(prisma as never, null, NEW)).rejects.toThrow(
      /ENCRYPTION_KEY_OLD/,
    );
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — `./reencrypt` n'existe pas

- [ ] **Step 3: Implémenter la logique**

`apps/api/src/core/crypto/reencrypt.ts` :

```ts
import type { PrismaClient } from '@pulsar/database';
import { decryptValue, encryptValue, isEncrypted } from './crypto.util';

/**
 * Re-encrypts every Integration.config with `newKey`.
 * - enc:v1 rows are decrypted with `oldKey` first (rotation);
 * - plaintext rows are simply encrypted (initial sweep after enabling at-rest encryption).
 * NOTE(plan 6C): when Tenant.authConfig lands (OIDC), add a reencryptAuthConfigs()
 * sibling here and call it from scripts/reencrypt-secrets.ts.
 */
export async function reencryptIntegrations(
  prisma: PrismaClient,
  oldKey: Buffer | null,
  newKey: Buffer,
): Promise<number> {
  const rows = await prisma.integration.findMany();
  let updated = 0;
  for (const row of rows) {
    let plain: string;
    if (isEncrypted(row.config)) {
      if (!oldKey) {
        throw new Error(
          `Integration ${row.id} is encrypted but ENCRYPTION_KEY_OLD is not set`,
        );
      }
      plain = decryptValue(oldKey, row.config);
    } else {
      plain = JSON.stringify(row.config ?? {});
    }
    await prisma.integration.update({
      where: { id: row.id },
      data: { config: encryptValue(newKey, plain) },
    });
    updated++;
  }
  return updated;
}
```

`apps/api/scripts/reencrypt-secrets.ts` :

```ts
/**
 * Key rotation / initial encryption sweep.
 * Usage:
 *   ENCRYPTION_KEY=<new> [ENCRYPTION_KEY_OLD=<old>] pnpm --filter @pulsar/api reencrypt-secrets
 * Without ENCRYPTION_KEY_OLD, only plaintext rows are encrypted (initial sweep);
 * already-encrypted rows then cause a loud failure instead of silent corruption.
 */
import { PrismaClient } from '@pulsar/database';
import { parseEncryptionKey } from '../src/core/crypto/crypto.util';
import { reencryptIntegrations } from '../src/core/crypto/reencrypt';

async function main() {
  const newKey = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  const oldKey = process.env.ENCRYPTION_KEY_OLD
    ? parseEncryptionKey(process.env.ENCRYPTION_KEY_OLD)
    : null;
  const prisma = new PrismaClient();
  try {
    const count = await reencryptIntegrations(prisma, oldKey, newKey);
    console.log(`Re-encrypted ${count} integration config(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
```

- [ ] **Step 4: Ajouter le script et tsx**

Dans `apps/api/package.json` :
- `scripts` : ajouter `"reencrypt-secrets": "tsx scripts/reencrypt-secrets.ts"`
- `devDependencies` : ajouter `"tsx": "^4.19.0"`

Run: `pnpm install`

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/crypto/reencrypt.ts apps/api/src/core/crypto/reencrypt.spec.ts apps/api/scripts/ apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): reencrypt-secrets script (key rotation + initial sweep)"
```

---

### Task 6: Runbooks (rotation JWT_SECRET / ENCRYPTION_KEY, backup/restore)

**Files:**
- Create: `docs/runbooks.md`

- [ ] **Step 1: Écrire le runbook**

`docs/runbooks.md` avec exactement ces trois sections :

```markdown
# Runbooks — opérations Pulsar

## Rotation de JWT_SECRET

Effet : tous les access tokens en circulation deviennent invalides immédiatement ;
les refresh tokens (opaques, hashés en base) restent valides — les clients web se
re-authentifient de façon transparente au prochain refresh.

1. Générer le nouveau secret : `openssl rand -base64 48`.
2. Mettre à jour `JWT_SECRET` dans l'environnement de l'API.
3. Redémarrer l'API (toutes les instances en même temps si plusieurs).
4. Vérifier : un login fonctionne ; un vieux token Bearer est rejeté en 401 puis
   rafraîchi automatiquement par le client web.

À rotationner immédiatement si : fuite suspectée, départ d'une personne ayant eu
accès à l'environnement de production.

## Rotation de ENCRYPTION_KEY (secrets au repos)

Les secrets chiffrés (Integration.config, OIDC clientSecret) portent le préfixe
`enc:v1:`. La rotation est un rechiffrement en place via le script dédié.

1. Générer la nouvelle clé :
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Arrêter les écritures de configs (fenêtre courte ; les lectures continuent).
3. Lancer :
   `ENCRYPTION_KEY=<nouvelle> ENCRYPTION_KEY_OLD=<ancienne> pnpm --filter @pulsar/api reencrypt-secrets`
4. Mettre à jour `ENCRYPTION_KEY` dans l'environnement de l'API ; supprimer
   `ENCRYPTION_KEY_OLD`.
5. Redémarrer l'API.
6. Vérifier : la page Integrations s'affiche (déchiffrement OK), un webhook part
   signé (le secret est lisible).

Premier passage (chiffrement initial des lignes encore en clair) : même commande
sans `ENCRYPTION_KEY_OLD`.

## Backup / restore PostgreSQL

Sauvegarde quotidienne minimale :

    pg_dump --format=custom --no-owner "$DATABASE_URL" > pulsar-$(date +%F).dump

Restauration :

    createdb pulsar_restore
    pg_restore --no-owner --dbname=pulsar_restore pulsar-YYYY-MM-DD.dump

Points d'attention :
- La base contient des secrets chiffrés : **sans l'ENCRYPTION_KEY correspondante,
  un dump restauré a des configs illisibles.** Sauvegarder la clé séparément
  (gestionnaire de secrets), jamais dans le même stockage que les dumps.
- Le stockage fichiers (POD, documents) est hors base : sauvegarder le bucket S3
  ou le répertoire `STORAGE_LOCAL_DIR` avec la même rétention.
- Tester la restauration au moins une fois par trimestre (monter `pulsar_restore`,
  lancer l'API dessus en local, vérifier login + une page de données).
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks.md
git commit -m "docs: runbooks (JWT/encryption key rotation, backup/restore)"
```

---

### Task 7: Doc de découverte du module Fleet

**Files:**
- Create: `docs/fleet-module-discovery.md`

- [ ] **Step 1: Écrire le doc de découverte**

`docs/fleet-module-discovery.md` — structure imposée (contenu à rédiger en s'appuyant sur l'existant : `Vehicle`/`Trailer`/`Driver` avec `carrierId` nullable = flotte interne, `AssetStatus.MAINTENANCE` existant, clé `fleet` réservée dans `MODULE_CATALOG` avec `available: false`) :

1. **Périmètre proposé** : registre d'actifs interne (étend Vehicle/Trailer, n'en duplique pas), maintenance préventive par échéancier (km OU temps), conformité (immatriculations, inspections, certifications avec dates d'expiration et alertes).
2. **Esquisse de modèles Prisma** : `MaintenancePlan` (assetType+assetId polymorphe ou FK doubles nullables — trancher dans le doc avec un avantage/inconvénient chacun), `MaintenanceWorkOrder` (statuts OPEN→DONE), `ComplianceItem` (type, référence, expiresAt, documentId vers `Document`).
3. **Permissions pressenties** : `fleet.assets.read/manage`, `fleet.maintenance.read/manage`, `fleet.compliance.read/manage`.
4. **Intégration à l'existant** : `AssetStatus.MAINTENANCE` piloté par les work orders ; les actifs avec `carrierId` null sont les candidats naturels ; recette « Adding a business module » du CLAUDE.md applicable telle quelle.
5. **Questions ouvertes** : coûts internes (amortissement/carburant) pour la comparaison flotte propre vs affrètement (lié à l'audit TMS §13) ; heures de service chauffeurs (hors périmètre v1 ?) ; télématique (registre Integration existant comme point d'accroche).

**Aucun code, aucune migration** — c'est un doc de cadrage pour décider du go/no-go du module.

- [ ] **Step 2: Commit**

```bash
git add docs/fleet-module-discovery.md
git commit -m "docs: fleet module discovery (scope, models sketch, open questions)"
```

---

### Task 8: Vérification finale du plan A

- [ ] **Step 1: Tout relancer**

```bash
pnpm typecheck && pnpm --filter @pulsar/api test && pnpm test
```

Expected: exit 0 partout.

- [ ] **Step 2: e2e complet (DB seedée)**

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm test:e2e
```

Expected: toutes les suites passent.

- [ ] **Step 3: Démarrage sans clé = refus**

Run (PowerShell): `$env:ENCRYPTION_KEY=''; pnpm --filter @pulsar/api dev` (interrompre après l'erreur)
Expected: échec au boot avec le message `ENCRYPTION_KEY is required`.
Restaurer ensuite la variable (fermer le shell ou la redéfinir).
