# Email Core Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Turn Pulsar email into a platform capability: per-tenant SMTP (encrypted), a durable outbox/history, templates, document attachments, AI drafting, a governed agent send tool, and migration of existing senders onto one pipeline.

**Architecture:** New core models (`TenantEmailConfig`, `EmailMessage`, `EmailAttachment`, `EmailTemplate`). A `MailService.queue` persists to the outbox; a `@Cron` worker delivers with retries (mirror `webhooks.service.ts`). Per-tenant SMTP config encrypted via `CryptoService` (mirror `runtime-config.service.ts`). AI drafting uses the tenant's `AgentRuntimeConfig` LLM. Agent `send_email` is SENSITIVE → ProposedAction. Web "Courriels" domain. Branch `email-core` off main.

**Tech Stack:** NestJS, Prisma, nodemailer, SvelteKit (Svelte 5 runes), `@pulsar/shared`, class-validator, jest e2e.

## Global Constraints
- Tenant isolation (rule 1): every query filters `tenantId`; per-tenant config selected by tenant.
- SMTP password + any secret encrypted via `CryptoService`; NEVER returned in clear (mirror `runtime-config.service.ts` upsert: preserve existing `passwordEnc` when not supplied).
- Files only via `DocumentsService` (rule 12).
- Agent tools via the registry (rule 21); `send_email` tier SENSITIVE → routed through `handleMutatingTool` → ProposedAction (rule 22); auto vs propose via existing policy/caps (rule 29). READ/LOW tools run live.
- New permission keys `core.email.read|send|manage` in `packages/shared/src/permissions.ts` catalog (rule 5); endpoints carry `@RequirePermissions`.
- Enums in `@pulsar/shared` mirrored in `schema.prisma` (rule 3); rebuild shared + database after (rule 7).
- Lists `Paginated<T>`; web pattern single `$effect`+`untrack`, `api<T>()`, FR labels, coerce nothing-special (no Decimal here).
- Email send is best-effort: a transport failure must never throw out of `queue`/cron (mirror existing EmailService philosophy + webhook outbox).

---

### Task 1: Shared enums + permissions + nav/module keys

**Files:** `packages/shared/src/email/email.enums.ts` (create) + `index.ts` export; `packages/shared/src/permissions.ts` (modify).

**Produces:** `EmailDriver` (`SMTP`), `EmailStatus` (`QUEUED|SENDING|SENT|FAILED`); `PERMISSIONS.EMAIL = { READ:'core.email.read', SEND:'core.email.send', MANAGE:'core.email.manage' }` + catalog rows.

- [ ] Step 1: Create `email.enums.ts` (pure):
```ts
export enum EmailDriver { SMTP = 'SMTP' }
export enum EmailStatus { QUEUED = 'QUEUED', SENDING = 'SENDING', SENT = 'SENT', FAILED = 'FAILED' }
```
- [ ] Step 2: Spec test `email.enums.spec.ts` asserting the enum values exist (one tiny vitest). Run it.
- [ ] Step 3: Export from `packages/shared/src/index.ts`.
- [ ] Step 4: Add `EMAIL` permission group + 3 catalog rows to `permissions.ts` using the SAME `core(...)` helper the other CORE rows use (read the file first; mirror `OPERATING_TASKS_READ/MANAGE` rows). Descriptions: read "View sent emails and templates", send "Compose and send emails", manage "Manage email templates and tenant email configuration".
- [ ] Step 5: `cd packages/shared && npx vitest run` green (incl. existing role-presets spec which validates permission keys). `pnpm --filter @pulsar/shared build`.
- [ ] Step 6: Commit `feat(email): shared enums + permission keys`.

---

### Task 2: Database — models + migration + seed

**Files:** `packages/database/prisma/schema.prisma`, `seed.ts`.

**Produces:** `TenantEmailConfig`, `EmailMessage`, `EmailAttachment`, `EmailTemplate` + `EmailDriver`/`EmailStatus` enums (identical values to shared) + Tenant back-relations.

