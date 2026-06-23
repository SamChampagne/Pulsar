# CRM Lists & Campaigns Plan (CRM-Attio sub-project #5)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Marketing-style email to CRM contacts: static **lists** (audiences) + **campaigns** that render a template with merge variables and send one email per list member through the existing outbox, with per-recipient stats.

**Architecture:** New models `CrmList`, `CrmListMember`, `CrmCampaign`. Campaign send loops list members → `MailService.queue` (one EmailMessage per recipient, `relatedType='crm-campaign'`, `relatedId=campaignId`), body rendered via `interpolateTemplate`. Stats derived from `EmailMessage` rows. Reuses email core + CRM contacts. Branch `crm-campaigns` off main.

**Tech Stack:** NestJS, Prisma, SvelteKit (Svelte 5 runes), `@pulsar/shared`, class-validator, jest e2e.

## Global Constraints
- Tenant isolation (rule 1): all queries filter tenantId; FK (listId/contactId/templateKey) validated tenant-owned.
- Bulk send goes through `MailService.queue` (outbox, best-effort, retried) — NO new transport path. One `EmailMessage` per recipient.
- Campaign status transitions claim-safe (`updateMany` DRAFT→SENDING) to prevent double-send.
- Merge rendering via `interpolateTemplate` (`@pulsar/shared`, single-brace `{var}`).
- Permissions: `crm.read` (view), `crm.manage` (manage + send). Controllers `@RequireModule(MODULE_KEYS.CRM)`.
- Enum in `@pulsar/shared` mirrored in prisma (rule 3).
- **CASL note:** unsubscribe/compliance is OUT of v1 (backlog) — flag in UI that real marketing sends need an unsubscribe mechanism first.

---

### Task 1: Shared — CrmCampaignStatus enum
**Files:** `packages/shared/src/crm/crm.workflow.ts` (extend) + spec.
- [ ] Step 1: Add `export enum CrmCampaignStatus { DRAFT='DRAFT', SENDING='SENDING', SENT='SENT' }`. (Already exported via index.) Add a tiny spec assertion.
- [ ] Step 2: shared vitest green; `pnpm --filter @pulsar/shared build`. Commit `feat(crm-camp): CrmCampaignStatus enum`.

---

### Task 2: Database — list/member/campaign models
**Files:** `schema.prisma`, `seed.ts`.
- [ ] Step 1: Add `enum CrmCampaignStatus { DRAFT SENDING SENT }` + models:
```prisma
model CrmList {
  id String @id @default(cuid())
  tenantId String
  name String
  description String?
  ownerUserId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant Tenant @relation(fields: [tenantId], references: [id])
  members CrmListMember[]
  campaigns CrmCampaign[]
  @@index([tenantId])
}
model CrmListMember {
  id String @id @default(cuid())
  tenantId String
  listId String
  contactId String
  createdAt DateTime @default(now())
  list CrmList @relation(fields: [listId], references: [id], onDelete: Cascade)
  @@unique([listId, contactId])
  @@index([tenantId, listId])
}
model CrmCampaign {
  id String @id @default(cuid())
  tenantId String
  name String
  listId String
  subject String
  html String
  templateKey String?
  status CrmCampaignStatus @default(DRAFT)
  ownerUserId String?
  sentAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant Tenant @relation(fields: [tenantId], references: [id])
  list CrmList @relation(fields: [listId], references: [id])
  @@index([tenantId])
  @@index([tenantId, status])
}
```
Add Tenant back-relations (`crmLists`, `crmCampaigns`).
- [ ] Step 2: Stop node (`Get-Process node | Stop-Process -Force`), `pnpm db:migrate --name crm_campaigns`, `pnpm db:generate`, `pnpm --filter @pulsar/database build`. BLOCKED-report if a destructive reset is required.
- [ ] Step 3: Seed (acme, idempotent): one `CrmList` "Prospects Québec" with the 2 seeded contacts as members + one DRAFT `CrmCampaign`. Commit `feat(crm-camp): list/member/campaign models + migration + seed`.

---

### Task 3: API — lists + campaigns + send + stats
**Files:** `apps/api/src/modules/crm/lists.service.ts` + `lists.controller.ts` + dto; `campaigns.service.ts` + `campaigns.controller.ts` + dto; register in `crm.module.ts`; extend `apps/api/test/crm-module.e2e-spec.ts`.

**Consumes:** `MailService.queue` (inject from the global EmailModule), `interpolateTemplate`, `EmailTemplatesService` (optional, for templateKey), `OwnershipService`/tenant lookups, `CrmCampaignStatus`.

