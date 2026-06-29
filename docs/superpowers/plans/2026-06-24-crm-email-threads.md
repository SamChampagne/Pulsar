# Courriel bidirectionnel + threads CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recevoir les emails entrants, les regrouper en threads rattachés aux contacts/companies/deals, et permettre la réponse (humaine + agent) au même endroit que l'envoi.

**Architecture:** Driver de réception abstrait (`ImapPollDriver` + `LogInboundDriver`) → `InboundIngestService` qui threade via headers RFC puis match `CrmContact.email` (logique de décision pure dans `@pulsar/shared`) → modèle `EmailThread` + `EmailMessage` étendu (réutilisé) → API CRM `crm/threads` (list/get/reply/link/archive) → outils agent READ + reply MUTATING via `ProposedAction` → inbox web.

**Tech Stack:** NestJS (API), Prisma/Postgres, SvelteKit (web, Svelte 5 runes), `imapflow` + `mailparser` (nouvelles deps API), `nodemailer` (existant), Vitest (shared unit), Jest+supertest (e2e).

## Global Constraints

- **R1 tenant isolation:** tout query threads/messages filtre `tenantId` issu du JWT (`@CurrentUser()`). Jamais de tenantId du body.
- **R3 enums:** `EmailThreadStatus`, `EmailDirection` vivent dans `packages/shared` ET sont mirrorés dans `schema.prisma` (mêmes valeurs). Rebuild shared + database après changement.
- **R6 audit:** thread create/link/reply/archive appellent `AuditLogsService.log()`.
- **R9 FK:** `contactId/companyId/dealId` acceptés en write vérifiés tenant-scopés avant persistance (pattern inline `findFirst({ id, tenantId })`).
- **R12 fichiers:** pièces jointes via `DocumentsService.upload/download` — jamais le FS directement.
- **R21–23 agents:** outils via le registre (`core/agents/tool-registry.ts`) ; MUTATING/SENSITIVE → `ProposedAction` (jamais exécutés dans le handler MCP) ; portée = permissions ∩ modules ∩ allowlist.
- **R25 secrets:** mot de passe IMAP chiffré via `CryptoService.encryptString`, jamais renvoyé en clair (projection masque, expose `hasImapPassword: boolean`).
- **Best-effort/isolation:** cron inbound ne throw JAMAIS, isolé par tenant (un tenant en échec n'affecte pas les autres) — même contrat que `MailService`.
- **Imports:** Prisma via `@pulsar/database`, jamais `@prisma/client`. REST sous `/api/v1/...`, listes en `Paginated<T>` (`paginationArgs`/`paginated` de `apps/api/src/common/pagination.ts`). DTO class-validator ; update DTOs via `PartialType` de `@nestjs/swagger`.
- **Web:** `ssr=false`, pattern `$state` + `$effect`-triggered `load()`, client `api<T>()` de `$lib/api/client`, erreur dans un `error` string local. Prettier seul formateur.

---

### Task 1: Helpers purs de threading + enums (`@pulsar/shared`)

**Files:**
- Create: `packages/shared/src/crm/email-thread.ts`
- Create: `packages/shared/src/crm/email-thread.spec.ts`
- Modify: `packages/shared/src/index.ts` (ajouter l'export)

**Interfaces:**
- Produces:
  - `enum EmailThreadStatus { UNLINKED='UNLINKED', LINKED='LINKED', ARCHIVED='ARCHIVED' }`
  - `enum EmailDirection { INBOUND='INBOUND', OUTBOUND='OUTBOUND' }`
  - `normalizeSubject(subject: string): string`
  - `type ThreadDecisionInput = { inReplyTo?: string | null; references?: string[]; knownMessageThreadId: string | null; matchedContact: { id: string; companyId: string | null } | null }`
  - `type ThreadDecision = { kind: 'existing'; threadId: string } | { kind: 'new-linked'; contactId: string; companyId: string | null } | { kind: 'new-unlinked' }`
  - `resolveThreadDecision(input: ThreadDecisionInput): ThreadDecision`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/crm/email-thread.spec.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeSubject,
  resolveThreadDecision,
  EmailThreadStatus,
  EmailDirection,
} from './email-thread';

describe('normalizeSubject', () => {
  it('strips re:/fwd:/fw: prefixes (case-insensitive, repeated)', () => {
    expect(normalizeSubject('Re: Hello')).toBe('hello');
    expect(normalizeSubject('FWD: Re: RE: Quote')).toBe('quote');
    expect(normalizeSubject('Fw: Devis')).toBe('devis');
    expect(normalizeSubject('  Plain  ')).toBe('plain');
    expect(normalizeSubject('')).toBe('');
  });
});

describe('resolveThreadDecision', () => {
  it('reuses an existing thread when a referenced message is known', () => {
    const d = resolveThreadDecision({
      inReplyTo: '<a@x>',
      references: ['<a@x>'],
      knownMessageThreadId: 'thr_1',
      matchedContact: { id: 'c1', companyId: 'co1' },
    });
    expect(d).toEqual({ kind: 'existing', threadId: 'thr_1' });
  });

  it('creates a linked thread when the sender matches a contact', () => {
    const d = resolveThreadDecision({
      inReplyTo: null,
      references: [],
      knownMessageThreadId: null,
      matchedContact: { id: 'c1', companyId: 'co1' },
    });
    expect(d).toEqual({ kind: 'new-linked', contactId: 'c1', companyId: 'co1' });
  });

  it('creates an unlinked thread when nothing matches', () => {
    const d = resolveThreadDecision({
      inReplyTo: null,
      references: [],
      knownMessageThreadId: null,
      matchedContact: null,
    });
    expect(d).toEqual({ kind: 'new-unlinked' });
  });

  it('enums carry the expected string values', () => {
    expect(EmailThreadStatus.UNLINKED).toBe('UNLINKED');
    expect(EmailDirection.INBOUND).toBe('INBOUND');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- email-thread`
Expected: FAIL — `Cannot find module './email-thread'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/crm/email-thread.ts

export enum EmailThreadStatus {
  UNLINKED = 'UNLINKED',
  LINKED = 'LINKED',
  ARCHIVED = 'ARCHIVED',
}

export enum EmailDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

/** Strip repeated Re:/Fwd:/Fw: prefixes, trim, lowercase — for subject-based grouping. */
export function normalizeSubject(subject: string): string {
  let s = (subject ?? '').trim();
  // Strip leading reply/forward markers, possibly stacked (Re: Fwd: ...).
  // Matches: re, fw, fwd, optionally followed by [n] / (n), then ':'.
  const prefix = /^(re|fw|fwd)(\[\d+\]|\(\d+\))?\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, '');
  return s.trim().toLowerCase();
}

export interface ThreadDecisionInput {
  inReplyTo?: string | null;
  references?: string[];
  /** threadId of any already-stored message whose messageId is referenced, else null. */
  knownMessageThreadId: string | null;
  /** Contact matched on the sender address (tenant-scoped), else null. */
  matchedContact: { id: string; companyId: string | null } | null;
}

export type ThreadDecision =
  | { kind: 'existing'; threadId: string }
  | { kind: 'new-linked'; contactId: string; companyId: string | null }
  | { kind: 'new-unlinked' };

/**
 * Pure threading decision. The caller resolves DB lookups
 * (known message thread, contact match) and feeds them here.
 */
export function resolveThreadDecision(input: ThreadDecisionInput): ThreadDecision {
  if (input.knownMessageThreadId) {
    return { kind: 'existing', threadId: input.knownMessageThreadId };
  }
  if (input.matchedContact) {
    return {
      kind: 'new-linked',
      contactId: input.matchedContact.id,
      companyId: input.matchedContact.companyId,
    };
  }
  return { kind: 'new-unlinked' };
}
```

- [ ] **Step 4: Add the export**

In `packages/shared/src/index.ts`, after the line `export * from './crm/crm.workflow';` add:

```ts
export * from './crm/email-thread';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pulsar/shared test -- email-thread`
Expected: PASS (4 tests).

- [ ] **Step 6: Rebuild shared (API consumes dist/)**

Run: `pnpm --filter @pulsar/shared build`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/crm/email-thread.ts packages/shared/src/crm/email-thread.spec.ts packages/shared/src/index.ts
git commit -m "feat(crm): pure email-thread helpers + EmailThreadStatus/EmailDirection enums"
```

---

### Task 2: Schéma Prisma — `EmailThread` + extensions `EmailMessage` + IMAP sur `TenantEmailConfig`

**Files:**
- Modify: `packages/database/prisma/schema.prisma:2737-2799` (enums + models email)

**Interfaces:**
- Produces (Prisma client): `prisma.emailThread`, `EmailMessage` champs `threadId/direction/messageId/inReplyTo/references/fromAddress`, `TenantEmailConfig` champs IMAP.

- [ ] **Step 1: Add enums after `EmailStatus` (line ~2742)**

```prisma
enum EmailThreadStatus {
  UNLINKED
  LINKED
  ARCHIVED
}

enum EmailDirection {
  INBOUND
  OUTBOUND
}
```

- [ ] **Step 2: Add IMAP fields to `TenantEmailConfig`**

Inside `model TenantEmailConfig`, after the `replyTo String?` line and before `active`:

```prisma
  // Inbound (IMAP) — password encrypted via CryptoService, never returned in clear.
  imapHost        String?
  imapPort        Int?
  imapSecure      Boolean   @default(true)
  imapUsername    String?
  imapPasswordEnc String?
  inboundActive   Boolean   @default(false)
  lastPollAt      DateTime?
  lastPollOk      Boolean?
```

- [ ] **Step 3: Extend `EmailMessage`**

Inside `model EmailMessage`, after the `agentId String?` line add:

```prisma
  threadId    String?
  direction   EmailDirection @default(OUTBOUND)
  messageId   String?
  inReplyTo   String?
  references  String?
  fromAddress String?
```

And add these indexes inside the same model (before `@@map`):

```prisma
  @@index([tenantId, threadId])
  @@index([tenantId, messageId])
```

- [ ] **Step 4: Add the `EmailThread` model (after `EmailMessage`, before `EmailAttachment`)**

```prisma
/// Conversation thread grouping inbound + outbound EmailMessage rows, linked to CRM entities.
model EmailThread {
  id            String            @id @default(cuid())
  tenantId      String
  subject       String
  subjectNorm   String
  contactId     String?
  companyId     String?
  dealId        String?
  status        EmailThreadStatus @default(UNLINKED)
  lastMessageAt DateTime
  messageCount  Int               @default(0)
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId, status, lastMessageAt])
  @@index([tenantId, contactId])
  @@index([tenantId, dealId])
  @@map("email_threads")
}
```

- [ ] **Step 5: Add the back-relation on `Tenant`**

Find `model Tenant` and add a relation field alongside the other email relations (e.g. near `emailMessages`):

```prisma
  emailThreads EmailThread[]
```

(If `EmailMessage`/`EmailTemplate` already declare `tenant Tenant @relation(...)` without an explicit back-relation array on `Tenant`, check the existing style: Prisma requires the opposite relation field. Search `EmailMessage[]` on `Tenant` — if relations are declared one-sided with `@relation` only, follow that exact pattern instead. Match what the file already does for `EmailMessage`.)

- [ ] **Step 6: Create the migration**

Run (from repo root, DB must be up — `pnpm db:up`):
```bash
pnpm db:migrate
```
When prompted for a name: `crm_email_threads`.
Expected: migration created under `packages/database/prisma/migrations/`, applied cleanly.

- [ ] **Step 7: Generate client + rebuild database package**

Run:
```bash
pnpm db:generate && pnpm --filter @pulsar/database build
```
Expected: `prisma.emailThread` available, no type errors.

- [ ] **Step 8: Verify typecheck of the database package**

Run: `pnpm --filter @pulsar/database typecheck` (or `pnpm typecheck` if no per-package script)
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(crm): EmailThread model + EmailMessage threading fields + IMAP config (migration)"
```

---

### Task 3: `EmailConfigService` — champs IMAP (chiffrement, projection, resolveInbound) + DTO + endpoint test

**Files:**
- Modify: `apps/api/src/core/email/email-config.service.ts`
- Modify: `apps/api/src/core/email/dto/email-config.dto.ts`
- Modify: `apps/api/src/core/email/email-config.controller.ts`

**Interfaces:**
- Consumes: `CryptoService.encryptString/decryptString`, `EmailService.send` (existant).
- Produces:
  - `EmailConfigProjection` += `imapHost/imapPort/imapSecure/imapUsername/inboundActive/hasImapPassword/lastPollAt/lastPollOk`
  - `EmailConfigService.resolveInbound(tenantId): Promise<ImapConfig | null>` où
    `ImapConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string }`
  - `EmailConfigService.testInbound(tenantId): Promise<{ ok: boolean; error?: string }>` (utilise le driver IMAP — injecté via setter pour éviter un cycle ; voir step)

- [ ] **Step 1: Extend the DTO**

In `apps/api/src/core/email/dto/email-config.dto.ts`, add to `UpsertEmailConfigDto` (mirror the existing optional-string fields with class-validator decorators already used there):

```ts
  @ApiPropertyOptional() @IsOptional() @IsString() imapHost?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() imapPort?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() imapSecure?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() imapUsername?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() imapPassword?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inboundActive?: boolean;
```

(Import `IsInt`, `IsBoolean` from `class-validator` and `ApiPropertyOptional` from `@nestjs/swagger` if not already imported.)

- [ ] **Step 2: Extend the projection**

In `email-config.service.ts`, add to the `EmailConfigProjection` interface:

```ts
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  imapUsername: string | null;
  hasImapPassword: boolean;
  inboundActive: boolean;
  lastPollAt: Date | null;
  lastPollOk: boolean | null;
```

And in `project()` return object, add:

```ts
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapSecure: config.imapSecure,
      imapUsername: config.imapUsername,
      hasImapPassword: !!config.imapPasswordEnc,
      inboundActive: config.inboundActive,
      lastPollAt: config.lastPollAt,
      lastPollOk: config.lastPollOk,
```

- [ ] **Step 3: Persist IMAP fields in `upsert()`**

In `upsert()`, compute the encrypted IMAP password alongside the SMTP one:

```ts
    const hasImapPassword = typeof dto.imapPassword === 'string' && dto.imapPassword.length > 0;
    const imapPasswordEnc = hasImapPassword
      ? this.crypto.encryptString(dto.imapPassword as string)
      : undefined;
```

Add the same `...(dto.x !== undefined ? { x: dto.x } : {})` spreads for `imapHost`, `imapPort`, `imapSecure`, `imapUsername`, `inboundActive` into BOTH the `create` and `update` blocks, plus `...(imapPasswordEnc !== undefined ? { imapPasswordEnc } : {})`.

- [ ] **Step 4: Add `resolveInbound()`**

```ts
  /** Imap connection options for the inbound poller, or null when not configured/active. */
  async resolveInbound(tenantId: string): Promise<ImapConfig | null> {
    const config = await this.prisma.tenantEmailConfig.findUnique({ where: { tenantId } });
    if (!config || !config.inboundActive || !config.imapHost) return null;
    return {
      host: config.imapHost,
      port: config.imapPort ?? 993,
      secure: config.imapSecure,
      user: config.imapUsername ?? undefined,
      pass: config.imapPasswordEnc ? this.crypto.decryptString(config.imapPasswordEnc) : undefined,
    };
  }
```

Add the interface near the top of the file:

```ts
export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}
```

- [ ] **Step 5: Add the controller endpoint**

In `email-config.controller.ts`, add (mirror the existing `POST email-config/test` SMTP endpoint, same guards `@RequirePermissions` used there):

```ts
  @Post('test-inbound')
  @ApiOperation({ summary: 'Test the tenant IMAP inbound connection' })
  testInbound(@CurrentUser() user: AuthUser) {
    return this.service.testInbound(user.tenantId);
  }
```

- [ ] **Step 6: Add `testInbound()` stub in the service**

`testInbound` needs the IMAP driver, which lives in Task 4. To avoid a forward dependency now, add a stub that returns a clear not-yet-wired result, and complete it in Task 6 step "wire testInbound":

```ts
  /** Wired to ImapPollDriver.testConnection in Task 6. */
  async testInbound(_tenantId: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'inbound driver not wired yet' };
  }
```

- [ ] **Step 7: Typecheck the API**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/core/email/email-config.service.ts apps/api/src/core/email/dto/email-config.dto.ts apps/api/src/core/email/email-config.controller.ts
git commit -m "feat(email): IMAP config fields (encrypted), projection, resolveInbound"
```

---

### Task 4: Driver de réception — interface + `LogInboundDriver` + `ImapPollDriver`

**Files:**
- Create: `apps/api/src/core/email/inbound/inbound-driver.ts` (interface + types)
- Create: `apps/api/src/core/email/inbound/log-inbound.driver.ts`
- Create: `apps/api/src/core/email/inbound/imap-poll.driver.ts`
- Modify: `apps/api/package.json` (deps `imapflow`, `mailparser`)

**Interfaces:**
- Consumes: `ImapConfig` (Task 3).
- Produces:
  - `interface RawInboundEmail { from: string; fromName?: string; to: string[]; subject: string; html: string; text?: string; messageId: string; inReplyTo?: string; references: string[]; receivedAt: Date; attachments: { filename: string; content: Buffer; mimeType: string }[] }`
  - `interface InboundEmailDriver { fetchNew(config: ImapConfig): Promise<RawInboundEmail[]>; testConnection(config: ImapConfig): Promise<{ ok: boolean; error?: string }> }`
  - `class LogInboundDriver implements InboundEmailDriver` (no-op fetch, ok test)
  - `class ImapPollDriver implements InboundEmailDriver` (imapflow + mailparser)

- [ ] **Step 1: Add dependencies**

Run (from repo root):
```bash
pnpm --filter @pulsar/api add imapflow mailparser && pnpm --filter @pulsar/api add -D @types/mailparser
```
Expected: deps added; lockfile updated.

- [ ] **Step 2: Write the interface + types**

```ts
// apps/api/src/core/email/inbound/inbound-driver.ts
import type { ImapConfig } from '../email-config.service';

export interface RawInboundAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export interface RawInboundEmail {
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  receivedAt: Date;
  attachments: RawInboundAttachment[];
}

export interface InboundEmailDriver {
  /** Fetch unseen messages and mark them seen. Best-effort; throws on hard connection errors. */
  fetchNew(config: ImapConfig): Promise<RawInboundEmail[]>;
  testConnection(config: ImapConfig): Promise<{ ok: boolean; error?: string }>;
}

export const INBOUND_EMAIL_DRIVER = Symbol('INBOUND_EMAIL_DRIVER');
```

- [ ] **Step 3: Write the log driver**

```ts
// apps/api/src/core/email/inbound/log-inbound.driver.ts
import { Injectable, Logger } from '@nestjs/common';
import type { ImapConfig } from '../email-config.service';
import type { InboundEmailDriver, RawInboundEmail } from './inbound-driver';

/** Dev/CI driver: never polls a real server. Inbound arrives via the simulate endpoint. */
@Injectable()
export class LogInboundDriver implements InboundEmailDriver {
  private readonly logger = new Logger(LogInboundDriver.name);

  async fetchNew(_config: ImapConfig): Promise<RawInboundEmail[]> {
    return [];
  }

  async testConnection(_config: ImapConfig): Promise<{ ok: boolean; error?: string }> {
    this.logger.log('[inbound:log] testConnection → ok (log driver)');
    return { ok: true };
  }
}
```

- [ ] **Step 4: Write the IMAP driver**

```ts
// apps/api/src/core/email/inbound/imap-poll.driver.ts
import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { ImapConfig } from '../email-config.service';
import type { InboundEmailDriver, RawInboundEmail } from './inbound-driver';

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_PER_POLL = 25;

@Injectable()
export class ImapPollDriver implements InboundEmailDriver {
  private readonly logger = new Logger(ImapPollDriver.name);

  private client(config: ImapConfig): ImapFlow {
    return new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user ?? '', pass: config.pass ?? '' },
      logger: false,
      socketTimeout: CONNECT_TIMEOUT_MS,
    });
  }

  async fetchNew(config: ImapConfig): Promise<RawInboundEmail[]> {
    const client = this.client(config);
    const out: RawInboundEmail[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        const slice = (uids ?? []).slice(0, MAX_PER_POLL);
        for (const uid of slice) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          out.push(toRaw(parsed));
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }

  async testConnection(config: ImapConfig): Promise<{ ok: boolean; error?: string }> {
    const client = this.client(config);
    try {
      await client.connect();
      await client.logout().catch(() => undefined);
      return { ok: true };
    } catch (err) {
      this.logger.warn(`IMAP testConnection failed: ${String(err)}`);
      return { ok: false, error: String(err).slice(0, 200) };
    }
  }
}

// mailparser ParsedMail → RawInboundEmail
function toRaw(parsed: import('mailparser').ParsedMail): RawInboundEmail {
  const fromAddr = parsed.from?.value?.[0];
  const toList = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
  const toAddresses = toList.flatMap((t) => t.value.map((v) => v.address ?? '').filter(Boolean));
  const refs = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];
  return {
    from: fromAddr?.address ?? '',
    fromName: fromAddr?.name || undefined,
    to: toAddresses,
    subject: parsed.subject ?? '(no subject)',
    html: typeof parsed.html === 'string' ? parsed.html : parsed.textAsHtml ?? `<p>${parsed.text ?? ''}</p>`,
    text: parsed.text ?? undefined,
    messageId: parsed.messageId ?? `<generated-${Date.now()}@pulsar.local>`,
    inReplyTo: parsed.inReplyTo ?? undefined,
    references: refs,
    receivedAt: parsed.date ?? new Date(),
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      content: a.content as Buffer,
      mimeType: a.contentType ?? 'application/octet-stream',
    })),
  };
}
```

Note: `messageId` uses `Date.now()` only as a last-resort fallback for malformed mail (never in tests/CI, where the simulate endpoint always supplies one) — acceptable here.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS (drivers compile; mailparser/imapflow types resolve).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/email/inbound apps/api/package.json pnpm-lock.yaml
git commit -m "feat(email): inbound driver interface + log + IMAP poll drivers"
```

---

### Task 5: `InboundIngestService` — threading + persistance + pièces jointes + audit + event

**Files:**
- Create: `apps/api/src/core/email/inbound/inbound-ingest.service.ts`
- Create: `apps/api/test/inbound-ingest.spec.ts` (unit, mocked Prisma)

**Interfaces:**
- Consumes: `RawInboundEmail` (Task 4), pure helpers `normalizeSubject`/`resolveThreadDecision`/`EmailDirection`/`EmailThreadStatus` (Task 1), `DocumentsService.upload`, `AuditLogsService.log`, `DomainEventsService.emit`, `PrismaService`.
- Produces:
  - `InboundIngestService.ingest(tenantId: string, raw: RawInboundEmail): Promise<{ threadId: string; messageId: string; deduped: boolean }>`

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/api/test/inbound-ingest.spec.ts
import { InboundIngestService } from '../src/core/email/inbound/inbound-ingest.service';
import { EmailDirection } from '@pulsar/shared';

function rawEmail(overrides: Partial<any> = {}) {
  return {
    from: 'jane@acme.test',
    fromName: 'Jane',
    to: ['sales@us.test'],
    subject: 'Re: Quote',
    html: '<p>hi</p>',
    text: 'hi',
    messageId: '<m1@acme>',
    references: [],
    receivedAt: new Date('2026-06-24T00:00:00Z'),
    attachments: [],
    ...overrides,
  };
}

describe('InboundIngestService', () => {
  it('dedupes on an existing messageId', async () => {
    const prisma: any = {
      emailMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'x', threadId: 't' }) },
    };
    const svc = new InboundIngestService(prisma, {} as any, {} as any, {} as any);
    const r = await svc.ingest('tenant1', rawEmail());
    expect(r.deduped).toBe(true);
  });

  it('creates an UNLINKED thread for an unknown sender', async () => {
    const created: any = {};
    const tx: any = {
      emailThread: { create: jest.fn().mockResolvedValue({ id: 'thr1' }), update: jest.fn() },
      emailMessage: { create: jest.fn().mockResolvedValue({ id: 'msg1' }) },
    };
    const prisma: any = {
      emailMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      crmContact: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const audit: any = { log: jest.fn() };
    const events: any = { emit: jest.fn() };
    const docs: any = { upload: jest.fn() };
    const svc = new InboundIngestService(prisma, docs, audit, events);
    const r = await svc.ingest('tenant1', rawEmail({ references: [], inReplyTo: undefined }));
    expect(r.deduped).toBe(false);
    expect(tx.emailThread.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'UNLINKED' }) }),
    );
    expect(tx.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ direction: EmailDirection.INBOUND }) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/api test -- inbound-ingest`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// apps/api/src/core/email/inbound/inbound-ingest.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  EmailDirection,
  EmailThreadStatus,
  normalizeSubject,
  resolveThreadDecision,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocumentsService } from '../../documents/documents.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { DomainEventsService } from '../../operating/domain-events.service';