- [ ] Step 1: Add enums + models exactly per the design spec (`docs/superpowers/specs/2026-06-22-email-core-design.md` §Data model). Key points: `TenantEmailConfig` has `@@unique([tenantId])` and `passwordEnc String?`; `EmailMessage` has `toAddresses String[]`, `cc String[] @default([])`, `status EmailStatus @default(QUEUED)`, `nextAttemptAt DateTime?`, indexes incl. `@@index([status, nextAttemptAt])`; `EmailAttachment` soft FK `documentId` (no relation to Document); `EmailTemplate` `@@unique([tenantId, key])`. Add Tenant back-relations (`emailConfig`, `emailMessages`, `emailTemplates`). `EmailAttachment` relation to `EmailMessage` (cascade on delete).
- [ ] Step 2: Stop node (avoid the EPERM/no-engine gotcha — `Get-Process node | Stop-Process -Force`), then `pnpm db:migrate --name email_core`, `pnpm db:generate`, `pnpm --filter @pulsar/database build`. If migrate would require a destructive reset and prompts non-interactively, STOP + report BLOCKED.
- [ ] Step 3: Seed (idempotent, acme): 2 `EmailTemplate` (e.g. key `welcome`, `invoice` with `{{customerName}}`/`{{invoiceNumber}}` placeholders) + one `EmailMessage` SENT sample. Mirror the existing seed upsert style.
- [ ] Step 4: `pnpm db:seed` + quick row count check.
- [ ] Step 5: Commit `feat(email): prisma models, migration, seed`.

---

### Task 3: Core — EmailConfigService + low-level EmailService extension

**Files:** `apps/api/src/core/email/email-config.service.ts` (create), `email-config.controller.ts` (create), `dto/email-config.dto.ts` (create); extend `email.service.ts`; register in `email.module.ts`. Test in a new `apps/api/test/email-core.e2e-spec.ts`.

**Consumes:** `CryptoService`, `AuditLogsService`. **Produces:** `EmailConfigService.{get,upsert,resolve,sendTest}`; `EmailService.send(... + {from?,cc?,replyTo?,attachments?,transport?})`.

- [ ] Step 1: Extend low-level `EmailService.send` to accept an optional per-call transport + extras. Mirror the existing structure; add:
```ts
export interface SmtpTransportOptions { host: string; port: number; secure: boolean; user?: string; pass?: string; from?: string; }
export interface OutgoingEmail { to: string; subject: string; html: string; text?: string; cc?: string[]; replyTo?: string; from?: string; attachments?: { filename: string; content: Buffer }[]; }
async send(email: OutgoingEmail, transport?: SmtpTransportOptions): Promise<boolean>
```
When `transport` is given build a one-off `createTransport(...)` (use `transport.from` as default from); else keep the env transporter / log driver. Keep backward compatibility (existing callers pass only `email`).
- [ ] Step 2: `EmailConfigService.upsert(tenantId, dto)` mirrors `runtime-config.service.ts`: encrypt `password` via `CryptoService` into `passwordEnc` ONLY when provided; preserve existing otherwise. `get(tenantId)` returns a projection WITHOUT `passwordEnc` (+ a `hasPassword` boolean). `resolve(tenantId)`: returns decrypted `SmtpTransportOptions` from config, or `null` to signal env fallback. `sendTest(tenantId, to)`: resolve config → `emailService.send({to,subject:'Test Pulsar',html:'...'}, transport)`; update `lastTestAt/lastTestOk`. Audit upsert.
- [ ] Step 3: DTOs (`UpsertEmailConfigDto`: host/port/secure/username/password?/fromName/fromEmail/replyTo, class-validator) ; controller `GET/PUT /email-config` + `POST /email-config/test` gated `@RequirePermissions(PERMISSIONS.EMAIL.MANAGE)`.
- [ ] Step 4: e2e: PUT config (with password) → GET returns config WITHOUT password but `hasPassword:true`; PUT again without password → still hasPassword (preserved); POST /email-config/test returns ok with EMAIL_DRIVER=log. Run `pnpm --filter @pulsar/api test:e2e -- email-core` + typecheck.
- [ ] Step 5: Commit `feat(email): tenant SMTP config (encrypted) + low-level transport options`.

