# CRM Custom Fields Implementation Plan (CRM-Attio sub-project #1)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Give CRM the Attio-style flexible data model by applying Pulsar's proven custom-fields recipe (rule 36) to CRM Companies, Contacts, and Deals — user-defined fields, validated at intake, editable in the record forms, configurable from /crm/config.

**Architecture:** Reuse the generic `CustomFieldsService` (core/custom-fields) parameterized by module `'crm'` + new `CustomFieldEntity` values. `customData Json?` columns hold values; `CustomFieldDefinition` (tenant-scoped, `@@unique([tenantId, module, entityType, key])`) holds definitions. Mirror the billing/wms custom-fields controllers + the wms intake-validation pattern. Branch `crm-custom-fields` off main.

**Tech Stack:** NestJS, Prisma, SvelteKit (Svelte 5 runes), `@pulsar/shared`, class-validator, jest e2e.

## Global Constraints
- `customData` values ALWAYS validated via `CustomFieldsService.validateValues('crm', tenantId, entityType, data, {partial})` before persistence — never written unvalidated (rule 35/36), on create AND update.
- Definitions live in `CustomFieldDefinition` (tenant-scoped); the `crm/custom-fields` controller is `@RequireModule(MODULE_KEYS.CRM)` + `PERMISSIONS.CORE.MODULES_MANAGE` (read) / manage (write) — mirror the billing controller exactly.
- Enum values in `@pulsar/shared` mirrored where needed; tenant isolation (rule 1).
- Web: `$state`+`$effect`, `api<T>()`, FR labels, reuse `CustomFieldsEditor` + `CustomFieldInputs` components.

---

### Task 1: Shared — CRM entity types

**Files:** `packages/shared/src/config/custom-fields.ts` (+ its spec if present).

- [ ] Step 1: Add `CRM_COMPANY = 'CRM_COMPANY'`, `CRM_CONTACT = 'CRM_CONTACT'`, `CRM_DEAL = 'CRM_DEAL'` to the `CustomFieldEntity` enum.
- [ ] Step 2: CHECK if `custom-fields.ts` (or the service) has a module→allowed-entityTypes map/guard. If yes, add a `crm: [CRM_COMPANY, CRM_CONTACT, CRM_DEAL]` mapping; if no such map exists (validateValues/listDefinitions just take module+entityType freely), no extra change. Document which is the case.
- [ ] Step 3: Build shared (`pnpm --filter @pulsar/shared build`); run shared vitest (green, incl. existing custom-fields tests). Commit `feat(crm-cf): CRM custom-field entity types`.

---

### Task 2: Database — customData on Contact + Deal

**Files:** `packages/database/prisma/schema.prisma` (CrmContact, CrmDeal).

- [ ] Step 1: Add `customData Json?` to `CrmContact` and `CrmDeal` (CrmCompany already has it).
- [ ] Step 2: Stop node (EPERM guard): `Get-Process node | Stop-Process -Force`. Then `pnpm db:migrate --name crm_custom_data` → `pnpm db:generate` → `pnpm --filter @pulsar/database build`. If a destructive reset would be required non-interactively → STOP, report BLOCKED.
- [ ] Step 3: Commit `feat(crm-cf): customData on CrmContact + CrmDeal`.

---

### Task 3: API — crm/custom-fields controller + intake validation

**Files:** Create `apps/api/src/modules/crm/custom-fields/crm-custom-fields.controller.ts` (+ register in `crm.module.ts`); modify `companies.service.ts`, `contacts.service.ts`, `deals.service.ts` + their create/update DTOs (`customData?: Record<string,unknown>`); extend `apps/api/test/crm-module.e2e-spec.ts`.

