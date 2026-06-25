# Module Sites — Landing pages → leads CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Un nouveau module `sites` : des landing pages (blocs) hébergées par Pulsar, accessibles par slug public, dont le formulaire crée un lead (CrmContact) dans le CRM.

**Architecture:** Nouveau module `MODULE_KEYS.SITES`. `LandingPage` (slug public unique, blocs JSON, statut) + `LandingPageSubmission`. Helpers purs (slugify, mapSubmissionToContact) dans `@pulsar/shared`. API admin gated `@RequireModule(SITES)` + route PUBLIQUE (projection sans tenantId — R10 — qui re-vérifie l'activation module — R15). Soumission → submission + (si CRM actif) CrmContact dédupé, via `ModuleRef` (pas d'import statique de CrmModule). Éditeur web + page publique `/p/[slug]`.

**Tech Stack:** NestJS, Prisma/Postgres, SvelteKit (Svelte 5 runes), Vitest (shared), Jest+supertest (e2e). Aucune nouvelle dépendance.

## Global Constraints

- **Recette d'ajout de module (CLAUDE.md):** clé dans `modules.ts` (`available: true`), permissions dans `permissions.ts`, modèles Prisma (`tenantId`+index), contrôleurs gated `@RequireModule(MODULE_KEYS.SITES)`, enregistrés dans `app.module.ts`, nav conditionnée sur `enabledModules`, seed/enable.
- **R1:** admin queries tenant-scopées (JWT). **R3:** enum `LandingPageStatus` dans `@pulsar/shared` ET schema.prisma. **R6:** audit create/update/publish/delete. **R9:** `captureListId` vérifié si fourni.
- **R10 (public):** `GET /public/sites/:slug` renvoie une **projection explicite** — JAMAIS `tenantId`/refs internes. **R15 (public):** le service public **re-vérifie l'activation du module** via `TenantModulesCacheService` (les routes publiques contournent ModulesGuard) + `status === PUBLISHED` ; sinon 404.
- **Pas de cycle de module:** `SitesModule` n'importe PAS `CrmModule` statiquement. La soumission résout `ContactsService`/`ListsService` via `ModuleRef.get(..., { strict: false })` + lazy `require()` si besoin (patron `ReactionExecutorService`, règle 38) — best-effort.
- **Imports Prisma via `@pulsar/database`.** Listes `Paginated<T>`. DTO class-validator ; update via `PartialType`. Web : idiomes existants (réutiliser).
- **Templates de référence:** `apps/api/src/modules/customer-portal/portal.controller.ts` + son service (route publique + re-check module via cache — R10/R15) ; `apps/api/src/modules/crm/products.service.ts` (CRUD admin) ; `apps/web/.../crm/products/+page.svelte` (liste) + `crm/deals/[id]/+page.svelte` (détail/éditeur). Lire le template nommé avant d'écrire.

---

### Task 1: Shared — enum + helpers purs (slugify, mapSubmissionToContact, validateLandingContent)

**Files:**
- Create: `packages/shared/src/sites/landing.ts`
- Create: `packages/shared/src/sites/landing.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `enum LandingPageStatus { DRAFT='DRAFT', PUBLISHED='PUBLISHED' }`; `slugify(input: string): string`; `mapSubmissionToContact(data: Record<string, unknown>): { name?: string; email?: string; phone?: string; companyName?: string; message?: string }`; `validateLandingContent(content: unknown): boolean`; consts `LANDING_BLOCK_TYPES = ['heading','text','image','form'] as const`, `LANDING_FORM_FIELDS = ['name','email','phone','company','message'] as const`.

- [ ] **Step 1: Failing test**

```ts
// packages/shared/src/sites/landing.spec.ts
import { describe, it, expect } from 'vitest';
import { slugify, mapSubmissionToContact, validateLandingContent, LandingPageStatus } from './landing';

