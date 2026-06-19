# Module H — Document Center (spec)

Backlog F→J. Branche `analytics-control-tower`. Autonomie (mandat Lebron).

## But

Un centre documentaire unifié : retrouver **n'importe quel document** du tenant (tous types
d'entités), filtrer par catégorie/recherche/date, télécharger, et voir d'un coup la **conformité
qui expire** (documents fleet). App first-class sur le desk.

## Existant réutilisé (NE PAS réimplémenter)

- `DocumentsService.listForEntity / download / downloadUrl` (`core/documents`). Modèle `Document`
  (write-once) : `id, tenantId, entityType, entityId, fileName, mimeType, sizeBytes, storageKey,
  uploadedById?, createdAt`. **Pas d'enum type, pas de status** — `entityType` = catégorie freeform
  (`bill-of-lading`, `proof-of-delivery`, `compliance-document`, `desk-wallpaper`, …).
- `computeComplianceStatus(expiresAt, now, warnDays)` (`@pulsar/shared/fleet/compliance`) → EXPIRED|
  EXPIRING|VALID. Modèle `ComplianceDocument` (subjectType/subjectId/docType/expiresAt/documentId?).
- Permissions `CORE.DOCUMENTS_READ` / `DOCUMENTS_MANAGE`. Web : `$lib/api/files`
  (`fetchDocumentObjectUrl`), download via `/api/v1/documents/:id/download`.

## Périmètre LIVRÉ (H-phase-1)

### Backend — endpoint d'agrégation read-only

`GET /api/v1/documents/center`
- Gardes : `@RequirePermissions(CORE.DOCUMENTS_READ)`. **Core** (pas de `@RequireModule`). Tenant-scopé.
- Query : `category?` (= entityType ; ex `bill-of-lading`), `search?` (fileName contains),
  `from?`/`to?` (createdAt ISO), `page?`/`pageSize?` (Paginated). `excludeWallpaper=true` par défaut
  pour masquer `desk-wallpaper` (bruit UI).
- Réponse :
  ```ts
  interface DocumentCenterDto {
    documents: Paginated<DocCenterItem>;   // tous types, filtrés
    categories: { entityType: string; label: string; count: number }[]; // facettes (counts par entityType, tenant)
    compliance: ComplianceAlertItem[];     // docs de conformité EXPIRING|EXPIRED (cap 100)
  }
  interface DocCenterItem { id; entityType; entityId; category; fileName; mimeType; sizeBytes; uploadedByName?; createdAt; }
  interface ComplianceAlertItem { id; subjectType; subjectId; docType; reference?; expiresAt; status: 'EXPIRING'|'EXPIRED'; documentId?; }
  ```
- `category`/`label` : map des entityType connus → libellés FR lisibles (BOL, POD, Conformité, …) ;
  fallback = l'entityType brut. **Ne pas** réimplémenter de logique de statut documentaire (il n'y
  en a pas) ; la conformité réutilise `computeComplianceStatus` (jamais persisté — règle module Fleet).
- Le compteur de facettes = `groupBy entityType` tenant-scopé. Caps documentés (page 25, facettes
  illimitées mais bornées par le nb d'entityType, compliance cap 100).

### Frontend — page `/documents` (app desk)

- `apps/web/src/routes/(app)/documents/+page.svelte`. Pattern `$state`+`$effect`+`load()`, `api<T>()`,
  UI kit existant. Sections :
  1. **Facettes catégories** (chips count) → filtre `category`.
  2. **Barre de filtres** : recherche fileName, plage de dates, pagination.
  3. **Table documents** : fileName (+ icône type), catégorie (Badge), entité (entityType:entityId
     court), taille, uploadé par, date, bouton **Télécharger** (réutilise le download existant).
  4. **Panneau conformité** : liste EXPIRING/EXPIRED (sujet, docType, échéance, badge statut),
     lien vers le doc si `documentId`.
- Pas de nouveau design system. Empty states standard.

### Navigation + univers (app first-class)

- `navigation.ts` : NOUVEAU domaine `documents` — `home: '/documents'`, `prefixes: ['/documents']`,
  `anyPerms: [CORE.DOCUMENTS_READ]`, icône lucide (`FileText` ou `Files`), une section/lien
  « Document Center ». (Pas de `module` gate — c'est du core, visible si perm.)
- `universe.ts` : entrée `documents` (title « Document Center », accent distinct, mission, objects/
  workflows/agent/signal) pour la tuile desk + l'en-tête module.

## DIFFÉRÉ (H-phase-2)

- Statut documentaire missing/received/verified/rejected (nécessite migration `Document.status` +
  workflow + revue agent) ; OCR/extraction ; détection « docs manquants » cross-ops (POD manquant
  sur load livré, BOL manquant) ; liens publics sécurisés dédiés Document Center ; expiration custom
  hors conformité.

## Règles

- Rule 1 (tenant scope), 5 (perm gating ; core → pas de module), 12 (download via le flux
  DocumentsService existant — la page utilise l'endpoint download existant). Pas d'entité, pas de
  migration, pas d'enum, pas de nouvelle permission.

## Tâches

- **H-T1 (backend)** : `DocumentCenterController` + `DocumentCenterService` (dans `core/documents/`
  ou un sous-module), enregistré. Réutilise Prisma `document.groupBy/findMany` tenant-scopé +
  `complianceDocument.findMany` + `computeComplianceStatus`. DTO query validé. Vérifier : API boote,
  200 avec shape correct, gating, tenant-scope, 0 nouvelle erreur typecheck.
- **H-T2 (frontend)** : page `/documents` + domaine nav + univers. Vérifier : `pnpm --filter web
  typecheck` 0 erreur, la page liste/filtre/télécharge, panneau conformité OK.
- Reviewer après chaque tâche.
