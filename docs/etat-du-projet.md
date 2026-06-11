# État du projet — point de reprise

> 🇫🇷 Document de synthèse pour reprendre le travail (humain ou session Claude Code).
> Mis à jour pendant la **phase 6** (volet 1 livré : plan d'administration plateforme).
> Détail des tâches : [TODO.md](../TODO.md) ·
> vision : [ROADMAP.md](../ROADMAP.md) · règles de dev : [CLAUDE.md](../CLAUDE.md).

## Où on est rendu

| Phase | Livré | Contenu clé |
| ----- | ----- | ----------- |
| 0 — Fondation | ✅ | Monorepo pnpm, schéma Prisma multi-tenant, API NestJS (auth JWT, RBAC, audit, registre de modules), SPA SvelteKit, seed, Docker |
| 1 — Happy path TMS | ✅ | Workflow complet en UI (ordre→shipment→load→route→livraison→POD), séquences par tenant, validation d'appartenance des FK, CI GitHub Actions |
| 2 — Collaboration & coût | ✅ | Tendering transporteur, lien de suivi public, page chauffeur mobile (POD+photo), moteur de coût, scorecard, refresh tokens, stockage local/S3 |
| 2.5 — Automatisation tender | ✅ | Canal courriel (log/SMTP), listes de préférence par voie (lanes), re-tender auto sur refus/expiration (cron), cache modules |
| 3 — Profondeur opérationnelle | ✅ | Split d'ordre en N shipments, éditeur de route manuel, invitations + reset mot de passe, outbox webhooks avec retries, avis de livraison client |
| 4 — Plateforme & 2ᵉ module | ✅ | Clés API entrantes, audit déclaratif (@Audit), URLs pré-signées S3, gestion shipments post-planification, **module Customer Portal v1** |
| 5 — Portail v2 & Billing | ✅ | Saisie de commandes depuis le portail, comptes de service (clés API en écriture), **module Billing v1** (factures transporteur) |
| 6 — Commercial readiness | 🚧 | **Plan d'administration plateforme (cross-tenant)** livré : création de tenant + admin + modules, suspension/réactivation, bascule de modules, vue d'ensemble. Reste : SSO OIDC, Billing v2, Fleet, durcissement SOC2 |

**La boucle économique complète fonctionne** : le client commande depuis son portail →
confirmation → planification (split possible) → tender automatique par lane avec courriel →
acceptation transporteur sans compte → dispatch → exécution mobile chauffeur → suivi public →
POD avec photo → facture transporteur brouillon → approbation.

**Chiffres** : 3 modules métier actifs (transportation, customer-portal, billing) + plan
plateforme cross-tenant ; 74 tests (23 unitaires vitest + 51 E2E jest, tous verts et
rejouables) ; 8 migrations ; ~48 endpoints ; 26 pages web dont 5 publiques à jeton.

## Carte de la documentation

| Besoin | Document |
| ------ | -------- |
| Utilisation métier, parcours écran par écran | [guide-fonctionnel.md](./guide-fonctionnel.md) 🇫🇷 |
| Architecture, guards, décisions | [architecture.md](./architecture.md) |
| Modèle de données et workflow | [data-model.md](./data-model.md) |
| Liens publics, clés API, courriel, webhooks, billing | [collaboration.md](./collaboration.md) |
| Plan d'administration plateforme (cross-tenant) | [platform-admin.md](./platform-admin.md) |
| Isolation tenant / système de modules | [multi-tenancy.md](./multi-tenancy.md) · [module-system.md](./module-system.md) |
| Conventions REST | [api-conventions.md](./api-conventions.md) |
| Démarrage local | [getting-started.md](./getting-started.md) |

## Phase 6 — « commercial readiness »

✅ **Volet 1 livré — Plan d'administration plateforme (cross-tenant).** Décision prise : le
« platform admin » est un **flag** `User.isPlatformAdmin` (pas un utilisateur hors-tenant), porté
par un tenant dédié `platform` seedé, pour ne pas rendre `tenantId` nullable et préserver
l'isolation. Garde dédié `@PlatformAdmin()` / `PlatformAdminGuard` (après `JwtAuthGuard`),
endpoints `/platform/*` (overview, tenants CRUD, suspend/activate, bascule de modules), recette de
provisioning en une transaction (tenant + rôle admin + admin initial, invitation si pas de mot de
passe), 2 pages web, suite e2e (10 tests). Compte seedé : `platform@pulsar.dev` / `platform123`.
Détails : [platform-admin.md](./platform-admin.md).

Ordre recommandé pour la suite (du plus déblocant au plus optionnel) :

1. **SSO OIDC par tenant** — exigence fréquente des comptes enterprise. Pistes : `openid-client`,
   config par tenant (issuer/clientId/secret chiffré dans un `Tenant.authConfig`),
   `GET /auth/oidc/:tenantSlug` → redirect → callback → émission de la **même paire**
   access/refresh qu'au login (l'architecture d'émission dans `core/auth` a été isolée pour ça).
   Provisioning : créer l'utilisateur au premier login OIDC (rôle par défaut configurable).
2. **Billing v2** — facturation client (sell-side, miroir du buy-side existant), export
   PDF/CSV des factures, suivi de paiement simple (statut PAID + date).
3. **Durcissement SOC2-track** — chiffrer `Integration.config` au repos (les secrets webhook y
   sont en clair — voir TODO), rotation du JWT_SECRET documentée, runbook backup/restore.
4. **Module Fleet (découverte)** — maintenance/conformité des actifs internes ; suivre la
   recette « Adding a business module » du CLAUDE.md (validée 3 fois).

### Dette connue à garder en tête (ne pas « réparer » en silence)

- Permissions dans le JWT → effet au prochain refresh (≤15 min) — assumé.
- Cache modules en mémoire processus → passer à Redis quand l'API scale horizontalement.
- Courriels : driver `log` en dev ; seuls tender/identité/livraison sont envoyés.
- Route v0 auto-générée (éditeur manuel dispo) ; pas de re-split après exécution.
- `Integration.config` non chiffré (cible phase 6) ; webhooks limités à 5 tentatives.
- L'utilisateur `service-account@pulsar.local` apparaît dans la page Users (cosmétique).
- ⚠️ Correctif phase 6 : la règle `.gitignore` `storage/` avalait aussi le **dossier source**
  `apps/api/src/core/documents/storage/` → le driver de stockage (FileStorage + Local/S3) n'avait
  jamais été commité et un clone neuf ne compilait pas. Règle ré-ancrée sur `/apps/api/storage/`,
  les 3 fichiers du driver restaurés. Vérifier ce genre de pattern avant d'ajouter des `*/` larges.

### Reprendre l'environnement

```bash
cp .env.example .env && pnpm setup     # si nouvel environnement
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev                               # admin@pulsar.dev / admin123 (tenant acme)
pnpm test && pnpm test:e2e             # e2e = DB démarrée + seedée requise
```

Dans l'environnement cloud de session : PostgreSQL local (`service postgresql start`),
base `pulsar` + shadow `pulsar_shadow` ; les migrations se génèrent en non-interactif via
`prisma migrate diff` + `migrate deploy` (voir l'historique des migrations pour le motif).