- [ ] Step 1: `ListsService` — CRUD (tenant-scoped, Paginated), `addMember(tenantId, listId, contactId)` (validate both tenant-owned; idempotent on `@@unique`), `removeMember`, `members(listId)` (contacts joined), `addCompanyContacts(tenantId, listId, companyId)` (add all of a company's contacts that have an email). `ListsController` `/crm/lists` + member sub-routes, gated `@RequireModule(CRM)` + read/manage.
- [ ] Step 2: `CampaignsService`:
  - CRUD (`/crm/campaigns`, status defaults DRAFT). On create/update accept name/listId/subject/html/templateKey (validate listId tenant-owned).
  - `send(tenantId, id, userId)`: claim `updateMany({where:{id,tenantId,status:DRAFT}, data:{status:SENDING}})` (throw 400 if count 0 — not DRAFT). Load the campaign + its list members' contacts (tenant-scoped) that have a non-empty email. For each contact build payload `{ name: contact.name, email: contact.email, title: contact.title ?? '', company: contact.company?.name ?? '' }`; render `subject2 = interpolateTemplate(campaign.subject, payload)`, `html2 = interpolateTemplate(campaign.html, payload)`; call `await mail.queue(tenantId, { toAddresses:[contact.email], subject: subject2, html: html2, relatedType:'crm-campaign', relatedId: id, createdByUserId: userId })`. Best-effort per recipient (wrap each in try/catch so one failure doesn't abort the batch). After the loop set `status:SENT, sentAt:now`. Return `{ queued: <count> }`.
  - `stats(tenantId, id)`: groupBy `EmailMessage.status` where `tenantId, relatedType:'crm-campaign', relatedId:id` → `{ total, sent, failed, queued }`.
  - `CampaignsController` `/crm/campaigns` CRUD + `POST :id/send` (`@HttpCode(200)`, perm crm.manage) + `GET :id/stats` (perm crm.read).
- [ ] Step 3: e2e: create list + add the 2 contacts; create campaign (subject "Bonjour {name}", html "<p>{name} chez {company}</p>", listId); `POST :id/send` → returns queued≥1, campaign status SENT; `GET :id/stats` total≥ members-with-email; assert EmailMessages exist with relatedType='crm-campaign', relatedId=campaign, and the rendered subject contains a contact name (merge worked); re-send a SENT campaign → 400. Run `pnpm --filter @pulsar/api test:e2e -- crm-module` green + typecheck.
- [ ] Step 4: Commit `feat(crm-camp): lists + campaigns API (send via outbox + stats) + e2e`.

---

### Task 4: Web — Lists + Campaigns
**Files:** `apps/web/src/routes/(app)/crm/lists/+page.svelte`, `apps/web/src/routes/(app)/crm/campaigns/+page.svelte`; `apps/web/src/lib/modules/navigation.ts` (CRM nav: Listes, Campagnes).
- [ ] Step 1: Nav — add Listes (`/crm/lists`) + Campagnes (`/crm/campaigns`) to the CRM domain (perm crm.read), under the `/crm` prefix.
- [ ] Step 2: `/crm/lists` — list of lists (name, member count) + create; selecting a list shows members (contacts) with add (pick a contact / "ajouter les contacts d'une société") + remove. Single-`$effect`+`untrack` pattern. FR labels.
- [ ] Step 3: `/crm/campaigns` — list of campaigns (name, list, status Badge, sentAt) + create/edit (name, pick list, subject, html textarea with a `{name}/{company}` merge hint, template picker via `GET /emails/templates`, **« Rédiger avec l'IA »** via `POST /emails/draft`). Detail/row: **Envoyer** button (confirm) → `POST /crm/campaigns/:id/send` then show **stats** (`GET :id/stats`: total/sent/failed). Show a small note: "Ajoutez un lien de désinscription avant un envoi marketing réel (CASL)." FR labels.
- [ ] Step 4: `pnpm --filter @pulsar/web build` + svelte-check 0 errors. Commit `feat(crm-camp): Lists + Campaigns web`.

---

### Task 5: Verify
- [ ] Step 1: crm e2e green; shared green; web build + svelte-check 0 errors.
- [ ] Step 2: Runtime smoke (dev): create a list + members, a campaign with merge vars, send → emails appear in /emails (relatedType=crm-campaign, rendered per recipient) + stats populate.
- [ ] Step 3: Final commit if any fix.

## Self-Review
- Coverage: enum (T1), models (T2), lists+campaigns+send+stats API (T3), web (T4), verify (T5).
- Consistency: `relatedType='crm-campaign'` used in send (T3) + stats (T3) + smoke (T5); `interpolateTemplate` `{var}` matches the hint shown in the composer (T4); CrmCampaignStatus shared (T1) = prisma (T2).
- Constraints: claim-safe DRAFT→SENDING (no double-send); per-recipient try/catch (best-effort); outbox-only send; tenant-scoped throughout; CASL unsubscribe flagged as backlog in UI.
