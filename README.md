# Pulsar

**Pulsar** is a modular logistics platform (B2B SaaS). Three business modules are live, activable
per tenant: **Transportation (TMS)** — orders, shipments, loads, carrier tendering, routing,
mobile driver execution, tracking, POD; **Customer Portal** — self-service order entry and
visibility for the shipper's customers; **Billing** — carrier settlement with invoice
reconciliation (tolerances, disputes, payment tracking). A cross-tenant **platform
administration plane** (tenant creation/suspension) and **per-tenant OIDC SSO** shipped in
phase 6.

> 📄 Status & next steps: [docs/etat-du-projet.md](./docs/etat-du-projet.md) 🇫🇷 · Product vision: [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) · Roadmap: [ROADMAP.md](./ROADMAP.md) · Docs: [docs/](./docs)

## Architecture at a glance

```
pulsar/
├── apps/
│   ├── api/          NestJS REST API (JWT auth, RBAC, multi-tenant, module registry)
│   └── web/          SvelteKit web app (SPA)
├── packages/
│   ├── shared/       Domain contracts: enums, state machines, permission catalog, API types
│   └── database/     Prisma schema, migrations, seed, re-exported Prisma client
├── docs/             Architecture & domain documentation
└── docker-compose.yml  PostgreSQL 16 for local development
```

- **Multi-tenant** from day one (shared schema, `tenantId` on every business table — see [docs/multi-tenancy.md](./docs/multi-tenancy.md)).
- **Modular**: business modules can be enabled/disabled per tenant ([docs/module-system.md](./docs/module-system.md)).
- **Stack**: SvelteKit + TypeScript / NestJS + TypeScript / PostgreSQL / Prisma / pnpm workspaces.

---

# 🇫🇷 Guide complet — lancer, se connecter, utiliser

## 1. Prérequis

| Outil | Version | Vérifier avec |
| ----- | ------- | ------------- |
| Node.js | ≥ 20 | `node --version` |
| pnpm | ≥ 10 | `pnpm --version` (installer : `npm install -g pnpm`) |
| Docker Desktop | récent, démarré | `docker info` |

## 2. Installation pas à pas

Depuis la racine du dépôt :

```bash
# 1. Configuration : copie le fichier d'exemple (il contient des valeurs de dev valides,
#    y compris ENCRYPTION_KEY — sans elle l'API refuse volontairement de démarrer)
cp .env.example .env

# 2. Dépendances + client Prisma + build des packages partagés
pnpm setup

# 3. PostgreSQL (conteneur Docker "pulsar-db" sur le port 5432)
pnpm db:up

# 4. Schéma de base + données de démonstration
pnpm db:migrate
pnpm db:seed

# 5. Lancement (API sur :3000, web sur :5173, rechargement à chaud)
pnpm dev
```

Quand tout tourne :

| URL | Quoi |
| --- | ---- |
| http://localhost:5173 | Application web (espace tenant) |
| http://localhost:5173/platform/login | Console d'administration plateforme (cross-tenant) |
| http://localhost:3000/api/docs | Documentation API interactive (Swagger) |

## 3. Se connecter

Le seed crée deux comptes :

| Espace | URL | Email | Mot de passe | Rôle |
| ------ | --- | ----- | ------------ | ---- |
| **Tenant « acme »** | http://localhost:5173/login | `admin@pulsar.dev` | `admin123` | Administrateur du tenant (toutes permissions) |
| **Plateforme** | http://localhost:5173/platform/login | `platform@pulsar.dev` | `admin123` | Opérateur cross-tenant (créer/suspendre des tenants) |

- Sur la page de login tenant, le champ « tenant » est optionnel (utile quand un même email
  existe dans plusieurs tenants) — le slug du tenant de démo est `acme`.
- Si un tenant a configuré le SSO (Settings → SSO), un lien **« Sign in with SSO »** apparaît
  sous le formulaire dès que le champ tenant est rempli.
- En production, l'API **refuse de démarrer** si le mot de passe plateforme est resté
  `admin123` ou si les secrets d'exemple du dépôt sont utilisés (garde-fou intégré).

## 4. Tour des fonctionnalités

### Le flux TMS de bout en bout (la « boucle » complète)