import type { RawInboundEmail } from './inbound-driver';

@Injectable()
export class InboundIngestService {
  private readonly logger = new Logger(InboundIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
    private readonly events: DomainEventsService,
  ) {}

  /**
   * Ingest one inbound email: idempotent on messageId, threads via RFC headers
   * then sender→contact match, persists the message + attachments, audits, emits.
   */
  async ingest(
    tenantId: string,
    raw: RawInboundEmail,
  ): Promise<{ threadId: string; messageId: string; deduped: boolean }> {
    // 1. Idempotence on messageId.
    const existing = await this.prisma.emailMessage.findFirst({
      where: { tenantId, messageId: raw.messageId },
      select: { id: true, threadId: true },
    });
    if (existing) {
      return { threadId: existing.threadId ?? '', messageId: existing.id, deduped: true };
    }

    // 2a. Known referenced message → existing thread.
    const refIds = [raw.inReplyTo, ...raw.references].filter(Boolean) as string[];
    let knownMessageThreadId: string | null = null;
    if (refIds.length > 0) {
      const ref = await this.prisma.emailMessage.findFirst({
        where: { tenantId, messageId: { in: refIds }, threadId: { not: null } },
        select: { threadId: true },
        orderBy: { createdAt: 'desc' },
      });
      knownMessageThreadId = ref?.threadId ?? null;
    }

    // 2b. Sender → contact match (case-insensitive).
    let matchedContact: { id: string; companyId: string | null } | null = null;
    if (!knownMessageThreadId && raw.from) {
      const contact = await this.prisma.crmContact.findFirst({
        where: { tenantId, email: { equals: raw.from, mode: 'insensitive' } },
        select: { id: true, companyId: true },
      });
      matchedContact = contact ? { id: contact.id, companyId: contact.companyId } : null;
    }

    const decision = resolveThreadDecision({
      inReplyTo: raw.inReplyTo,
      references: raw.references,
      knownMessageThreadId,
      matchedContact,
    });

    const subjectNorm = normalizeSubject(raw.subject);

    // 3. Persist thread (or reuse) + message in one transaction.
    const result = await this.prisma.$transaction(async (tx) => {
      let threadId: string;
      let newThread = false;
      if (decision.kind === 'existing') {
        threadId = decision.threadId;
      } else if (decision.kind === 'new-linked') {
        const t = await tx.emailThread.create({
          data: {
            tenantId,
            subject: raw.subject,
            subjectNorm,
            contactId: decision.contactId,
            companyId: decision.companyId,
            status: EmailThreadStatus.LINKED,
            lastMessageAt: raw.receivedAt,
          },
        });
        threadId = t.id;
        newThread = true;
      } else {
        const t = await tx.emailThread.create({
          data: {
            tenantId,
            subject: raw.subject,
            subjectNorm,
            status: EmailThreadStatus.UNLINKED,
            lastMessageAt: raw.receivedAt,
          },
        });
        threadId = t.id;
        newThread = true;
      }

      const msg = await tx.emailMessage.create({
        data: {
          tenantId,
          threadId,
          direction: EmailDirection.INBOUND,
          status: 'SENT', // inbound is already delivered; not part of the outbox queue
          toAddresses: raw.to,
          subject: raw.subject,
          html: raw.html,
          text: raw.text,
          messageId: raw.messageId,
          inReplyTo: raw.inReplyTo,
          references: raw.references.join(' ') || null,
          fromAddress: raw.from,
        },
      });

      await tx.emailThread.update({
        where: { id: threadId },
        data: { lastMessageAt: raw.receivedAt, messageCount: { increment: 1 } },
      });

      return { threadId, messageId: msg.id, newThread };
    });

    // 4. Attachments via DocumentsService (rule 12) — best-effort, outside the tx.
    for (const att of raw.attachments) {
      try {
        const doc = await this.documents.upload(tenantId, {
          entityType: 'email-inbound',
          entityId: result.messageId,
          fileName: att.filename,
          mimeType: att.mimeType,
          body: att.content,
          uploadedById: undefined,
        });
        await this.prisma.emailAttachment.create({
          data: { tenantId, emailMessageId: result.messageId, documentId: doc.id, filename: att.filename },
        });
      } catch (err) {
        this.logger.warn(`inbound attachment failed (${att.filename}): ${String(err)}`);
      }
    }

    // 5. Audit (rule 6) + 6. domain event (best-effort).
    await this.audit
      .log({
        tenantId,
        action: AuditAction.CREATE,
        entityType: 'email-thread',
        entityId: result.threadId,
        after: { direction: 'INBOUND', from: raw.from, subject: raw.subject, newThread: result.newThread },
      })
      .catch(() => undefined);
    await this.events.emit(tenantId, 'crm.email.received', { type: 'email-thread', id: result.threadId }, {
      messageId: result.messageId,
      from: raw.from,
    });

    return { threadId: result.threadId, messageId: result.messageId, deduped: false };
  }
}
```

(If `UploadDocumentInput` requires `uploadedById: string`, pass `'system'` instead of `undefined` — check `apps/api/src/core/documents/documents.service.ts` `UploadDocumentInput`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pulsar/api test -- inbound-ingest`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/email/inbound/inbound-ingest.service.ts apps/api/test/inbound-ingest.spec.ts
git commit -m "feat(email): InboundIngestService — threading, attachments, audit, event"
```

---

### Task 6: `InboundEmailService` cron + simulate endpoint + EmailModule wiring + finish testInbound

**Files:**
- Create: `apps/api/src/core/email/inbound/inbound-email.service.ts`
- Create: `apps/api/src/core/email/inbound/inbound.controller.ts`
- Modify: `apps/api/src/core/email/email.module.ts`
- Modify: `apps/api/src/core/email/email-config.service.ts` (complete `testInbound`)

**Interfaces:**
- Consumes: `EmailConfigService.resolveInbound`, `InboundEmailDriver` (DI token), `InboundIngestService.ingest`.
- Produces:
  - `InboundEmailService.pollAllTenants(): Promise<void>` (cron `EVERY_5_MINUTES`, best-effort, isolated per tenant)
  - `POST /api/v1/emails/_simulate-inbound` (dev-only) body = `RawInboundEmail`-shaped → `ingest`

- [ ] **Step 1: Implement the cron service**

```ts
// apps/api/src/core/email/inbound/inbound-email.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailConfigService } from '../email-config.service';
import { InboundIngestService } from './inbound-ingest.service';
import { INBOUND_EMAIL_DRIVER, type InboundEmailDriver } from './inbound-driver';