---

### Task 4: Core — MailService outbox + delivery worker

**Files:** `apps/api/src/core/email/mail.service.ts` (create); register in `email.module.ts`; extend `email-core.e2e-spec.ts`.

**Consumes:** `EmailConfigService.resolve`, `EmailService.send`, `DocumentsService.download`, prisma. **Produces:** `MailService.queue(tenantId, input)`, `MailService.processQueue(limit)` (`@Cron`), `MailService.deliver(messageId)`.

- [ ] Step 1: `queue(tenantId, input)` — persist `EmailMessage` (status QUEUED, toAddresses[], cc[], subject, html, text?, relatedType?/relatedId?, templateKey?, createdByUserId XOR agentId) + `EmailAttachment` rows from `input.attachments[{documentId,filename}]` (validate each document is tenant-owned via a tenant-scoped lookup) in one tx; then fire-and-forget `void this.deliver(msg.id)` (best-effort, never throws). Returns the message.
- [ ] Step 2: `deliver(messageId)` — load message (+attachments); guard `status !== QUEUED && status !== FAILED` → return. Claim-safe `updateMany({where:{id, status:{in:[QUEUED,FAILED]}}, data:{status:SENDING}})` (skip if count 0). Resolve tenant transport (`EmailConfigService.resolve` → or env fallback). Fetch attachment bytes via `DocumentsService.download(tenantId, documentId)` → `{filename, content}`. Call `emailService.send({to: toAddresses.join(','), cc, subject, html, text, from, replyTo, attachments}, transport)`. On success → `status:SENT, sentAt:now`. On failure → `attempts++`, `lastError`, and if `attempts < MAX_ATTEMPTS(5)` → `status:FAILED, nextAttemptAt = now + backoff(attempts)` else stays `FAILED` with no nextAttemptAt (give up). Never throws.
- [ ] Step 3: `@Cron(CronExpression.EVERY_MINUTE) processQueue()` — find `status: FAILED, nextAttemptAt <= now` (and any stuck QUEUED) limit 50, call `deliver` for each. Mirror `webhooks.service.ts` cron. Best-effort.
- [ ] Step 4: e2e: `MailService.queue` (resolve the service from the test app) → assert EmailMessage QUEUED created; call `deliver`/`processQueue` with EMAIL_DRIVER=log → assert status SENT + sentAt; queue with an attachment documentId → attachment row created and (log driver) no throw. Run e2e + typecheck.
- [ ] Step 5: Commit `feat(email): MailService outbox + retry delivery worker`.

---

### Task 5: Core — templates + AI draft + compose/list endpoints

**Files:** `email-templates.service.ts`, `templates.controller.ts`, `ai-draft.service.ts`, `emails.controller.ts` (+ DTOs) under `core/email/`; register; extend e2e.

**Consumes:** `interpolateTemplate` (`@pulsar/shared`), `MailService.queue`, `AgentRuntimeConfig` (per-tenant LLM). **Produces:** templates CRUD + render; `AiDraftService.draft(tenantId,{prompt,context?})`; `GET /emails`, `GET /emails/:id`, `POST /emails`, `POST /emails/draft`.