1. **Commande** — `Transport orders` → créer une commande (client, origine, destination,
   dates, poids/palettes). Statut `DRAFT` → **Confirm**.
2. **Planification** — **Plan** transforme la commande en expédition(s) ; le formulaire de
   *split* permet d'éclater en N expéditions (poids/palettes par expédition). On peut encore
   ajouter/annuler des expéditions sur une commande planifiée.
3. **Consolidation** — `Shipments` → assigner chaque expédition à un *load* (existant ou créé
   à la volée). Un load peut grouper plusieurs expéditions (multi-stop).
4. **Ressources & coût** — sur le détail du load : transporteur, chauffeur, véhicule,
   remorque, **tarif** (FLAT / PER_KM / CWT / PER_PALLET / SPOT, surcharge carburant,
   minimum). Le coût estimé se recalcule à chaque changement de tarif ou de route.
5. **Route** — stops générés automatiquement (pickups puis deliveries) + **éditeur manuel**
   (réordonner, heures planifiées, distance/durée — alimente le coût PER_KM).
6. **Tendering** — proposer le load à un transporteur : manuellement, ou **auto-tender** qui
   suit la liste de préférence de la lane (`Lanes`) et enchaîne automatiquement sur refus ou
   expiration (cron 5 min). Le transporteur reçoit un **courriel avec un lien public**
   d'acceptation/refus — aucun compte requis. Le dispatch est bloqué tant que le tender
   n'est pas accepté.
7. **Exécution** — **Dispatch** → **Start transit** → arrivées/départs aux stops. Le **lien
   chauffeur** (révocable, page mobile `/driver/<token>`) permet au chauffeur de pointer les
   stops et de **capturer le POD** (signature, photo, réserves).
8. **Suivi** — timeline d'événements sur load/expédition ; **lien de suivi public**
   (`/track/<token>`, révocable) façon suivi de colis pour le client final ; courriel
   automatique « livré » au contact du client.