@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: EmailConfigService,
    private readonly ingest: InboundIngestService,
    @Inject(INBOUND_EMAIL_DRIVER) private readonly driver: InboundEmailDriver,
  ) {}

  /** Cron: poll every tenant with inbound active. Best-effort, never throws, isolated per tenant. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollAllTenants(): Promise<void> {
    try {
      const tenants = await this.prisma.tenantEmailConfig.findMany({
        where: { inboundActive: true, imapHost: { not: null } },
        select: { tenantId: true },
      });
      for (const { tenantId } of tenants) {
        await this.pollTenant(tenantId).catch((err) =>
          this.logger.warn(`inbound poll failed for tenant ${tenantId}: ${String(err)}`),
        );
      }
    } catch (err) {
      this.logger.error(`pollAllTenants error: ${String(err)}`);
    }
  }

  async pollTenant(tenantId: string): Promise<void> {
    const config = await this.configService.resolveInbound(tenantId);
    if (!config) return;
    let ok = true;
    try {
      const messages = await this.driver.fetchNew(config);
      for (const raw of messages) {
        await this.ingest.ingest(tenantId, raw).catch((err) =>
          this.logger.warn(`ingest failed for tenant ${tenantId}: ${String(err)}`),
        );
      }
    } catch (err) {
      ok = false;
      this.logger.warn(`fetchNew failed for tenant ${tenantId}: ${String(err)}`);
    }
    await this.prisma.tenantEmailConfig
      .update({ where: { tenantId }, data: { lastPollAt: new Date(), lastPollOk: ok } })
      .catch(() => undefined);
  }
}
```

- [ ] **Step 2: Implement the dev-only simulate controller**

```ts
// apps/api/src/core/email/inbound/inbound.controller.ts
import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PERMISSIONS } from '@pulsar/shared';
import { InboundIngestService } from './inbound-ingest.service';
import { SimulateInboundDto } from '../dto/simulate-inbound.dto';

@ApiTags('emails')
@Controller('emails')
export class InboundController {
  constructor(private readonly ingest: InboundIngestService) {}

  /** Dev/CI only: inject a synthetic inbound email to exercise threading without IMAP. */
  @Post('_simulate-inbound')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  @ApiOperation({ summary: '[dev] Simulate an inbound email' })
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateInboundDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('simulate-inbound is disabled in production');
    }
    return this.ingest.ingest(user.tenantId, {
      from: dto.from,
      fromName: dto.fromName,
      to: dto.to ?? [],
      subject: dto.subject,
      html: dto.html ?? `<p>${dto.text ?? ''}</p>`,
      text: dto.text,
      messageId: dto.messageId,
      inReplyTo: dto.inReplyTo,
      references: dto.references ?? [],
      receivedAt: new Date(),
      attachments: [],
    });
  }
}
```

Create the DTO:

```ts
// apps/api/src/core/email/dto/simulate-inbound.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

