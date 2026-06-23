# Email Core — Design Spec

**Date:** 2026-06-22
**Branch:** `email-core` (off main)
**Status:** approved (brainstorm)

## Goal

Elevate Pulsar's email from a thin best-effort `EmailService.send` into a first-class
platform capability: per-tenant SMTP config, a durable outbox/history, templates,
document attachments, AI-assisted drafting, governed agent send, and unification of
all existing ad-hoc senders onto one pipeline — so Pulsar can send (and auto-send)
documents and AI-drafted emails from the core and its processes.

## Decisions (from brainstorm)

1. Full v1: foundation + agent send + template management UI + AI drafting + auto-send wiring.
2. **SMTP per tenant** only in v1 (encrypted), with fallback to the global env config. API
   providers (Resend/SendGrid) → backlog.
3. **Inbound email reception → backlog** (send-only in v1).
4. AI drafting via the tenant's configured LLM provider (the existing `AgentRuntimeConfig`).
5. Agent send is an external effect → governed (SENSITIVE → ProposedAction queue).

## Existing building blocks (reuse, don't reinvent)

- `apps/api/src/core/email/email.service.ts` — `EmailService.send(OutgoingEmail)` (log/smtp,
  nodemailer). Becomes the low-level transport used by the new `MailService`.
- `CryptoService` (`core/crypto`) — encrypt/decrypt for SMTP password (mirror `AgentRuntimeConfig.apiKeyEnc`, rule 25).
- `AgentRuntimeConfig` (per-tenant LLM provider, encrypted key) — reused by AI drafting.
- `DocumentsService` (rule 12) — attachment bytes.
- `interpolateTemplate(tpl, payload)` in `@pulsar/shared` (automation/rules) — template rendering.
- `ProposedActionsService` + tool registry + `handleMutatingTool` — governance for the agent send tool.
- Webhook outbox (`webhook_deliveries`, retries+backoff) — the model to mirror for the email outbox worker.

## Hard rules this work must follow

- Tenant isolation (rule 1): all queries filter `tenantId`; per-tenant config selected by tenant.
- Secrets encrypted via `CryptoService`, never returned in clear (rule 26 spirit; mirror rule 25).
- Files via `DocumentsService` only (rule 12).
- Agent tools via the registry (rule 21); `send_email` is SENSITIVE → ProposedAction (rule 22);
  auto-act vs propose via `evaluatePolicy` + caps (rule 29); external effects governed (rule 38 spirit).
- Permissions (rule 5): new core keys + catalog.
- Audit (rule 6): config changes + sends recorded (the EmailMessage row + AuditLog for config).
- Enums in `@pulsar/shared` mirrored in schema (rule 3); rebuild shared/database after (rule 7).

## Data model (new Prisma models, tenant-scoped + indexed)

### `TenantEmailConfig` (one per tenant)
- `id, tenantId @unique`
- `driver EmailDriver @default(SMTP)` (enum `SMTP` only in v1; enum reserves future API drivers)
- `host String?`, `port Int?`, `secure Boolean @default(false)`, `username String?`
- `passwordEnc String?` (SMTP password, encrypted via CryptoService — never returned)
- `fromName String?`, `fromEmail String?`, `replyTo String?`
- `active Boolean @default(true)`
- `lastTestAt DateTime?`, `lastTestOk Boolean?`
- `createdAt, updatedAt`

### `EmailMessage` (outbox + history; the single record of every email)
- `id, tenantId`
- `toAddresses String[]`, `cc String[] @default([])`
- `subject String`, `html String`, `text String?`
- `status EmailStatus @default(QUEUED)` (enum `QUEUED | SENDING | SENT | FAILED`)
- `attempts Int @default(0)`, `lastError String?`, `provider String?`
- `relatedType String?`, `relatedId String?` (polymorphic link: deal/invoice/shipment/…)
- `templateKey String?`
- `createdByUserId String?`, `agentId String?` (author; one set — user or agent)
- `sentAt DateTime?`, `nextAttemptAt DateTime?`, `createdAt, updatedAt`
- relations: `attachments EmailAttachment[]`
- `@@index([tenantId])`, `@@index([tenantId, status])`, `@@index([tenantId, createdAt])`, `@@index([status, nextAttemptAt])` (worker scan)

### `EmailAttachment`
- `id, tenantId, emailMessageId` (FK), `documentId String` (soft FK to Document), `filename String`
- `@@index([tenantId, emailMessageId])`

### `EmailTemplate`
- `id, tenantId, key String, name String, subject String, html String, category String?`
- `createdAt, updatedAt`, `@@unique([tenantId, key])`, `@@index([tenantId])`

Migration + reseed: a couple of demo templates + maybe a sample sent EmailMessage for the acme tenant.

## Shared (`@pulsar/shared/email`, pure)
- Enums `EmailDriver` (`SMTP`), `EmailStatus` (`QUEUED|SENDING|SENT|FAILED`).
- (Reuse `interpolateTemplate` for rendering — no new copy.)
- Mirrored in schema.prisma.

## Core services (`apps/api/src/core/email/`)

### `MailService` (the pipeline entry point)
- `queue(tenantId, input: { to[]; cc?; subject; html; text?; relatedType?; relatedId?; templateKey?; attachments?: {documentId,filename}[]; author: {userId?|agentId?} }): Promise<EmailMessage>` — persists an `EmailMessage` (status QUEUED) + attachment rows; returns it. NEVER throws on transport issues (the worker handles delivery).
- `processQueue(limit)` (`@Cron`, best-effort, never throws) — claims QUEUED/retryable FAILED rows (`status, nextAttemptAt`), sets SENDING (claim-safe `updateMany`), resolves the tenant's `TenantEmailConfig` (decrypt password) or falls back to env, renders attachments via `DocumentsService.download`, calls the low-level transport (extend `EmailService` to accept per-message transport options + attachments + from), then marks SENT (sentAt) or FAILED (attempts++, lastError, nextAttemptAt backoff, give up after N like webhooks).
- `sendTest(tenantId)` — sends a test email using the tenant config; updates lastTestAt/lastTestOk.