- [ ] Step 1: `EmailTemplatesService` CRUD (tenant-scoped, `@@unique([tenantId,key])`) + `render(tenantId, key, payload)` using `interpolateTemplate`. `templates.controller` `GET/POST/PUT/DELETE /emails/templates` gated `PERMISSIONS.EMAIL.MANAGE`.
- [ ] Step 2: `AiDraftService.draft(tenantId, {prompt, context?})` — INVESTIGATE how `AgentRuntimeService`/`runtime-config.service.ts` resolves the tenant provider + decrypted key + baseUrl; make a MINIMAL one-shot completion call to that provider (Anthropic/OpenRouter messages API) asking for `{subject, html}` for a business email; parse the response. If no `AgentRuntimeConfig` for the tenant → throw a clear `BadRequestException('No LLM configured')`. Best-effort; keep it a small focused service. (If a one-shot provider call proves too provider-specific, fall back to a single supported provider and report the limitation — do NOT spawn a full Hermes session.)
- [ ] Step 3: `emails.controller`: `GET /emails` (Paginated, filter status/relatedType/search, `PERMISSIONS.EMAIL.READ`), `GET /emails/:id` (with attachments), `POST /emails` (compose+queue: to[]/subject/html/text?/templateKey?/attachments[{documentId,filename}]/relatedType?/relatedId? → `MailService.queue` with author `{userId: user.id}`, `PERMISSIONS.EMAIL.SEND`), `POST /emails/draft` (`{prompt,context?}` → `AiDraftService.draft`, `PERMISSIONS.EMAIL.SEND`).
- [ ] Step 4: e2e: template CRUD + render interpolates `{{var}}`; `POST /emails` → EmailMessage QUEUED; `GET /emails` lists it; `POST /emails/draft` returns 400 when no LLM configured (assert the guard). Run e2e + typecheck.
- [ ] Step 5: Commit `feat(email): templates + AI draft + compose/list endpoints`.

---

### Task 6: Agent tools — draft_email + send_email (governed)

**Files:** `apps/api/src/core/agents/tools/email.tools.ts` (create); register in `tool-registry.ts`; extend `ToolServices` (`tool-types.ts`) + the `AGENT_TOOL_SERVICES` factory wiring; extend e2e.

**Consumes:** `AiDraftService`, `MailService`. **Produces:** tools `draft_email` (LOW), `send_email` (SENSITIVE).

- [ ] Step 1: `ToolServices.email = { draft(tenantId, input): Promise<unknown>; send(tenantId, input, author): Promise<unknown> }`. Wire in the `AGENT_TOOL_SERVICES` factory (mirror how the CRM/other services were wired; import the email module/services where the provider lives; no cycle).
- [ ] Step 2: `email.tools.ts` mirroring an existing tools file. `draft_email` tier `RiskTier.LOW`, perm `PERMISSIONS.EMAIL.SEND`, module undefined (core), zod `{prompt, context?}` → `services.email.draft`. `send_email` tier **`RiskTier.SENSITIVE`**, perm `PERMISSIONS.EMAIL.SEND`, module undefined, zod `{to: string|string[], subject, html, relatedType?, relatedId?, attachments?: {documentId,filename}[]}` → handler calls `services.email.send(tenantId, input, { agentId: ctx.principal.agentId })`. The SENSITIVE tier means the registry routes it through `handleMutatingTool` → ProposedAction automatically — do NOT bypass.
- [ ] Step 3: Register `emailTools` in `TOOL_REGISTRY`.
- [ ] Step 4: e2e: drive `send_email` through the governance path (mirror how an existing SENSITIVE/mutating tool is e2e-tested, e.g. via ProposedActionsService.handleMutatingTool or the MCP factory) → assert it ENQUEUES a ProposedAction (PENDING), does NOT send directly; approving it → an EmailMessage is queued. If a full MCP e2e is too heavy, unit-test that `send_email` is registered with tier SENSITIVE (so the factory queues it) + that `services.email.send` queues an EmailMessage. Run e2e + typecheck.
- [ ] Step 5: Commit `feat(email): governed agent draft_email + send_email tools`.

---

### Task 7: Migrate existing senders + one document auto-send hook

**Files:** modify `auth.service.ts`, `users.service.ts`, `billing/customer-invoices.service.ts`, `procurement.service.ts`, `transportation/loads/load-notifications.service.ts` (the current `EmailService.send` callers); `billing` invoice approve path for the PDF auto-send.