export class SimulateInboundDto {
  @ApiProperty() @IsEmail() from!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fromName?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() to?: string[];
  @ApiProperty() @IsString() subject!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() html?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() text?: string;
  @ApiProperty() @IsString() messageId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() inReplyTo?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() references?: string[];
}
```

(Verify exact import paths for `CurrentUser`, `AuthUser`, `RequirePermissions` against an existing controller, e.g. `email-config.controller.ts`, and match them.)

- [ ] **Step 3: Wire EmailModule**

In `email.module.ts`:
- Import `OperatingModule` (for `DomainEventsService`) — add to `imports`.
- Add providers: `InboundIngestService`, `InboundEmailService`, `LogInboundDriver`, `ImapPollDriver`, and the driver token binding:

```ts
import { OperatingModule } from '../operating/operating.module';
import { InboundIngestService } from './inbound/inbound-ingest.service';
import { InboundEmailService } from './inbound/inbound-email.service';
import { InboundController } from './inbound/inbound.controller';
import { LogInboundDriver } from './inbound/log-inbound.driver';
import { ImapPollDriver } from './inbound/imap-poll.driver';
import { INBOUND_EMAIL_DRIVER } from './inbound/inbound-driver';
```

Add `InboundController` to `controllers`. Add to `providers`:

```ts
    InboundIngestService,
    InboundEmailService,
    LogInboundDriver,
    ImapPollDriver,
    {
      provide: INBOUND_EMAIL_DRIVER,
      useFactory: (cfg: import('@nestjs/config').ConfigService, log: LogInboundDriver, imap: ImapPollDriver) =>
        cfg.get('EMAIL_DRIVER', 'log') === 'smtp' ? imap : log,
      inject: [import('@nestjs/config').ConfigService, LogInboundDriver, ImapPollDriver],
    },