- [ ] Step 1: `CrmCustomFieldsController` mirroring `apps/api/src/modules/billing/custom-fields/billing-custom-fields.controller.ts` exactly, but `@Controller('crm/custom-fields')`, `@RequireModule(MODULE_KEYS.CRM)`, delegating to `CustomFieldsService.listDefinitions('crm', tenantId, entityType)` + `replaceDefinitions('crm', ...)`. Inject `CustomFieldsService` (import its module into CrmModule).
- [ ] Step 2: In `CompaniesService.create/update`, `ContactsService.create/update`, `DealsService.create/update`: add `customData` to the DTO; before persist call `const customData = await this.customFields.validateValues('crm', tenantId, CustomFieldEntity.CRM_COMPANY|CRM_CONTACT|CRM_DEAL, dto.customData, { partial: <false on create, true on update> })` and write `...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {})`. Mirror `apps/api/src/modules/wms/receiving/receiving.service.ts` (create partial:false, update partial:true). Inject `CustomFieldsService`.
- [ ] Step 3: e2e: PUT a CRM_DEAL custom-field definition via `/crm/custom-fields`; create a deal with a valid `customData` value → persisted; create with an UNKNOWN field key → rejected (400); GET deal returns customData. Run `pnpm --filter @pulsar/api test:e2e -- crm-module` green + typecheck.
- [ ] Step 4: Commit `feat(crm-cf): crm/custom-fields API + intake validation on company/contact/deal`.

---

### Task 4: Web — /crm/config + custom-field inputs in forms

**Files:** Create `apps/web/src/routes/(app)/crm/config/+page.svelte`; modify `apps/web/src/lib/modules/navigation.ts` (CRM nav Configuration link); modify the CRM company/contact/deal create/edit forms (companies/contacts pages + LogActivity-adjacent deal forms) to include `CustomFieldInputs`.

- [ ] Step 1: `/crm/config/+page.svelte` — render `CustomFieldsEditor` for the three CRM entity types (Sociétés=CRM_COMPANY, Contacts=CRM_CONTACT, Deals=CRM_DEAL). Mirror how `/settings/modules/[key]` renders `CustomFieldsEditor module="..."` — but `CustomFieldsEditor` selects entity types by `module`; verify it supports `module="crm"` + the 3 entity types (it has per-module entity-type lists — ADD a CRM branch to `CustomFieldsEditor.svelte`'s `entityTypes` derived: `moduleProp === 'crm' → [{value:'CRM_COMPANY',label:'Sociétés'},{value:'CRM_CONTACT',label:'Contacts'},{value:'CRM_DEAL',label:'Deals'}]`).
- [ ] Step 2: Nav: add a Configuration link to the CRM domain (`/crm/config`, perm `PERMISSIONS.CORE.MODULES_MANAGE`) — mirror the in-module config pattern; ensure `/crm/config` is under the crm prefix (it is, `/crm`).
- [ ] Step 3: In the company side panel/detail form and contact form (and deal create form if present), include `CustomFieldInputs` (load definitions for the entity type via `GET /crm/custom-fields?entityType=...`, bind values into the create/update payload's `customData`). Mirror how an existing module page uses `CustomFieldInputs` (e.g. a wms or transportation form).
- [ ] Step 4: `pnpm --filter @pulsar/web build` + `svelte-check` 0 errors. Commit `feat(crm-cf): /crm/config custom-fields editor + custom-field inputs in records`.

---

### Task 5: Verify
- [ ] Step 1: Full CRM e2e green; shared green; web build + svelte-check 0 errors.
- [ ] Step 2: Runtime smoke (dev): define a CRM_DEAL field at /crm/config; create/edit a deal with the custom value; confirm it persists + shows.
- [ ] Step 3: Final commit if any fix.

## Self-Review
- Coverage: entity types (T1), columns (T2), API+validation (T3), web editor+inputs (T4), verify (T5). Mirrors the proven rule-36 recipe.
- Consistency: `CustomFieldEntity.CRM_*` used in shared (T1), API validation (T3), and the web editor entity-type list (T4); `validateValues('crm', ...)` intake on create(partial:false)/update(partial:true) like wms.
- Check-first flagged: module→entityType guard existence (T1.2); `CustomFieldsEditor`/`CustomFieldInputs` module support (T4).