9. **Facturation transporteur** — `Invoices` : un brouillon regroupe les loads COMPLETED non
   facturés au coût estimé (= montant attendu). Saisir ensuite la **facture réellement
   reçue** (n° + montants par ligne) → **rapprochement automatique** : dans la tolérance
   (défaut 2 % / 25, sur l'écart **brut** — les erreurs qui se compensent sont attrapées)
   la facture passe `APPROVED` ; au-delà elle passe `DISPUTED`. Un litige se résout en
   payant le montant facturé ou le montant attendu (motif codifié + note), ou en
   re-rapprochant une facture corrigée. Puis **Mark paid**. **Export CSV** de la liste.

### Par écran (espace tenant)

| Écran | Fonctionnalités |
| ----- | --------------- |
| `Dashboard` | Compteurs (commandes, expéditions, loads, transporteurs) |
| `Transport orders` | CRUD, confirm/plan/split/cancel/close, détail avec timeline |
| `Shipments` | Liste, assignation aux loads, annulation |
| `Loads` | Détail complet : ressources, tarif, route, tender, exécution, POD |
| `Lanes` | Listes de préférence transporteurs par lane (pilotent l'auto-tender) |
| `Customers` / `Carriers` | Données maîtres + **lien portail client** (générer/révoquer) |
| `Invoices` | Brouillons, rapprochement, litiges, paiement, export CSV |
| `Analytics` | Scorecard transporteurs : loads, taux d'acceptation, ponctualité, dépense |
| `Settings → Users` | Invitations (lien 72 h), rôles, désactivation |
| `Settings → API keys` | Clés machine-à-machine avec scopes ; les scopes d'écriture agissent via un compte de service caché (audit intact) |
| `Settings → Modules` | Activer/désactiver les modules du tenant |
| `Settings → SSO` | Config OIDC du tenant : issuer, clientId, secret (chiffré au repos, masqué `***`), rôle par défaut des utilisateurs provisionnés |

### Pages publiques (à jeton, sans compte)

| URL | Pour qui |
| --- | -------- |
| `/tender/<token>` | Le transporteur accepte/refuse une offre |
| `/track/<token>` | Le client final suit son expédition |
| `/driver/<token>` | Le chauffeur pointe les stops et capture le POD |
| `/portal/<token>` | Le client du chargeur voit ses commandes **et en soumet de nouvelles** |
| `/reset-password/<token>` | Activation de compte invité / réinitialisation |

### Console plateforme (`/platform`)

- **Créer un tenant** : slug, nom, modules à activer, admin initial — le tenant reçoit un
  rôle Administrateur complet et son admin un **lien d'invitation 72 h** (affiché et envoyé
  par courriel).
- **Suspendre / réactiver** un tenant — la suspension révoque immédiatement les sessions
  (login et refresh refusés, SSO compris).
- Token plateforme de 12 h, totalement étanche aux routes tenant (et inversement).

### SSO OIDC (connexion entreprise)

1. `Settings → SSO` : renseigner l'issuer, le clientId, le secret de l'IdP (Azure AD,
   Keycloak, Okta…), choisir le rôle par défaut, activer.
2. Côté IdP, autoriser l'URL de callback : `http://localhost:3000/api/v1/auth/oidc/<slug>/callback`.
3. Les utilisateurs cliquent « Sign in with SSO » sur la page de login : flow PKCE complet ;
   au premier login l'utilisateur est **provisionné automatiquement** avec le rôle par défaut.

## 5. Tester

```bash
pnpm test        # unitaires : state machines & tolérance (vitest) + API (jest)
pnpm test:e2e    # 56 tests bout-en-bout par HTTP — exige la DB démarrée ET seedée
```

Les suites e2e créent leurs propres données avec des codes uniques : elles sont rejouables.

## 6. Dépannage courant

| Symptôme | Cause / remède |
| -------- | -------------- |
| L'API refuse de démarrer : `ENCRYPTION_KEY is required` | Le `.env` manque ou n'a pas la clé — refaire `cp .env.example .env` (ou générer une clé : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) |
| `Can't reach database server` | Docker pas démarré ou conteneur arrêté → `pnpm db:up` |
| Login refusé après un reseed | Reseed = données recréées idempotentes ; les comptes seedés restent `admin@pulsar.dev` / `platform@pulsar.dev` avec `admin123` |
| e2e rouges localement | DB pas migrée/seedée → `pnpm db:up && pnpm db:migrate && pnpm db:seed` puis relancer |
| Page Invoices vide | Le module Billing est peut-être désactivé → `Settings → Modules` |
| Changement de rôle sans effet immédiat | Les permissions vivent dans le JWT → effet au prochain refresh (≤ 15 min) — comportement assumé |

---

## Useful scripts

| Script            | Description                                  |
| ----------------- | -------------------------------------------- |
| `pnpm dev`        | API + web in watch mode                      |
| `pnpm build`      | Build all workspaces                         |
| `pnpm typecheck`  | Type-check all workspaces                    |
| `pnpm test`       | Unit tests (shared vitest + API jest)        |
| `pnpm test:e2e`   | End-to-end suite (needs a seeded database)   |
| `pnpm db:migrate` | Create/apply a Prisma migration              |
| `pnpm db:seed`    | Seed catalogs + demo tenant + sample data    |
| `pnpm db:studio`  | Open Prisma Studio                           |
| `pnpm format`     | Prettier on the whole repo                   |

## Documentation

- [docs/guide-fonctionnel.md](./docs/guide-fonctionnel.md) 🇫🇷 — guide fonctionnel (concepts
  métier, parcours utilisateur, règles de gestion)
- [docs/getting-started.md](./docs/getting-started.md) — full local setup walkthrough
- [docs/architecture.md](./docs/architecture.md) — monorepo, API layering, guards
- [docs/data-model.md](./docs/data-model.md) — domain model and TMS workflow
- [docs/multi-tenancy.md](./docs/multi-tenancy.md) — isolation strategy
- [docs/module-system.md](./docs/module-system.md) — per-tenant module activation
- [docs/api-conventions.md](./docs/api-conventions.md) — REST conventions
- [docs/collaboration.md](./docs/collaboration.md) — public links, API keys, email, webhooks, billing
- [docs/runbooks.md](./docs/runbooks.md) — key rotation, backup/restore
- [docs/audit-tms-2026-06-10.md](./docs/audit-tms-2026-06-10.md) 🇫🇷 — TMS audit vs enterprise reference
- [CLAUDE.md](./CLAUDE.md) — instructions for AI coding sessions
- [TODO.md](./TODO.md) — structured task list by phase