```

(If inline `import(...)` in `inject` is awkward, add a top-level `import { ConfigService } from '@nestjs/config';` and use `ConfigService` directly.) Export `InboundIngestService` and `EmailConfigService` (already exported). Add `INBOUND_EMAIL_DRIVER` to exports so `EmailConfigService.testInbound` can use it.

- [ ] **Step 4: Finish `testInbound` in EmailConfigService**

`EmailConfigService` must call the driver's `testConnection`. Inject the driver token. In `email-config.service.ts` constructor add:

```ts
    @Inject(INBOUND_EMAIL_DRIVER) private readonly inboundDriver: InboundEmailDriver,
```

(import `Inject` from `@nestjs/common`, `INBOUND_EMAIL_DRIVER` + `InboundEmailDriver` from `./inbound/inbound-driver`). Replace the stub:

```ts
  async testInbound(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    const config = await this.resolveInbound(tenantId);
    if (!config) return { ok: false, error: 'no active inbound config' };
    const result = await this.inboundDriver.testConnection(config);
    await this.prisma.tenantEmailConfig
      .update({ where: { tenantId }, data: { lastPollAt: new Date(), lastPollOk: result.ok } })
      .catch(() => undefined);
    return result;
  }
```

Note: `EmailConfigService` and the driver providers are in the same `@Global EmailModule`, so no circular module import — the token resolves within the module.

- [ ] **Step 5: Typecheck + build API**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/email/inbound apps/api/src/core/email/dto/simulate-inbound.dto.ts apps/api/src/core/email/email.module.ts apps/api/src/core/email/email-config.service.ts
git commit -m "feat(email): inbound poll cron + dev simulate endpoint + driver wiring"
```

---

### Task 7: `MailService` — Message-ID sortant + chaînage de thread

**Files:**
- Modify: `apps/api/src/core/email/mail.service.ts`

**Interfaces:**
- Produces: `QueueEmailInput` += `threadId?: string; inReplyTo?: string; references?: string`. Every queued message gets a generated `messageId`, `direction: OUTBOUND`, and `fromAddress` from the resolved transport when available.

- [ ] **Step 1: Extend `QueueEmailInput`**

Add to the interface:

```ts
  threadId?: string;
  inReplyTo?: string;
  references?: string;
```

- [ ] **Step 2: Generate messageId + persist threading fields in `queue()`**

At the top of the file add `import { randomUUID } from 'node:crypto';`. In the `tx.emailMessage.create` data object, add:

```ts
          messageId: `<${randomUUID()}@pulsar.local>`,
          direction: 'OUTBOUND',
          threadId: rest.threadId,
          inReplyTo: rest.inReplyTo,
          references: rest.references,
```

- [ ] **Step 3: Pass the Message-ID header on delivery**

In `deliver()`, the `emailService.send(...)` call builds the `OutgoingEmail`. Add a `headers` field carrying the stored `messageId` and `In-Reply-To` so replies chain at the SMTP level. First extend `OutgoingEmail` in `email.service.ts`:

```ts
  headers?: Record<string, string>;
  messageId?: string;
```

In `EmailService.send`, nodemailer accepts `messageId` and `headers` directly in `sendMail`, so spreading `...email` already forwards them (nodemailer reads `messageId`/`headers` keys). No further change needed beyond the type.

Then in `mail.service.ts` `deliver()`, build the send payload with:

```ts
          messageId: msg.messageId ?? undefined,
          headers: msg.inReplyTo
            ? { 'In-Reply-To': msg.inReplyTo, References: msg.references ?? msg.inReplyTo }
            : undefined,
```

- [ ] **Step 4: Verify no existing caller breaks**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS (new fields optional; existing callers — tenders, invoices, campaigns, invitations — unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/email/mail.service.ts apps/api/src/core/email/email.service.ts
git commit -m "feat(email): outbound Message-ID + thread chaining (In-Reply-To/References)"
```

---

### Task 8: CRM `ThreadsService` + `ThreadsController` (list/get/reply/link/archive)

**Files:**
- Create: `apps/api/src/modules/crm/threads.service.ts`
- Create: `apps/api/src/modules/crm/threads.controller.ts`
- Create: `apps/api/src/modules/crm/dto/thread.dto.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts`

**Interfaces:**
- Consumes: `MailService.queue` (threading fields, Task 7), `AuditLogsService.log`, `PrismaService`, pure `EmailThreadStatus`.
- Produces (used by Task 9 agent adapter + Task 10/11):
  - `ThreadsService.list(tenantId, query): Promise<Paginated<thread>>`
  - `ThreadsService.get(tenantId, id): Promise<{ ...thread, messages: [...], attachments }>`
  - `ThreadsService.reply(tenantId, id, dto, author): Promise<emailMessage>`
  - `ThreadsService.link(tenantId, id, dto, userId): Promise<thread>`
  - `ThreadsService.archive(tenantId, id, userId): Promise<thread>`

- [ ] **Step 1: Write the DTOs**

```ts
// apps/api/src/modules/crm/dto/thread.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ThreadListQueryDto {
  @ApiPropertyOptional({ enum: ['UNLINKED', 'LINKED', 'ARCHIVED'] })
  @IsOptional() @IsIn(['UNLINKED', 'LINKED', 'ARCHIVED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dealId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}

export class ReplyThreadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @IsString() html!: string;
}

class CreateContactInline {
  @IsString() name!: string;
  @IsEmail() email!: string;
}

export class LinkThreadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() contactId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dealId?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => CreateContactInline)
  createContact?: CreateContactInline;
}
```

- [ ] **Step 2: Write the service**

```ts
// apps/api/src/modules/crm/threads.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EmailThreadStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../core/email/mail.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { LinkThreadDto, ReplyThreadDto, ThreadListQueryDto } from './dto/thread.dto';