### `EmailConfigService`
- `get(tenantId)` (projection WITHOUT passwordEnc), `upsert(tenantId, dto)` (encrypts password via CryptoService only when provided; preserves existing otherwise — mirror runtime-config.service), audited.

### `EmailTemplatesService` — CRUD, tenant-scoped; render(templateKey, payload) via interpolateTemplate.

### `AiDraftService`
- `draft(tenantId, { prompt, context? }): Promise<{ subject; html }>` — one-shot LLM completion using the tenant's `AgentRuntimeConfig` (decrypt key; call the provider's completion API directly — a minimal fetch; reuse however AgentRuntimeService resolves provider/baseURL). Returns a drafted subject + html. Best-effort; clear error if no LLM configured.

### Extend `EmailService` (low-level)
- `send(OutgoingEmail + { from?, cc?, replyTo?, attachments?: {filename, content: Buffer}[], transport?: SmtpTransportOptions })` — build a per-call transporter when tenant transport options are given, else the env transporter/log. Keep backward-compatible default.

## API (`apps/api/src/core/email/*.controller.ts`)
All gated `@RequirePermissions(core.email.*)`, tenant-scoped, Paginated lists.
- `GET /emails` (outbox/history, filter status/relatedType, search) ; `GET /emails/:id` (with attachments) ; `POST /emails` (compose+queue: to/subject/html/attachments[documentId]/templateKey?) — perm `core.email.send`.
- `POST /emails/draft` (AI draft) — perm `core.email.send`, body {prompt, context?}.
- `GET/POST/PUT/DELETE /emails/templates` — perm `core.email.manage`.
- `GET/PUT /email-config` (+ `POST /email-config/test`) — perm `core.email.manage`; never returns passwordEnc.

Permissions (catalog): `core.email.read`, `core.email.send`, `core.email.manage`.

## Agent tools (`core/agents/tools/email.tools.ts`, registry)
- `draft_email` — tier READ/LOW, perm `core.email.send`, module undefined (core). Returns `AiDraftService.draft` result (a draft; no send).
- `send_email` — tier **SENSITIVE**, perm `core.email.send`, module undefined. Routes through `handleMutatingTool` → ProposedAction (auto only if autonomy+caps allow). On execute → `MailService.queue` (author = agentId). Inputs: to, subject, html, relatedType?/relatedId?, attachments?(documentId). The SDR drafts the body in its turn then calls send_email.

## Auto-send wiring (core + processes)
- Migrate existing `EmailService.send` callers onto `MailService.queue` (so everything is in the outbox/history): auth (reset/invite), users, billing customer-invoices, procurement, transportation load-notifications. Keep best-effort semantics.
- New configurable auto-send hooks via the module config framework (`TenantModule.settings` toggles), e.g. billing `autoEmailInvoicePdf` (on invoice approve → queue email with the PDF document attached). v1 wires at least ONE concrete document auto-send (billing invoice PDF) as the pattern; others follow.

## Web (`apps/web/src/routes/(app)/emails/`)
New nav domain **Courriels** (icon Mail), gated on `core.email.read`.
- `/emails` — outbox/history (status badges, to, subject, related, sentAt) + detail drawer; **Composer** (to, subject, rich-ish html textarea, **« Rédiger avec l'IA »** → `POST /emails/draft`, **joindre un document** picker, **template** picker) → `POST /emails`.
- `/emails/templates` — template list + editor (key/name/subject/html with {{variables}} hint).
- `/emails/config` (or under settings) — per-tenant SMTP config form (host/port/secure/user/password/from/replyTo) + **Envoyer un test**; password write-only.
- Contextual « Rédiger un courriel » from CRM (deal/company) prefilling relatedType/relatedId — light hook.

## Out of scope (v1, backlog)
Inbound email reception (IMAP/parsing); API providers (Resend/SendGrid); rich drag&drop template builder; open/click tracking; marketing sequences/campaigns; per-recipient personalization batches.

## Testing
- Unit (shared): EmailStatus/EmailDriver enums; (interpolateTemplate already tested).
- API e2e (`email-core.e2e-spec.ts`): config upsert (password encrypted, never returned) + test; compose → EmailMessage QUEUED → processQueue (with EMAIL_DRIVER=log) → SENT; template CRUD + render; attachment by documentId; AI draft endpoint (stub/skip if no LLM — assert 4xx when unconfigured); agent send_email enqueues a ProposedAction (SENSITIVE, not direct send); migrated sender still records an EmailMessage.
- Browser: Courriels list, composer + AI draft + attach + send, template editor, config + test.

## Build phases (the plan expands these into tasks)
1. shared enums + permissions + module/nav keys.
2. DB models + migration + seed.
3. core: EmailConfigService + extend low-level EmailService (transport opts/attachments/from).
4. core: MailService (queue + processQueue worker) + outbox + e2e.
5. core: EmailTemplatesService + AiDraftService + endpoints + e2e.
6. agent tools draft_email/send_email (governed) + e2e (send_email → ProposedAction).
7. migrate existing senders to MailService + one billing auto-send-PDF hook.
8. web: Courriels (history + composer + AI draft + attach + template/config) + nav.
9. verify (e2e + browser).