describe('slugify', () => {
  it('lowercases, strips accents, spaces→dashes, alnum+dash only', () => {
    expect(slugify('Ma Belle Page!')).toBe('ma-belle-page');
    expect(slugify('Été 2026 — Promo')).toBe('ete-2026-promo');
    expect(slugify('  multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugify('Déjà-Vu')).toBe('deja-vu');
  });
});

describe('mapSubmissionToContact', () => {
  it('extracts recognised lead fields', () => {
    expect(mapSubmissionToContact({ name: 'Jane', email: 'J@x.test', company: 'Acme', extra: 'x' }))
      .toEqual({ name: 'Jane', email: 'J@x.test', companyName: 'Acme' });
  });
  it('omits missing fields', () => {
    expect(mapSubmissionToContact({ email: 'a@b.test' })).toEqual({ email: 'a@b.test' });
    expect(mapSubmissionToContact({})).toEqual({});
  });
});

describe('validateLandingContent', () => {
  it('accepts an array of blocks with known types', () => {
    expect(validateLandingContent([{ type: 'heading', text: 'Hi' }, { type: 'form', fields: ['email'] }])).toBe(true);
  });
  it('rejects non-array or unknown block type', () => {
    expect(validateLandingContent({})).toBe(false);
    expect(validateLandingContent([{ type: 'bogus' }])).toBe(false);
  });
});

describe('LandingPageStatus', () => {
  it('has DRAFT/PUBLISHED', () => {
    expect(LandingPageStatus.DRAFT).toBe('DRAFT');
    expect(LandingPageStatus.PUBLISHED).toBe('PUBLISHED');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @pulsar/shared test -- sites/landing`).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/sites/landing.ts
export enum LandingPageStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export const LANDING_BLOCK_TYPES = ['heading', 'text', 'image', 'form'] as const;
export type LandingBlockType = (typeof LANDING_BLOCK_TYPES)[number];
export const LANDING_FORM_FIELDS = ['name', 'email', 'phone', 'company', 'message'] as const;

/** URL-safe slug: lowercase, strip accents, non-alnum → dashes, collapse/trim dashes. */
export function slugify(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Extract recognised lead fields from a raw form submission (pure). */
export function mapSubmissionToContact(data: Record<string, unknown>): {
  name?: string; email?: string; phone?: string; companyName?: string; message?: string;
} {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  const out: { name?: string; email?: string; phone?: string; companyName?: string; message?: string } = {};
  if (str(data.name)) out.name = str(data.name);
  if (str(data.email)) out.email = str(data.email);
  if (str(data.phone)) out.phone = str(data.phone);
  if (str(data.company)) out.companyName = str(data.company);
  if (str(data.message)) out.message = str(data.message);
  return out;
}

/** Permissive shape check: content must be an array of blocks with a known type. */
export function validateLandingContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.every(
    (b) => b && typeof b === 'object' && LANDING_BLOCK_TYPES.includes((b as { type?: string }).type as LandingBlockType),
  );
}
```

- [ ] **Step 4: Export** — in `index.ts`, add `export * from './sites/landing';`.
- [ ] **Step 5: Run → PASS + rebuild** (`pnpm --filter @pulsar/shared test -- sites/landing && pnpm --filter @pulsar/shared build`).
- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sites/landing.ts packages/shared/src/sites/landing.spec.ts packages/shared/src/index.ts
git commit -m "feat(sites): LandingPageStatus + slugify/mapSubmissionToContact/validateLandingContent helpers"
```

---

### Task 2: Module key + permissions (`@pulsar/shared`)

**Files:**
- Modify: `packages/shared/src/modules.ts`
- Modify: `packages/shared/src/permissions.ts`

**Interfaces:**
- Produces: `MODULE_KEYS.SITES = 'sites'` + a `MODULE_CATALOG` entry (`available: true`); `PERMISSIONS.SITES = { READ: 'sites.read', MANAGE: 'sites.manage' }` + catalog entries in the permission list.

- [ ] **Step 1: Add the module key + catalog entry** — in `modules.ts`, add `SITES: 'sites',` to `MODULE_KEYS`, and a catalog entry: `{ key: MODULE_KEYS.SITES, name: 'Sites & Pages', description: 'Landing pages and microsites with CRM lead capture.', available: true, isCore: false }` (match the exact shape of neighbouring entries — check the fields, e.g. `isCore`).

- [ ] **Step 2: Add permissions** — in `permissions.ts`, add `SITES: { READ: 'sites.read', MANAGE: 'sites.manage' }` to `PERMISSIONS`, and add the two keys to the permission catalog list (mirror how `CRM.READ`/`CRM.MANAGE` are registered — find the `crm(...)`/catalog declarations and add `sites(...)` equivalents with descriptions "View sites & landing pages" / "Create and manage sites & landing pages"). Confirm `ALL_PERMISSION_KEYS` (or equivalent) picks them up.

- [ ] **Step 3: Rebuild shared + verify** — `pnpm --filter @pulsar/shared build`. Quick grep that the new keys resolve.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/modules.ts packages/shared/src/permissions.ts
git commit -m "feat(sites): MODULE_KEYS.SITES + sites.read/manage permissions"
```

---

### Task 3: Prisma models + migration + seed

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/prisma/seed.ts`

- [ ] **Step 1: Enum + models** — add `enum LandingPageStatus { DRAFT PUBLISHED }` and the `LandingPage` + `LandingPageSubmission` models exactly as in the spec (`@@unique([slug])`, `@@index([tenantId, status])` / `[tenantId, landingPageId]`, `onDelete: Cascade` on submission→page, `@@map`). Add back-relation `landingPages LandingPage[]` to `Tenant`.

- [ ] **Step 2: Migrate + generate + build** — DB up: `pnpm db:migrate` (name `sites_landing_pages`), `pnpm db:generate && pnpm --filter @pulsar/database build`. Additive.

- [ ] **Step 3: Seed** — in `seed.ts`, enable the `sites` module for the acme tenant (mirror how other modules are enabled via `tenantModule.upsert` against `moduleDefinition` key) AND seed one demo published page: slug `bienvenue`, title, content `[ { type:'heading', text:'Bienvenue chez Acme' }, { type:'text', text:'...' }, { type:'form', fields:['name','email','company'] } ]`, status PUBLISHED, publishedAt now. Idempotent upsert on a stable id/slug. Update the console.log. Re-run `pnpm db:seed` to confirm.

- [ ] **Step 4: Typecheck** — `pnpm --filter @pulsar/database typecheck && pnpm --filter @pulsar/api typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/database/prisma/seed.ts
git commit -m "feat(sites): LandingPage + LandingPageSubmission models + migration + seed demo page"
```

---

### Task 4: API admin — `SitesService` + `PagesController` + DTO + module wiring

**Files:**
- Create: `apps/api/src/modules/sites/sites.module.ts`
- Create: `apps/api/src/modules/sites/sites.service.ts`
- Create: `apps/api/src/modules/sites/pages.controller.ts`
- Create: `apps/api/src/modules/sites/dto/landing-page.dto.ts`
- Modify: `apps/api/src/app.module.ts` (register `SitesModule`)

**Interfaces:**
- Consumes: `slugify`/`validateLandingContent`/`LandingPageStatus` (`@pulsar/shared`), `AuditLogsService`, `PrismaService`.
- Produces: `SitesService.list/get/create/update/publish/unpublish/remove/listSubmissions` (used by Task 5/6/7).

- [ ] **Step 1: DTO** — `CreateLandingPageDto { title (IsString, MinLength 1); slug? (IsString); content? (IsArray); captureListId? (IsString) }`; `UpdateLandingPageDto extends PartialType(CreateLandingPageDto)`; `LandingPageListQueryDto extends ListQueryDto { status?: string }` (match the `ListQueryDto` import used by `product.dto.ts`).

- [ ] **Step 2: Service** (model on `products.service.ts`):
  - `list`: Paginated, filters status/search(title|slug); `orderBy updatedAt desc`.
  - `get`: findFirst `{ id, tenantId }` + `_count.submissions` → 404.
  - `create`: `slug = slugify(dto.slug || dto.title)`; assert slug not taken (findFirst by slug GLOBALLY → if exists, 409 ConflictException); `validateLandingContent(dto.content ?? [])` else BadRequest; assert `captureListId` owned if set (R9); create DRAFT; audit.
  - `update`: if slug/title changes → re-slugify + collision check (excluding self); validate content if provided; `updateMany({ id, tenantId })`; audit.
  - `publish`: require ≥1 block (read page; `Array.isArray(content) && content.length > 0` else BadRequest); set status PUBLISHED + publishedAt; audit STATUS_CHANGE. `unpublish`: status DRAFT; audit.
  - `remove`: delete (cascade removes submissions); audit.
  - `listSubmissions(tenantId, pageId, query)`: assert page owned; Paginated submissions `orderBy createdAt desc`.

- [ ] **Step 3: Controller** — `@Controller('sites/pages')`, `@RequireModule(MODULE_KEYS.SITES)`. Routes: GET / (read), GET /:id (read), POST / (manage), PATCH /:id (manage), POST /:id/publish (manage), POST /:id/unpublish (manage), DELETE /:id (manage), GET /:id/submissions (read). Decorator imports from `common/decorators/`.

- [ ] **Step 4: Module + app wiring** — `sites.module.ts` (imports `AuditLogsModule`; controllers `PagesController` + the public controller from Task 5; providers `SitesService` + the public service from Task 5; exports `SitesService`). Register `SitesModule` in `app.module.ts`. (Task 5 adds the public pieces; for now wire the admin pieces and leave room.)

- [ ] **Step 5: Typecheck + build** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sites apps/api/src/app.module.ts
git commit -m "feat(sites): admin pages API (CRUD + publish + submissions) + module wiring"
```

---

### Task 5: API publique (projection R10 + re-check module R15 + submit→lead via ModuleRef) + e2e

**Files:**
- Create: `apps/api/src/modules/sites/sites.public.controller.ts`
- Create: `apps/api/src/modules/sites/sites.public.service.ts`
- Modify: `apps/api/src/modules/sites/sites.module.ts` (register public controller/service)
- Create: `apps/api/src/modules/sites/dto/submit.dto.ts`
- Create: `apps/api/test/sites.e2e-spec.ts`

**Interfaces:**
- Consumes: `TenantModulesCacheService` (re-check activation — read how `portal`/customer-portal service injects it), `DomainEventsService` (emit), `ModuleRef` (resolve CRM services lazily), `slugify`/`mapSubmissionToContact`.
- Produces: `GET /public/sites/:slug`, `POST /public/sites/:slug/submit`.

- [ ] **Step 1: Public service** (`sites.public.service.ts`):
  - `getPublic(slug)`: `findFirst({ where: { slug } })`; if none → NotFound. Re-check module active for `page.tenantId` via `TenantModulesCacheService` (the method used by `PortalService` — mirror it) AND `page.status === PUBLISHED`; else NotFound (404). Return an **explicit projection**: `{ title, blocks }` where `blocks` is the content mapped to display-safe blocks (for a `form` block, expose only `{ type:'form', fields }`). NEVER include `tenantId`, `id`, `captureListId`, internal refs.
  - `submit(slug, body)`: resolve page by slug → NotFound if missing/not published/module off (same checks). If `body._hp` (honeypot) is a non-empty string → return `{ ok: true }` WITHOUT persisting (silent reject). Create `LandingPageSubmission { tenantId: page.tenantId, landingPageId: page.id, data: sanitized body without _hp }`. If CRM module active for the tenant (cache): `const lead = mapSubmissionToContact(data)`; if `lead.email`: find `CrmContact` by `{ tenantId, email insensitive }` else create `{ tenantId, name: lead.name ?? lead.email, email, phone }`; set `submission.contactId`; if `page.captureListId` → add to list idempotently (resolve `ListsService` via `ModuleRef`, best-effort try/catch). Emit `sites.lead.captured` (best-effort). Return `{ ok: true }`. Resolve CRM services with `this.moduleRef.get(ContactsService, { strict: false })` inside try/catch (no static CrmModule import).
  - `submit.dto.ts`: a permissive DTO — accept arbitrary string fields. Simplest: `class SubmitDto { [k: string]: unknown }` won't validate; instead use `@Body()` as `Record<string, unknown>` with a ValidationPipe whitelist OFF for this route, OR a DTO with the known optional fields + `_hp`. Use a DTO with optional `name/email/phone/company/message/_hp` (all `@IsOptional() @IsString()`) to stay within the global ValidationPipe whitelist.

- [ ] **Step 2: Public controller** (`sites.public.controller.ts`): `@Controller('public/sites')`, NO `@RequireModule` / NO auth guard (public — mirror `portal.controller.ts` / `public-links.controller.ts` decorators, including any `@Public()`/skip-auth marker the codebase uses). `GET :slug` → `getPublic`. `POST :slug/submit` → `submit`.

- [ ] **Step 3: Register** the public controller + service in `sites.module.ts`; ensure `ModuleRef` is available (it's injectable anywhere) and `TenantModulesCacheService`/`DomainEventsService` modules are importable (check how PortalService gets the cache — import the same module).

- [ ] **Step 4: e2e** (`sites.e2e-spec.ts`) — mirror `crm-products.e2e-spec.ts` setup (login 200, enable `sites` AND `crm` modules via `tenantModule.upsert` on `moduleDefinition`, `app.listen(0)`, unique suffixes). Assert:
  1. `POST /sites/pages` (title) → slug auto-generated; `GET` shows DRAFT.
  2. create a 2nd page with the same slug → 409.
  3. `POST :id/publish` with empty content → 400; add a block via PATCH then publish → PUBLISHED.
  4. `GET /public/sites/:slug` (published) → 200, body has `title`+`blocks`, and **no `tenantId`** key anywhere in the response (assert `JSON.stringify(res.body)` does not contain the tenant id).
  5. `GET /public/sites/:slug` for a DRAFT page → 404.
  6. `POST /public/sites/:slug/submit` with `{ name, email, company }` → `{ ok: true }`; assert a `LandingPageSubmission` row exists (via Prisma) AND a `CrmContact` with that email exists (CRM active); re-submit same email → contact deduped (still one).
  7. honeypot: submit with `_hp: 'x'` → `{ ok: true }` but NO new submission row.
  8. tenant isolation: admin GET pages only returns acme's.

- [ ] **Step 5: Run e2e + typecheck** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test:e2e -- sites`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sites/sites.public.controller.ts apps/api/src/modules/sites/sites.public.service.ts apps/api/src/modules/sites/sites.module.ts apps/api/src/modules/sites/dto/submit.dto.ts apps/api/test/sites.e2e-spec.ts
git commit -m "feat(sites): public page API (projection R10 + module recheck R15 + submit→lead) + e2e"
```

---

### Task 6: Web — liste `/sites` + nav

**Files:**
- Create: `apps/web/src/routes/(app)/sites/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts`

- [ ] **Step 1: Read references** — `apps/web/src/routes/(app)/crm/products/+page.svelte` (list idiom) + how nav entries are gated on `enabledModules` (the section objects in `navigation.ts` — a `sites` section/entry gated on the module being enabled + `PERMISSIONS.SITES.READ`).

- [ ] **Step 2: Build the list** — paginated pages (title, slug, status badge, #submissions, a "voir" link to `/p/<slug>` opening the public page), status/search filters, create button (title → POST), row click → `/sites/[id]`. French; loading/empty/error.

- [ ] **Step 3: Nav** — add a "Sites" nav entry/section → `/sites`, gated on the `sites` module being in `$auth.tenant.enabledModules` AND `PERMISSIONS.SITES.READ` (mirror how a module-gated section is declared in `navigation.ts`).

- [ ] **Step 4: Build** — `pnpm --filter @pulsar/web build` green.

- [ ] **Step 5: Verify types** — `pnpm typecheck` (svelte-check — NOT just vite build; this is what catches type errors).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/\(app\)/sites/+page.svelte apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): sites list page + module-gated nav"
```

---

### Task 7: Web — éditeur `/sites/[id]` (blocs + form + publish + submissions)

**Files:**
- Create: `apps/web/src/routes/(app)/sites/[id]/+page.svelte`

- [ ] **Step 1: Read reference** — `apps/web/src/routes/(app)/crm/deals/[id]/+page.svelte` (detail/editor idiom, `$page.params.id`, reload pattern).

- [ ] **Step 2: Build the editor**:
  - Page fields: title, slug (editable, with a note it's the public URL `/p/<slug>`), captureListId (optional — a select populated from `GET /crm/lists` if CRM active, else a text field; keep simple: text input for the list id, or a select if `/crm/lists` returns).
  - **Block editor**: render the `content` array; add a block (choose heading/text/image/form), edit each block's fields (heading→text, text→text, image→url, form→checkbox set of `LANDING_FORM_FIELDS`), remove, reorder (up/down buttons). Save via PATCH `{ content }`.
  - Publish/Unpublish buttons (POST `:id/publish` / `:id/unpublish`); show status badge; disable publish if no blocks.
  - "Voir la page" link → `/p/<slug>` (new tab).
  - **Submissions** section: `GET /sites/pages/:id/submissions` → list (data fields, contactId link if present, date).
  - French; loading/empty/error.

- [ ] **Step 3: Build + typecheck** — `pnpm --filter @pulsar/web build` AND `pnpm typecheck` (both green).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/\(app\)/sites/\[id\]/+page.svelte
git commit -m "feat(web): site editor — blocks, form fields, publish, submissions"
```

---

### Task 8: Web — page publique `/p/[slug]` (rendu blocs + soumission)

**Files:**
- Create: `apps/web/src/routes/p/[slug]/+page.svelte`
- (If the SPA needs the route outside the auth group, create it at the top-level `routes/p/[slug]/` — NOT under `(app)`.)

- [ ] **Step 1: Confirm the public-route convention** — check how existing public web routes work (e.g. tracking/portal public pages under `apps/web/src/routes/` outside `(app)`). The page must be reachable WITHOUT login. Match that convention (route group + how it calls the public API without an auth token — the `api()` client may attach a token; for public calls use a plain `fetch` to `/api/v1/public/sites/...` or the api client's no-auth path — check how existing public pages call the API).

- [ ] **Step 2: Build the public page** — on mount, `fetch('/api/v1/public/sites/' + slug)` (no auth); render the blocks: `heading` → `<h1>`, `text` → paragraph, `image` → `<img src>`, `form` → inputs for each declared field + a hidden honeypot `_hp` input + submit button. On submit, `POST /api/v1/public/sites/:slug/submit` with the field values (+ `_hp`); show a success message ("Merci, nous vous recontacterons"). Handle 404 (page introuvable) and errors. French. Minimal clean styling (standalone, not the app shell).

- [ ] **Step 3: Build + typecheck** — `pnpm --filter @pulsar/web build` AND `pnpm typecheck` (green). If possible, manually verify `/p/bienvenue` renders against the running dev server (the seed page).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/p
git commit -m "feat(web): public landing page /p/[slug] (render blocks + lead form)"
```

---

### Task 9: Vérification + docs + hard rule

**Files:**
- Modify: `CLAUDE.md` (hard rule for the sites public payload)
- Modify: `docs/etat-du-projet.md`

- [ ] **Step 1: Full verification** — `pnpm typecheck && pnpm test && pnpm build` (shared unit incl. `sites/landing.spec.ts`).
- [ ] **Step 2: e2e** — `pnpm test:e2e` (incl. `sites`; the phase13-workforce / phase16 S6.2 full-suite failures are KNOWN pre-existing cross-suite flakes — pass in isolation — not regressions; verify any NEW failure in isolation before treating as a flake).
- [ ] **Step 3: Hard rule** — append to `CLAUDE.md` a concise rule: the public sites payload (`GET /public/sites/:slug`) is an explicit projection (no tenantId/internal refs — R10), the public service re-checks module activation + PUBLISHED status (R15), submissions create a lead only when CRM is active (resolved via ModuleRef, no static CrmModule import — R38 pattern), honeypot `_hp` silently rejects.
- [ ] **Step 4: Docs note** — one line under a new "Sites" section (or Marketing) in `docs/etat-du-projet.md`.
- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/etat-du-projet.md
git commit -m "docs(sites): note landing pages module + public-payload hard rule"
```

---

## Self-Review

**Spec coverage:** helpers+enum → T1 ; module key+perms → T2 ; modèles+migration+seed → T3 ; API admin → T4 ; API publique R10/R15+submit→lead+e2e → T5 ; web liste+nav → T6 ; éditeur → T7 ; page publique → T8 ; vérif+docs+hard rule → T9. ✓ Recette module couverte (clé T2, perms T2, modèles T3, contrôleurs gated T4, app.module T4, nav T6, seed/enable T3).

**Placeholder scan:** API/web tasks reference named templates (portal.controller for R10/R15, products.service for CRUD, crm/products + crm/deals/[id] + existing public web routes) — acceptable: templates exist in-repo, deltas spelled out. Rule-sensitive parts (public projection, module recheck, ModuleRef decoupling, honeypot) carry explicit instructions; shared helpers + e2e carry full code.

**Type consistency:** `slugify`/`validateLandingContent`/`mapSubmissionToContact`/`LandingPageStatus` (T1) used by T4 create/update + T5 submit + T3 enum mirror. `MODULE_KEYS.SITES`/`PERMISSIONS.SITES` (T2) used by T4 gates + T6 nav. `SitesService.*` (T4) ↔ web (T6/T7). Public projection (T5) ↔ public web render (T8). `captureListId` (T3 model) ↔ T4 R9 check ↔ T5 list add.
