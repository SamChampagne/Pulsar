# Module J — Onboarding / Demo (spec)

Backlog F→J (dernier). Branche `analytics-control-tower`. Autonomie (mandat Lebron).

## But

Une expérience d'**onboarding guidé** : une checklist qui calcule l'état réel de configuration du
tenant (modules, utilisateurs, runtime LLM, agents, données, branding) et guide l'admin vers les
pages existantes pour compléter chaque étape, avec une barre de progression.

## Décision de scope (important)

- **LIVRÉ (J-phase-1)** : checklist/wizard d'onboarding = agrégation **read-only** de l'état du
  tenant + UI guidée. Entièrement vérifiable (typecheck + review), **zéro risque destructif**.
- **DIFFÉRÉ (J-phase-2)** : générateur de **sample data** (curated, tagué `DEMO-`, idempotent,
  ADD-only) + **reset démo** (suppression FK-safe des seules données taguées) + wizard de création
  de tenant (scope platform-admin). Raison : touche beaucoup de tables et une opération destructive ;
  à faire avec une DB démarrée pour exécuter/valider réellement (pas seulement typecheck).

## Existant réutilisé

- `Tenant.enabledModules` / `enabledModules` dans le JWT ; `MODULE_CATALOG` (shared).
- Endpoints existants pour chaque étape : `/settings/modules`, `/settings/users`,
  `/settings/agent-runtime`, `/agents`, `/customers`, `/locations`, `/carriers`, `/dispatch`,
  customer-portal branding.
- Modèles : User, AgentRuntimeConfig (connectedAt/lastTestOk), Agent, Customer, Location, Carrier,
  TransportOrder/Load, `Tenant.settings.branding`.

## Périmètre LIVRÉ (J-phase-1)

### Backend — endpoint d'agrégation read-only

`GET /api/v1/onboarding/status`
- Gardes : core, **pas de @RequireModule**. Permission : réutiliser une perm large déjà détenue par
  l'admin — viser une perm "settings/tenant read" si elle existe (sinon une perm core que tout admin
  possède, p.ex. la perm de lecture des modules `core.modules.read` ou équivalent ; l'implémenteur
  confirme en lisant le modules controller). Tenant-scopé (règle 1). Aucun écrit.
- Réponse :
  ```ts
  interface OnboardingStatusDto {
    steps: OnboardingStep[];
    completed: number;       // nb d'étapes done
    total: number;
    percent: number;         // 0..100
  }
  interface OnboardingStep {
    key: string;             // 'modules' | 'users' | 'runtime' | 'agents' | 'master-data' | 'operations' | 'branding'
    label: string;           // FR
    description: string;     // FR
    done: boolean;
    detail?: string;         // ex "3 utilisateurs", "0 client"
    href: string;            // page existante pour compléter l'étape
  }
  ```
- Calcul des étapes (counts tenant-scopés, read-only) :
  - `modules` : ≥1 module métier (non-core) activé → done ; détail = nb activés.
  - `users` : ≥2 users actifs (l'admin + au moins un invité) → done ; détail = nb users.
  - `runtime` : `AgentRuntimeConfig` présent ET (`connectedAt` non nul OU `lastTestOk=true`) → done.
  - `agents` : ≥1 Agent (non révoqué) → done ; détail = nb agents.
  - `master-data` : ≥1 Customer OU ≥1 Location OU ≥1 Carrier → done ; détail = "X clients · Y lieux · Z transporteurs".
  - `operations` : ≥1 TransportOrder OU ≥1 Load → done ; détail = nb loads/orders.
  - `branding` : `Tenant.settings.branding` présent (logo OU couleur) → done.
  - (Chaque étape n'est comptée que si le module/feature concerné est pertinent ; mais garder simple :
    toutes les étapes affichées, `done` calculé sur l'état.)
- Service tenant-scopé : counts via Prisma (`count`), lecture `Tenant.settings`, `AgentRuntimeConfig`.

### Frontend — page `/onboarding` (app desk first-class)

- `apps/web/src/routes/(app)/onboarding/+page.svelte`. Pattern `$state`+`$effect`+`load()`, UI kit.
  - En-tête + barre de progression (`percent`, `completed/total`).
  - Liste de cartes par étape : icône d'état (✓ done / cercle todo), label, description, détail, et un
    bouton « Configurer » → `step.href`. Étapes done en style discret, todo mises en avant.
  - Empty/skeleton states standard.

### Navigation + univers

- `navigation.ts` : NOUVEAU domaine `onboarding` (ou lien dans `dashboard`). Choix : lien dans le
  domaine **dashboard/Plateforme** (section dédiée) `{ href: '/onboarding', label: 'Onboarding' }`
  (toujours visible, pas de gate spécifique au-delà de la perm de l'endpoint) — plus simple qu'un
  domaine dédié, l'onboarding est transverse plateforme. Ajouter `/onboarding` aux prefixes du
  domaine dashboard.
- (Pas d'entrée universe nécessaire si on reste dans le domaine dashboard.)

## Règles CLAUDE.md

- Règle 1 (tenant scope), 5 (perm gating ; core → pas de module). Pas d'entité, pas de migration,
  pas d'enum, pas de nouvelle permission (réutiliser une perm de lecture existante de l'admin).

## Tâches

- **J-T1 (backend)** : `OnboardingController` + `OnboardingService` (core), `GET /onboarding/status`.
  Réutilise counts Prisma tenant-scopés. Vérifier : typecheck api 0 nouvelle err, build nest OK,
  gating, tenant-scope, shape correct.
- **J-T2 (frontend)** : page `/onboarding` + nav (domaine dashboard). Vérifier : `pnpm --filter web
  typecheck` 0 err, la page charge et affiche la progression.
- Reviewer après chaque tâche.