- [ ] Step 1: For each existing `emailService.send(...)` caller, switch to `mailService.queue(tenantId, {to:[...], subject, html, author:{userId?}|{}})` so every email is recorded in the outbox/history. Keep best-effort (queue never throws). Where a caller lacks a clean `tenantId` (e.g. password reset pre-auth), keep using the low-level `EmailService` OR pass the resolvable tenantId — do the minimal correct thing per caller; if a caller has no tenant context, leave it on low-level `EmailService.send` and note it. Inject `MailService` where needed (export from EmailModule).
- [ ] Step 2: Billing auto-send: on customer-invoice approve (or the existing send path), when the tenant's billing setting `autoEmailInvoicePdf` is true, generate/find the invoice PDF `Document` and `mailService.queue` with that attachment to the customer email. Add the `autoEmailInvoicePdf` setting to the billing module config (TenantModule.settings) — reuse the config framework; default false. Best-effort.
- [ ] Step 3: Verify build + run the existing billing/auth e2e suites that touch email to ensure no regression (`pnpm --filter @pulsar/api test:e2e -- billing` or the relevant specs) + typecheck.
- [ ] Step 4: Commit `feat(email): route existing senders through the outbox + billing invoice-PDF auto-send`.

---

### Task 8: Web — Courriels domain (history + composer + templates + config)

**Files:** `apps/web/src/lib/modules/navigation.ts` (add domain); `apps/web/src/routes/(app)/emails/+page.svelte` (history+composer), `emails/templates/+page.svelte`, `emails/config/+page.svelte`; small components under `$lib/components/email/`.

**Consumes:** `/emails`, `/emails/:id`, `POST /emails`, `POST /emails/draft`, `/emails/templates`, `/email-config` (+ test).

- [ ] Step 1: Nav: add a **Courriels** domain (icon `Mail` from lucide), `home:'/emails'`, prefixes `['/emails','/email-config']`, gate `anyPerms:[PERMISSIONS.EMAIL.READ]`, links Historique (`/emails`), Templates (`/emails/templates`, perm manage), Configuration (`/emails/config`, perm manage). (This is core, not a business module → no `module` gate.)
- [ ] Step 2: `/emails/+page.svelte` — paginated history (status Badge, to, subject, related, sentAt) with single-`$effect`+`untrack` filter pattern; a **Composer** panel (to, subject, html textarea, **« Rédiger avec l'IA »** → `POST /emails/draft` fills subject+html, **template** picker → load template into fields, **joindre un document** → document picker by id) → `POST /emails`. FR labels.
- [ ] Step 3: `/emails/templates/+page.svelte` — list + editor (key/name/subject/html, `{{var}}` hint). `/emails/config/+page.svelte` — SMTP form (host/port/secure/user/password write-only/from/replyTo) + **Envoyer un test** button.
- [ ] Step 4: `pnpm --filter @pulsar/web build` + `svelte-check` 0 errors. Commit `feat(email): Courriels web (history, composer, AI draft, templates, config)`.

---

### Task 9: Verify

- [ ] Step 1: Full e2e `pnpm --filter @pulsar/api test:e2e -- email-core` green; shared suite green; web build + svelte-check 0 errors.
- [ ] Step 2: Runtime smoke (dev up, EMAIL_DRIVER=log): PUT /email-config + test; POST /emails (compose) → GET /emails shows it SENT after the worker tick; POST /emails/draft (expect 400 if no LLM, or a draft if AgentRuntimeConfig set); template CRUD.
- [ ] Step 3: Browser: Courriels history, composer (+AI draft button, +attach, +template), templates editor, config + test.
- [ ] Step 4: Final commit if any test/fix added.

## Self-Review
- Coverage: per-tenant config (T3), outbox+worker (T4), templates+AI draft+endpoints (T5), agent tools (T6), migration+auto-send (T7), web (T8), enums/perms (T1), DB (T2), verify (T9). All spec sections mapped.
- Consistency: `EmailStatus`/`EmailDriver` identical shared↔schema (T1/T2); `MailService.queue` signature consumed by endpoints (T5), agent tool (T6), migrated senders (T7); encrypted-upsert preserves password (T3) mirrors runtime-config; outbox worker mirrors webhooks.service (T4).
- Risk flagged: `AiDraftService` one-shot provider call (T5 Step 2) — the uncertain piece; implementer investigates AgentRuntimeConfig + keeps it minimal with a clear unconfigured-error fallback.
