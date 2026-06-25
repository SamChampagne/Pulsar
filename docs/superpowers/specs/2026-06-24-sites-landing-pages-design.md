# Module Sites — Builder de landing pages → leads CRM (Cycle 4)

**Date:** 2026-06-24
**Statut:** auto-validé (autonomie déléguée — `pulsar-autonomie-execution`)
**Module:** NOUVEAU `MODULE_KEYS.SITES` ('sites')
**Branche:** `crm-email-threads`

## Objectif

Permettre à un tenant de créer des **landing pages** simples (blocs), hébergées par Pulsar et
accessibles publiquement par un slug, dont le **formulaire crée un lead (CrmContact)** dans le CRM.
Boucle marketing → site → lead → deal. Substitut tractable de l'idée « hébergement web » (PAS de
cPanel — cf. `pulsar-vision-crm-commerce`).

## Décisions de design (auto-arrêtées)

1. **Nouveau module `sites`** (recette d'ajout de module, CLAUDE.md) : clé `MODULE_KEYS.SITES`,
   permissions `sites.read` / `sites.manage`. Catalogue `available: true`.
2. **Contenu = blocs JSON** (`content Json`) : petit jeu de types v1 — `heading`, `text`,
   `image` (url), `form`. Le bloc `form` définit ses champs (sous-ensemble de
   `name`/`email`/`phone`/`company`/`message`). Pas de WYSIWYG drag : éditeur par formulaire (liste
   de blocs add/remove/reorder). Validation serveur permissive (forme attendue, pas de schéma strict).
3. **Slug public globalement unique** (`@@unique([slug])`) → route publique `/public/sites/:slug`
   résout le tenant par le slug. Slug normalisé (`slugify`, pur).
4. **Découplage Sites↔CRM** : une soumission crée TOUJOURS un `LandingPageSubmission` ; **si** le
   module CRM est actif pour le tenant, elle crée/déduplique aussi un `CrmContact` (par email,
   best-effort) et l'ajoute à la liste configurée (`captureListId?`). Sites reste utilisable sans CRM.
5. **Pas d'outil agent** v1 (faible valeur). Pas de domaine custom, A/B, analytics avancés.

## Modèle de données (Prisma + migration additive)

```prisma
enum LandingPageStatus { DRAFT PUBLISHED }

model LandingPage {
  id            String            @id @default(cuid())
  tenantId      String
  slug          String                          // public id, globally unique
  title         String
  status        LandingPageStatus @default(DRAFT)
  content       Json                            // ordered blocks
  captureListId String?                         // optional CrmList to add leads to
  publishedAt   DateTime?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  tenant      Tenant @relation(fields: [tenantId], references: [id])
  submissions LandingPageSubmission[]
  @@unique([slug])
  @@index([tenantId, status])
  @@map("landing_pages")
}

model LandingPageSubmission {
  id            String   @id @default(cuid())
  tenantId      String
  landingPageId String
  data          Json                            // raw submitted fields
  contactId     String?                         // matched/created CrmContact (if CRM active)
  createdAt     DateTime @default(now())
  page LandingPage @relation(fields: [landingPageId], references: [id], onDelete: Cascade)
  @@index([tenantId, landingPageId])
  @@map("landing_page_submissions")
}
```
Back-relation `Tenant.landingPages`. Enum `LandingPageStatus` mirroré dans `@pulsar/shared`
(règle 3). Migration additive.

## Helpers purs (`packages/shared/src/sites/`)

- `slugify(input: string): string` — lowercase, accents/espaces → tirets, alphanumérique+tirets.
- `mapSubmissionToContact(data: Record<string, unknown>): { name?, email?, phone?, companyName?, message? }`
  — extrait les champs lead reconnus d'une soumission (pur, testé). `LANDING_BLOCK_TYPES`,
  `LANDING_FORM_FIELDS` (data, browser-safe). `validateLandingContent(content): boolean` (forme).

## API admin (`apps/api/src/modules/sites/`, `@RequireModule(SITES)`, R1, R6)

- `GET /sites/pages` — `Paginated`, filtres `status`/`search`(title/slug) | `sites.read`
- `GET /sites/pages/:id` — page + count soumissions | `sites.read`
- `POST /sites/pages` — créer (title, slug auto via `slugify` si absent, content, captureListId?) ;
  **collision de slug → 409** ; `captureListId` vérifié (R9) | `sites.manage`
- `PATCH /sites/pages/:id` — title/content/captureListId/slug (re-slugify + collision 409) | `sites.manage`
- `POST /sites/pages/:id/publish` — status PUBLISHED + `publishedAt` (exige ≥1 bloc) ; `unpublish` → DRAFT, audit | `sites.manage`
- `DELETE /sites/pages/:id` | `sites.manage`
- `GET /sites/pages/:id/submissions` — `Paginated` (data, contactId, createdAt) | `sites.read`

## API publique (`sites.public.controller.ts`, règles 10 + 15)

- `GET /public/sites/:slug` — **projection explicite** (title + blocs d'affichage ; PAS de
  `tenantId`/refs internes — règle 10). Le service **re-vérifie l'activation du module** via
  `TenantModulesCacheService` (règle 15, les routes publiques contournent ModulesGuard) ET
  `status === PUBLISHED` ; sinon **404**. Pour le bloc `form`, n'expose que la définition des champs.
- `POST /public/sites/:slug/submit` — body = champs du formulaire + un champ **honeypot** (`_hp`,
  rejet silencieux si rempli). Crée un `LandingPageSubmission` (tenant résolu par le slug). Si le
  module CRM est actif (cache) : `mapSubmissionToContact` → dédup `CrmContact` par email
  (insensible casse) ou création ; si `captureListId` set et CRM actif → ajout idempotent à la liste ;
  lie `submission.contactId`. Émet `sites.lead.captured` (best-effort). Réponse minimale `{ ok: true }`
  (aucune fuite). Validation des champs (email format) ; rate-limit basique hors périmètre.

## Web (Svelte 5 runes)

- **`/sites`** (app) : liste des pages (title, slug, statut badge, #soumissions, lien public),
  création. Nav « Sites » (gated `sites.read`).
- **`/sites/[id]`** (app) : éditeur — champs page (title, slug, captureListId), **éditeur de blocs**
  (ajouter/supprimer/réordonner heading/text/image/form ; le bloc form édite ses champs), bouton
  Publier/Dépublier, lien « voir la page » (`/p/<slug>`), **liste des soumissions**.
- **`/p/[slug]`** (route PUBLIQUE, hors `(app)`, sans auth) : fetch `/public/sites/:slug`, rend les
  blocs ; le bloc form POST `/public/sites/:slug/submit` (avec honeypot caché) → message de succès.
- Recette module : nav conditionnée sur `enabledModules` incluant `sites`.

## Conformité hard rules

- Recette module (clé/permissions/modèles/contrôleurs gated/nav/seed). R1 tenant-scope sur tout
  l'admin. R3 enum mirroré. R6 audit (create/update/publish/delete). R9 `captureListId` vérifié.
  **R10** payload public = projection explicite sans tenantId/refs. **R15** route publique re-vérifie
  l'activation module en service. Découplage : `SitesModule` n'importe PAS `CrmModule` statiquement
  (cycle) → résout `ListsService`/`ContactsService` via `ModuleRef.get()` + lazy si nécessaire (comme
  `ReactionExecutorService`, règle 38), OU une dépendance best-effort encapsulée.

## Tests

- **Unit (`@pulsar/shared`)** : `slugify` (accents/espaces/casse), `mapSubmissionToContact`
  (extraction + champs manquants), `validateLandingContent`.
- **e2e (`apps/api/test/sites.e2e-spec.ts`)** : créer page (slug auto), collision slug 409, publier
  (exige bloc), public GET publié = pas de tenantId + 404 si DRAFT/module off, public submit →
  `LandingPageSubmission` créé + `CrmContact` créé/dédupé par email (CRM actif) + ajout liste,
  honeypot rempli → rejet silencieux, isolation tenant. Master-data unique, reruns sûrs.

## Hors périmètre v1 (backlog)
- WYSIWYG drag-drop, thèmes, domaines custom, A/B, analytics de vues, captcha/rate-limit avancé,
  outil agent, connecteur Shopify (toujours bloqué externe).