@Injectable()
export class ThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, query: ThreadListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.status ? { status: query.status as EmailThreadStatus } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.search ? { subject: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.emailThread.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip, take }),
      this.prisma.emailThread.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const thread = await this.prisma.emailThread.findFirst({ where: { id, tenantId } });
    if (!thread) throw new NotFoundException('Thread not found');
    const messages = await this.prisma.emailMessage.findMany({
      where: { tenantId, threadId: id },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });
    return { ...thread, messages };
  }

  /** Queue an outbound reply, chained to the latest inbound message of the thread. */
  async reply(
    tenantId: string,
    id: string,
    dto: ReplyThreadDto,
    author: { userId?: string; agentId?: string },
  ) {
    const thread = await this.prisma.emailThread.findFirst({ where: { id, tenantId } });
    if (!thread) throw new NotFoundException('Thread not found');

    // Recipient: the contact email, else the latest inbound fromAddress.
    let to: string | null = null;
    if (thread.contactId) {
      const c = await this.prisma.crmContact.findFirst({
        where: { id: thread.contactId, tenantId },
        select: { email: true },
      });
      to = c?.email ?? null;
    }
    const lastInbound = await this.prisma.emailMessage.findFirst({
      where: { tenantId, threadId: id, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { messageId: true, references: true, fromAddress: true },
    });
    to = to ?? lastInbound?.fromAddress ?? null;
    if (!to) throw new BadRequestException('No recipient address for this thread');

    const references = [lastInbound?.references, lastInbound?.messageId].filter(Boolean).join(' ') || undefined;

    const msg = await this.mail.queue(tenantId, {
      toAddresses: [to],
      subject: dto.subject ?? `Re: ${thread.subject}`,
      html: dto.html,
      threadId: id,
      inReplyTo: lastInbound?.messageId ?? undefined,
      references,
      relatedType: 'email-thread',
      relatedId: id,
      createdByUserId: author.userId,
      agentId: author.agentId,
    });

    await this.prisma.emailThread.update({
      where: { id },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
    });
    await this.audit.log({
      tenantId, userId: author.userId, agentId: author.agentId,
      action: AuditAction.CREATE, entityType: 'email-thread', entityId: id,
      after: { direction: 'OUTBOUND', to },
    });
    return msg;
  }

  /** Link the thread to a contact/company/deal (or create a contact), → LINKED. Rule 9 + 6. */
  async link(tenantId: string, id: string, dto: LinkThreadDto, userId?: string) {
    const thread = await this.prisma.emailThread.findFirst({ where: { id, tenantId } });
    if (!thread) throw new NotFoundException('Thread not found');

    let contactId = dto.contactId ?? null;
    let companyId = dto.companyId ?? null;

    if (dto.createContact) {
      const created = await this.prisma.crmContact.create({
        data: { tenantId, name: dto.createContact.name, email: dto.createContact.email },
      });
      contactId = created.id;
    } else if (contactId) {
      const c = await this.prisma.crmContact.findFirst({ where: { id: contactId, tenantId }, select: { id: true, companyId: true } });
      if (!c) throw new BadRequestException(`Unknown crm-contact "${contactId}"`);
      companyId = companyId ?? c.companyId;
    }
    if (companyId) {
      const co = await this.prisma.crmCompany.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
      if (!co) throw new BadRequestException(`Unknown crm-company "${companyId}"`);
    }
    if (dto.dealId) {
      const d = await this.prisma.crmDeal.findFirst({ where: { id: dto.dealId, tenantId }, select: { id: true } });
      if (!d) throw new BadRequestException(`Unknown crm-deal "${dto.dealId}"`);
    }

    const updated = await this.prisma.emailThread.update({
      where: { id },
      data: { contactId, companyId, dealId: dto.dealId ?? thread.dealId, status: EmailThreadStatus.LINKED },
    });
    await this.audit.log({
      tenantId, userId, action: AuditAction.UPDATE, entityType: 'email-thread', entityId: id,
      after: { contactId, companyId, dealId: updated.dealId, status: 'LINKED' },
    });
    return updated;
  }

  async archive(tenantId: string, id: string, userId?: string) {
    const { count } = await this.prisma.emailThread.updateMany({
      where: { id, tenantId },
      data: { status: EmailThreadStatus.ARCHIVED },
    });
    if (count === 0) throw new NotFoundException('Thread not found');
    await this.audit.log({
      tenantId, userId, action: AuditAction.UPDATE, entityType: 'email-thread', entityId: id,
      after: { status: 'ARCHIVED' },
    });
    return this.prisma.emailThread.findFirst({ where: { id, tenantId } });
  }
}
```

- [ ] **Step 3: Write the controller**

```ts
// apps/api/src/modules/crm/threads.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../core/auth/current-user.decorator';
import { RequirePermissions } from '../../core/auth/require-permissions.decorator';
import { RequireModule } from '../../core/modules/require-module.decorator';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { ThreadsService } from './threads.service';
import { LinkThreadDto, ReplyThreadDto, ThreadListQueryDto } from './dto/thread.dto';

@ApiTags('crm')
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/threads')
export class ThreadsController {
  constructor(private readonly service: ThreadsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ThreadListQueryDto) {
    return this.service.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post(':id/reply')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyThreadDto) {
    return this.service.reply(user.tenantId, id, dto, { userId: user.id });
  }

