# CRM Emails-in-Record Plan (CRM-Attio sub-project #2)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Surface the email history on a CRM record (company/contact) and let the user compose + send (with AI draft) a governed email directly from the record — connecting the email core to the CRM. Reuses `EmailMessage.relatedType/relatedId` (already in the schema) and the core email endpoints.

**Architecture:** Add a `relatedId` filter to `GET /emails`; a reusable web `RecordEmails` component that lists `GET /emails?relatedType=&relatedId=` and composes via `POST /emails` (with relatedType/relatedId preset) + `POST /emails/draft` (AI). Wire into the CRM company detail page + contact panel. relatedType values: `crm-company`, `crm-contact`. Branch `crm-emails-in-record` off main.

**Tech Stack:** NestJS, SvelteKit (Svelte 5 runes), `api<T>()`, jest e2e.

## Global Constraints
- Tenant isolation (rule 1): the `relatedId` filter is applied within the existing tenant-scoped `where`.
- Email send remains best-effort via the outbox (`POST /emails` → MailService.queue). No new send path.
- Web: `$state`+`$effect`, FR labels, reuse existing UI primitives, tolerate empty bodies.

---

### Task 1: API — `relatedId` filter on GET /emails

**Files:** `apps/api/src/core/email/dto/list-emails-query.dto.ts`, `apps/api/src/core/email/emails.service.ts`; extend `apps/api/test/email-core.e2e-spec.ts`.

- [ ] Step 1: Add `@IsOptional() @IsString() @MaxLength(64) relatedId?: string;` to `ListEmailsQueryDto`.
- [ ] Step 2: In `emails.service.ts` list `where`, add `...(query.relatedId ? { relatedId: query.relatedId } : {})` (alongside the existing relatedType filter, inside the tenant-scoped where).
- [ ] Step 3: e2e: queue two emails with `relatedType:'crm-company', relatedId:'X'` and one with relatedId:'Y' (via MailService or POST /emails); `GET /emails?relatedType=crm-company&relatedId=X` returns only the X ones. Run `pnpm --filter @pulsar/api test:e2e -- email-core` green + `cd apps/api && npx tsc --noEmit` clean.
- [ ] Step 4: Commit `feat(crm-email): relatedId filter on GET /emails`.

---

### Task 2: Web — RecordEmails component + wire into CRM company/contact

**Files:** Create `apps/web/src/lib/components/crm/RecordEmails.svelte`; modify `apps/web/src/routes/(app)/crm/companies/[id]/+page.svelte` (company detail) and `apps/web/src/routes/(app)/crm/contacts/+page.svelte` (contact side panel).

**Interfaces — Consumes:** `GET /emails?relatedType=&relatedId=&page=&pageSize=`, `POST /emails`, `POST /emails/draft`.

- [ ] Step 1: `RecordEmails.svelte` — props `{ relatedType: string; relatedId: string; defaultTo?: string }`.
  - Loads `GET /emails?relatedType={relatedType}&relatedId={relatedId}` (single `$effect`, paginated or top 20) → lists emails (status Badge, to, subject, sentAt). Empty state "Aucun courriel".
  - A "Rédiger un courriel" button toggles a small composer: `to` (prefilled with `defaultTo` if given), `subject`, `html` (textarea), a "Rédiger avec l'IA" button → `POST /emails/draft {prompt}` (prompt input) fills subject+html (toast the 400 if no LLM), and "Envoyer" → `POST /emails { to:[...], subject, html, relatedType, relatedId }` → on success refresh the list + toast. FR labels. Reuse existing Button/Badge/Card/Textarea/Input.
- [ ] Step 2: Company detail page (`/crm/companies/[id]`): add a "Courriels" section rendering `<RecordEmails relatedType="crm-company" relatedId={company.id} defaultTo={firstContactEmail} />` where firstContactEmail is the email of the company's first contact if any (else undefined).
- [ ] Step 3: Contact side panel (`crm/contacts/+page.svelte`): when a contact is selected, render `<RecordEmails relatedType="crm-contact" relatedId={contact.id} defaultTo={contact.email ?? undefined} />`.
- [ ] Step 4: `pnpm --filter @pulsar/web build` + `svelte-check` 0 errors (pre-existing CustomFieldInputs warning OK). Commit `feat(crm-email): RecordEmails component + company/contact record email history & compose`.

---

### Task 3: Verify
- [ ] Step 1: email-core e2e green; web build + svelte-check 0 errors.
- [ ] Step 2: Runtime smoke (dev): from a CRM company detail, compose an email (optionally AI draft) → it appears in the record's Courriels list (status QUEUED→SENT after worker) and in /emails history with relatedType=crm-company.
- [ ] Step 3: Final commit if any fix.

## Self-Review
- Coverage: relatedId filter (T1), record email list + compose-from-record (T2), verify (T3). Reuses EmailMessage.relatedType/relatedId + email endpoints.
- Consistency: relatedType values `crm-company`/`crm-contact` set on compose (T2) match the filter used by the list (T2) and the filter param added (T1).
- Note: deals have no detail page yet (backlog from #1) → deal-level email history deferred; can add when a deal detail/form exists.
