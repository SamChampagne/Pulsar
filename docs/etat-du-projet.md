# État du projet — point de reprise

> 🇫🇷 Document de synthèse pour reprendre le travail (humain ou session Claude Code).
> Mis à jour à la fin de la **phase 5**. Détail des tâches : [TODO.md](../TODO.md) ·
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

**La boucle économique complète fonctionne** : le client commande depuis son portail →
confirmation → planification (split possible) → tender automatique par lane avec courriel →
acceptation transporteur sans compte → dispatch → exécution mobile chauffeur → suivi public →
POD avec photo → facture transporteur brouillon → approbation.

**Chiffres** : 3 modules métier actifs (transportation, customer-portal, billing) ; 64 tests
(23 unitaires vitest + 41 E2E jest, tous verts et rejouables) ; 8 migrations ; ~40 endpoints ;
24 pages web dont 5 publiques à jeton.

## Carte de la documentation

| Besoin | Document |
| ------ | -------- |
| Utilisation métier, parcours écran par écran | [guide-fonctionnel.md](./guide-fonctionnel.md) 🇫🇷 |
| Architecture, guards, décisions | [architecture.md](./architecture.md) |
| Modèle de données et workflow | [data-model.md](./data-model.md) |
| Liens publics, clés API, courriel, webhooks, billing | [collaboration.md](./collaboration.md) |
| Isolation tenant / système de modules | [multi-tenancy.md](./multi-tenancy.md) · [module-system.md](./module-system.md) |
| Conventions REST | [api-conventions.md](./api-conventions.md) |
| Démarrage local | [getting-started.md](./getting-started.md) |

## Prochaine session : phase 6 — « commercial readiness »

Ordre recommandé (du plus déblocant au plus optionnel) :

1. **Plan d'administration plateforme (cross-tenant)** — _prérequis pour vendre_ : aujourd'hui
   un tenant ne se crée que par le seed. Concevoir le rôle « platform admin » (utilisateur hors
   tenant ou flag dédié — décision à prendre), endpoints `POST /platform/tenants`
   (création + admin initial + modules), suspension, listing. Attention : tout le code suppose
   `user.tenantId` présent — le plan plateforme doit contourner proprement les guards
   (nouveau garde ou scope spécial), sans affaiblir l'isolation existante.
2. **SSO OIDC par tenant** — exigence fréquente des comptes enterprise. Pistes : `openid-client`,
   config par tenant (issuer/clientId/secret chiffré dans un `Tenant.authConfig`),
   `GET /auth/oidc/:tenantSlug` → redirect → callback → émission de la **même paire**
   access/refresh qu'au login (l'architecture d'émission dans `core/auth` a été isolée pour ça).
   Provisioning : créer l'utilisateur au premier login OIDC (rôle par défaut configurable).
3. **Billing v2** — facturation client (sell-side, miroir du buy-side existant), export
   PDF/CSV des factures, suivi de paiement simple (statut PAID + date).
4. **Durcissement SOC2-track** — chiffrer `Integration.config` au repos (les secrets webhook y
   sont en clair — voir TODO), rotation du JWT_SECRET documentée, runbook backup/restore.
5. **Module Fleet (découverte)** — maintenance/conformité des actifs internes ; suivre la
   recette « Adding a business module » du CLAUDE.md (validée 3 fois).

### Dette connue à garder en tête (ne pas « réparer » en silence)

- Permissions dans le JWT → effet au prochain refresh (≤15 min) — assumé.
- Cache modules en mémoire processus → passer à Redis quand l'API scale horizontalement.
- Courriels : driver `log` en dev ; seuls tender/identité/livraison sont envoyés.
- Route v0 auto-générée (éditeur manuel dispo) ; pas de re-split après exécution.
- `Integration.config` non chiffré (cible phase 6) ; webhooks limités à 5 tentatives.
- L'utilisateur `service-account@pulsar.local` apparaît dans la page Users (cosmétique).

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