  @Post(':id/link')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  link(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: LinkThreadDto) {
    return this.service.link(user.tenantId, id, dto, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.archive(user.tenantId, id, user.id);
  }
}
```

(Verify the exact import paths/names for `CurrentUser`, `AuthUser`, `RequirePermissions`, `RequireModule` against `companies.controller.ts` and match them precisely.)

- [ ] **Step 4: Register in `crm.module.ts`**

Add imports for `ThreadsController` + `ThreadsService`, add `ThreadsController` to `controllers`, `ThreadsService` to `providers` and `exports`. `MailService` is available from the `@Global` `EmailModule` (per the module's own doc comment), `AuditLogsService` from `AuditLogsModule` (already imported).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/crm/threads.service.ts apps/api/src/modules/crm/threads.controller.ts apps/api/src/modules/crm/dto/thread.dto.ts apps/api/src/modules/crm/crm.module.ts
git commit -m "feat(crm): threads API — list/get/reply/link/archive"
```

---

### Task 9: Outils agent — `crm_list_threads`/`crm_get_thread` (READ) + `crm_reply_thread`/`crm_link_thread` (MUTATING)

**Files:**
- Modify: `apps/api/src/core/agents/tools/crm.tools.ts`
- Modify: `apps/api/src/core/agents/tool-types.ts`
- Modify: `apps/api/src/core/agents/agents.module.ts`

**Interfaces:**
- Consumes: `ThreadsService.list/get/reply/link` (Task 8).
- Produces (ToolServices.crm additions): `listThreads`, `getThread`, `replyThread`, `linkThread`.

- [ ] **Step 1: Extend the `crm` service interface in `tool-types.ts`**

Add to the `crm: { ... }` block:

```ts
    listThreads(tenantId: string, query: object): Promise<unknown>;
    getThread(tenantId: string, id: string): Promise<unknown>;
    replyThread(tenantId: string, id: string, dto: { html: string; subject?: string }, author: { agentId?: string; userId?: string }): Promise<unknown>;
    linkThread(tenantId: string, id: string, dto: object, userId: string): Promise<unknown>;
```

- [ ] **Step 2: Add the tools**

Append to the `crmTools` array in `crm.tools.ts`:

```ts
  // ── CRM threads (email) ─────────────────────────────────────────────────────
  {
    name: 'crm_list_threads',
    description: 'List CRM email threads (optionally by status UNLINKED/LINKED or contactId).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ status: z.string().optional(), contactId: z.string().optional() }),
    run: (args, ctx) => ctx.services.crm.listThreads(ctx.principal.user.tenantId, args),
  },
  {
    name: 'crm_get_thread',
    description: 'Get a CRM email thread with its messages.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ threadId: z.string().min(1) }),
    run: (args, ctx) => ctx.services.crm.getThread(ctx.principal.user.tenantId, args.threadId as string),
  },
  {
    name: 'crm_reply_thread',
    description: 'Reply to a CRM email thread. PROPOSED — requires human approval before sending.',
    tier: RiskTier.SENSITIVE,
    permission: PERMISSIONS.CRM.MANAGE,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ threadId: z.string().min(1), html: z.string().min(1), subject: z.string().optional() }),
    run: (args, ctx) =>
      ctx.services.crm.replyThread(
        ctx.principal.user.tenantId,
        args.threadId as string,
        { html: args.html as string, subject: args.subject as string | undefined },
        { agentId: ctx.principal.agentId, userId: ctx.principal.user.id },
      ),
  },
  {
    name: 'crm_link_thread',
    description: 'Link a CRM email thread to a contact/company/deal (or create a contact). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.CRM.MANAGE,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({
      threadId: z.string().min(1),
      contactId: z.string().optional(),
      companyId: z.string().optional(),
      dealId: z.string().optional(),
      createContact: z.object({ name: z.string(), email: z.string() }).optional(),
    }),
    run: (args, ctx) => {
      const { threadId, ...rest } = args;
      return ctx.services.crm.linkThread(ctx.principal.user.tenantId, threadId as string, rest, ctx.principal.user.id);
    },
  },
```

- [ ] **Step 3: Wire the adapter in `agents.module.ts`**

The factory must have access to `ThreadsService`. Add `ThreadsService` to the factory's `inject` list and parameter (named e.g. `threads`), then add to the `crm: { ... }` adapter object:

```ts
          listThreads: (tenantId, query) => threads.list(tenantId, query as never),
          getThread: (tenantId, id) => threads.get(tenantId, id),
          replyThread: (tenantId, id, dto, author) => threads.reply(tenantId, id, dto, author),
          linkThread: (tenantId, id, dto, userId) => threads.link(tenantId, id, dto as never, userId),
```

Ensure `CrmModule` exports `ThreadsService` (done in Task 8) and that the agents factory provider can inject it — follow the existing pattern by which `deals`/`companies`/`activities` services are injected into this factory (check the `inject:` array and add `ThreadsService`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/agents/tools/crm.tools.ts apps/api/src/core/agents/tool-types.ts apps/api/src/core/agents/agents.module.ts
git commit -m "feat(crm): agent tools — list/get threads (READ) + reply/link (governed)"
```

---

### Task 10: e2e — threading bout-en-bout via `_simulate-inbound`

**Files:**
- Create: `apps/api/test/crm-email-threads.e2e-spec.ts`

**Interfaces:**
- Consumes: HTTP API (admin Bearer token, tenant `acme`): `POST /crm/companies`, `POST /crm/contacts`, `POST /emails/_simulate-inbound`, `GET /crm/threads`, `GET /crm/threads/:id`, `POST /crm/threads/:id/reply`, `POST /crm/threads/:id/link`.

- [ ] **Step 1: Write the e2e spec**

```ts
// apps/api/test/crm-email-threads.e2e-spec.ts
/**
 * E2E CRM email threads — proves inbound threading end-to-end over real Postgres
 * (tenant acme) via the dev simulate endpoint:
 *  1. Enable CRM; create a company + contact with a unique email.
 *  2. Simulate inbound from that contact → thread LINKED, contactId set.
 *  3. Simulate a reply (References the first messageId) → same thread, count=2.
 *  4. Simulate inbound from an unknown sender → thread UNLINKED.
 *  5. Link the unlinked thread to the contact → status LINKED.
 *  6. Reply to the thread → outbound queued with In-Reply-To/threadId.
 *  7. Idempotence: re-simulate the same messageId → no duplicate.
 * Creates its own master data with unique codes so reruns are safe.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('CRM email threads (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const senderEmail = `jane.${uniq()}@inbound.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(201);
    token = res.body.accessToken;
    await request(app.getHttpServer())
      .patch('/api/v1/modules/crm')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });
  });

  afterAll(async () => { await app.close(); });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('threads a known contact, chains a reply, handles unknown + link + reply + idempotence', async () => {
    const srv = app.getHttpServer();

    // company + contact
    const company = (await request(srv).post('/api/v1/crm/companies').set(auth())
      .send({ name: `Inbound Co ${uniq()}` }).expect(201)).body;
    const contact = (await request(srv).post('/api/v1/crm/contacts').set(auth())
      .send({ name: 'Jane Inbound', email: senderEmail, companyId: company.id }).expect(201)).body;

    // inbound from known contact
    const mid1 = `<m1.${uniq()}@inbound.test>`;
    await request(srv).post('/api/v1/emails/_simulate-inbound').set(auth())
      .send({ from: senderEmail, subject: 'Quote request', text: 'Need a quote', messageId: mid1 })
      .expect(201);

    let threads = (await request(srv).get('/api/v1/crm/threads?status=LINKED').set(auth()).expect(200)).body;
    const linked = threads.items.find((t: any) => t.contactId === contact.id);
    expect(linked).toBeTruthy();
    expect(linked.status).toBe('LINKED');

    // reply referencing mid1 → same thread, count grows
    const mid2 = `<m2.${uniq()}@inbound.test>`;
    await request(srv).post('/api/v1/emails/_simulate-inbound').set(auth())
      .send({ from: senderEmail, subject: 'Re: Quote request', text: 'ping', messageId: mid2, references: [mid1] })
      .expect(201);
    const full = (await request(srv).get(`/api/v1/crm/threads/${linked.id}`).set(auth()).expect(200)).body;
    expect(full.messages.length).toBeGreaterThanOrEqual(2);

    // unknown sender → UNLINKED
    const mid3 = `<m3.${uniq()}@stranger.test>`;
    await request(srv).post('/api/v1/emails/_simulate-inbound').set(auth())
      .send({ from: `stranger.${uniq()}@stranger.test`, subject: 'Hello', text: 'who?', messageId: mid3 })
      .expect(201);
    const unlinkedList = (await request(srv).get('/api/v1/crm/threads?status=UNLINKED').set(auth()).expect(200)).body;
    const unlinked = unlinkedList.items[0];
    expect(unlinked.status).toBe('UNLINKED');

    // link it to the contact
    const linkedNow = (await request(srv).post(`/api/v1/crm/threads/${unlinked.id}/link`).set(auth())
      .send({ contactId: contact.id }).expect(201)).body;
    expect(linkedNow.status).toBe('LINKED');

    // reply (outbound queued)
    await request(srv).post(`/api/v1/crm/threads/${linked.id}/reply`).set(auth())
      .send({ html: '<p>Here is your quote.</p>' }).expect(201);

    // idempotence: same messageId again → no new message
    const before = (await request(srv).get(`/api/v1/crm/threads/${linked.id}`).set(auth()).expect(200)).body.messages.length;
    await request(srv).post('/api/v1/emails/_simulate-inbound').set(auth())
      .send({ from: senderEmail, subject: 'Re: Quote request', text: 'dup', messageId: mid2, references: [mid1] })
      .expect(201);
    const after = (await request(srv).get(`/api/v1/crm/threads/${linked.id}`).set(auth()).expect(200)).body.messages.length;
    expect(after).toBe(before);
  });
});
```

(Match the actual login route/response shape and module-enable route used by the existing `crm-module.e2e-spec.ts` — adjust `accessToken`, `/auth/login`, and `/modules/crm` if that suite differs.)

- [ ] **Step 2: Run the e2e (needs seeded DB: `pnpm db:up && pnpm db:migrate && pnpm db:seed`)**

Run: `pnpm --filter @pulsar/api test:e2e -- crm-email-threads`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/crm-email-threads.e2e-spec.ts
git commit -m "test(crm): e2e inbound threading — link, chain, unlink, reply, idempotence"
```

---

### Task 11: Web — inbox `/crm/inbox` (liste + vue thread + réponse + rattachement) + navigation

**Files:**
- Create: `apps/web/src/routes/(app)/crm/inbox/+page.svelte`
- Modify: `apps/web/src/routes/(app)/+layout.svelte` (nav CRM → Inbox)

**Interfaces:**
- Consumes: `api<T>()` from `$lib/api/client`; endpoints `GET /crm/threads`, `GET /crm/threads/:id`, `POST /crm/threads/:id/reply`, `POST /crm/threads/:id/link`, `POST /crm/threads/:id/archive`, `GET /crm/contacts?search=`.

- [ ] **Step 1: Build the inbox page**

Create `+page.svelte` following the standard CRM page pattern (`$state` + `$effect` load, `api<T>()`, local `error`). Layout:
- Three tabs: **À trier (UNLINKED) / Rattachés (LINKED) / Tous** → sets `status` query.
- Left: paginated thread list (subject, contact/company name or "—", last message time, message count badge).
- Right: selected thread → message timeline (inbound left / outbound right, distinct styling), then a reply composer (`html` textarea + "Envoyer"), and for UNLINKED threads a link panel (search contact by name/email → `link`, or "Créer contact" with name+email) + an "Archiver" button.

Reference an existing CRM page for the exact import/store conventions:
```bash
sed -n '1,40p' apps/web/src/routes/\(app\)/crm/campaigns/+page.svelte
```
Mirror its `api` import, auth store usage, and error handling. Build the page with the same idioms (do not invent a new data-loading pattern).

Minimal data calls:
```ts
type Thread = { id: string; subject: string; status: string; contactId: string | null; companyId: string | null; lastMessageAt: string; messageCount: number };
type Msg = { id: string; direction: 'INBOUND' | 'OUTBOUND'; subject: string; html: string; fromAddress: string | null; createdAt: string };

let status = $state('UNLINKED');
let threads = $state<Thread[]>([]);
let selected = $state<(Thread & { messages: Msg[] }) | null>(null);
let error = $state('');

async function loadThreads() {
  try { threads = (await api<{ items: Thread[] }>(`/crm/threads?status=${status}`)).items; }
  catch (e) { error = String(e); }
}
async function openThread(id: string) {
  try { selected = await api(`/crm/threads/${id}`); }
  catch (e) { error = String(e); }
}
async function reply(html: string) {
  if (!selected) return;
  await api(`/crm/threads/${selected.id}/reply`, { method: 'POST', body: { html } });
  await openThread(selected.id);
}
async function linkToContact(contactId: string) {
  if (!selected) return;
  await api(`/crm/threads/${selected.id}/link`, { method: 'POST', body: { contactId } });
  await openThread(selected.id); await loadThreads();
}

$effect(() => { void status; loadThreads(); });
```

(Adapt the `api()` call signature — method/body vs fetch options — to whatever `$lib/api/client` actually exposes; check `campaigns` page.)

- [ ] **Step 2: Add navigation**

In `apps/web/src/routes/(app)/+layout.svelte`, within the CRM section (conditioned on `$auth.tenant.enabledModules` including `crm`), add an "Inbox" link to `/crm/inbox` alongside the existing CRM links (companies/contacts/deals/pipeline/...).

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK (no type/svelte errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/inbox/+page.svelte apps/web/src/routes/\(app\)/+layout.svelte
git commit -m "feat(web): CRM inbox — threads list, timeline, reply, link/archive"
```

---

### Task 12: Web — config IMAP sur la page email + threads sur fiche contact

**Files:**
- Modify: the existing email settings page (find it: `apps/web/src/routes/(app)/emails/` — config/settings sub-page)
- Modify: `apps/web/src/routes/(app)/crm/contacts/[id]/+page.svelte` if it exists, else `apps/web/src/routes/(app)/crm/companies/[id]/+page.svelte`

**Interfaces:**
- Consumes: `PUT /email-config` (now accepts IMAP fields), `POST /email-config/test-inbound`, `GET /crm/threads?contactId=`.

- [ ] **Step 1: Locate the email config page**

Run:
```bash
ls apps/web/src/routes/\(app\)/emails && grep -rln "email-config\|hasPassword\|imap\|SMTP" apps/web/src/routes/\(app\)/emails
```
Identify the component that renders the SMTP form (binds to `/email-config`).

- [ ] **Step 2: Add the IMAP fieldset**

In that component, add inputs bound to the config object: `imapHost`, `imapPort` (number), `imapSecure` (checkbox), `imapUsername`, `imapPassword` (password input — only sent when non-empty; show `hasImapPassword` as "•••• configuré"), `inboundActive` (checkbox). Submit through the same `PUT /email-config` call (the DTO already accepts the new fields). Add a "Tester la réception" button → `POST /email-config/test-inbound`, show `ok`/`error` and `lastPollAt`.

- [ ] **Step 3: Surface threads on the contact (or company) detail**

In the contact detail page, add a "Conversations" section that loads `GET /crm/threads?contactId=<id>` and lists threads with a link to `/crm/inbox` (deep-link by thread id if the inbox supports a query param; otherwise just navigate to the inbox). Keep it read-only here.

- [ ] **Step 4: Build the web app**

Run: `pnpm --filter @pulsar/web build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes
git commit -m "feat(web): IMAP inbound config + thread list on contact detail"
```

---

### Task 13: Vérification finale + mise à jour docs

**Files:**
- Modify: `docs/etat-du-projet.md` (entrée courte sur la capacité courriel bidirectionnel)
- Modify: `CLAUDE.md` (nouvelle hard rule si pertinent — voir step)

- [ ] **Step 1: Full typecheck + unit + build**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS (shared unit incl. `email-thread.spec.ts`; build order shared→database→api→web).

- [ ] **Step 2: Full e2e (seeded DB up)**

Run: `pnpm test:e2e`
Expected: existing suites + `crm-email-threads` PASS.

- [ ] **Step 3: Add a hard rule to CLAUDE.md**

Append under the CRM/email rules a concise rule capturing the invariants, e.g.:

```
39. (courriel bidirectionnel) La réception passe TOUJOURS par un `InboundEmailDriver`
    (log en dev/CI, IMAP en prod) ; l'ingestion (`InboundIngestService`) est idempotente sur
    `messageId`, threade via headers RFC puis match `CrmContact.email` (décision pure
    `resolveThreadDecision`/`normalizeSubject` de `@pulsar/shared`), et est best-effort/isolée
    par tenant (cron ne throw jamais). Les pièces jointes entrantes passent par `DocumentsService`
    (règle 12) ; le secret IMAP est chiffré via `CryptoService` (règle 25). Les réponses agent
    passent TOUJOURS par la file `ProposedAction` (`crm_reply_thread` SENSITIVE — règles 22/29).
```

- [ ] **Step 4: Note the capability in etat-du-projet.md**

Add a short line under the CRM/courriel section describing inbound threading + inbox.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/etat-du-projet.md
git commit -m "docs(crm): note bidirectional email + threading hard rule"
```

---

## Self-Review

**Spec coverage:**
- Réception driver abstrait (IMAP+log, webhook prêt) → Tasks 4, 6. ✓
- IMAP config chiffré par tenant (R25) → Tasks 2, 3. ✓
- `EmailThread` + `EmailMessage` étendu (réutilisé) → Task 2. ✓
- Helpers purs threading (`normalizeSubject`, `resolveThreadDecision`) → Task 1. ✓
- Ingestion: idempotence, headers RFC, match contact, unlinked, attachments (R12), audit (R6), event → Task 5. ✓
- Sortants chaînés (Message-ID/In-Reply-To) → Task 7. ✓
- API `crm/threads` list/get/reply/link/archive (R1/R9) → Task 8. ✓
- Outils agent READ + reply SENSITIVE/link MUTATING (R21–23) → Task 9. ✓
- Dev simulate endpoint + e2e → Tasks 6, 10. ✓
- Web inbox + nav + IMAP config + contact threads → Tasks 11, 12. ✓
- Verification + docs/hard rule → Task 13. ✓

**Placeholder scan:** No TODO/TBD; each code step carries real code. Web tasks (11/12) intentionally defer exact `api()` signature/markup to the existing CRM page idiom rather than inventing one — each names the file to read and the exact endpoints/state to wire (acceptable: matching established UI patterns, not a content gap).

**Type consistency:** `EmailThreadStatus`/`EmailDirection` string values consistent across Task 1 (shared), Task 2 (Prisma), Tasks 5/8 (services). `resolveThreadDecision` input/output shape matches its consumer in Task 5. `QueueEmailInput` additions (Task 7) match the `reply()` caller (Task 8). `ToolServices.crm` additions (Task 9) match `ThreadsService` method names (Task 8): `list/get/reply/link`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-crm-email-threads.md`.
