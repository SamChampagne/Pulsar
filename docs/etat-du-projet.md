# État du projet — point de reprise

> 🇫🇷 Document de synthèse pour reprendre le travail (humain ou session Claude Code).
> Mis à jour à la fin de la **phase 7.4**. Détail des tâches : [TODO.md](../TODO.md) ·
> vision : [ROADMAP.md](../ROADMAP.md) · règles de dev : [CLAUDE.md](../CLAUDE.md) ·
> **audit TMS vs référentiel entreprise : [audit-tms-2026-06-10.md](./audit-tms-2026-06-10.md)**
> (à lire avant de prioriser quoi que ce soit).

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
| 6 — Commercial readiness | ✅ | **Plan d'admin plateforme** (création/suspension de tenants, PlatformUser disjoint, garde-fous prod), **SSO OIDC par tenant** (PKCE, state chiffré, provisioning), **rapprochement de factures transporteur** (tolérance sur écart brut, litiges codifiés, PAID, export CSV — réorientation issue de l'audit TMS), **secrets chiffrés au repos** (enc:v1 + script de rotation idempotent + runbooks), doc de découverte Fleet |
| 7.1 — Rating engine v2 + Lane | ✅ | **Lane entité première classe** (hiérarchie géo, clés normalisées NFD, spécificité déterministe), **tarifs v2** (tranches CWT as-if, accessorials, table carburant datée), **snapshot `costDetail` figé** (invariant COMPLETED + updateMany atomique), **rate shopping** (`GET /loads/:id/rate-options`), auto-tender par spécificité, CRUD accessorials + fuel-tables, 4 permissions, seed démo, 4 pages web (rates/lanes/accessorials/fuel-tables) + détail load enrichi, 11ᵉ migration |
| 7.2 — Intégrité du plan | ✅ | **Fenêtres temporelles early/late** sur TransportOrder, Shipment et Stop (RENAME sans perte de données) ; validations dures 400 (`assertWindowCoherence`) + avertissements consultatifs `windowWarnings` sur GET order/load ; **capacité 3 axes** (`checkCapacity` poids/volume/palettes, axe inconnu ignoré, dépassement forcé = audit consolidé) ; `capacityPallets` Trailer ; **jonction `shipment_load_legs`** maintenue dans la même transaction + backfill ; on-time analytics `plannedDeliveryLate ?? plannedDeliveryEarly` ; 6 tests e2e ; 12ᵉ migration |
| 7.3 — Billing sell-side | ✅ | **Relevés client** depuis les ordres livrés et ratés (`CustomerInvoiceStatus` DRAFT→APPROVED→SENT→PAID) ; `RatingService.rateOrder` (taux client uniquement, lane ou catch-all client, date de référence = dernier `actualDeliveryAt` sinon today, moins cher retenu) ; un relevé par devise (`groupByCurrency`) ; anti-double-billing (`transportOrderId @unique`) ; échappatoire DRAFT (suppression libère les ordres) ; envoi conditionné sur email client + succès email (libellé « Billing statement ») ; 4 permissions `billing.customer-invoices.*` ; séquence CINV ; 8 tests e2e ; 13ᵉ migration |
| 7.4 — Durcissements différés phase 6 | ✅ | **MFA plateforme** (TOTP otplib ±1, `totpSecret enc:v1` + `mfaEnabledAt` + `recoveryCodes` bcrypt à usage unique, step tokens `mfa-enroll`/`mfa-pending` rejetés par `PlatformJwtStrategy`, 3 branches login dont `PLATFORM_MFA_ENFORCED`, `enroll-start` authentifié) ; **throttling** `PlatformAuthController` 20 req/min/IP ; **`@PlatformController()`** composite `Public + PlatformGuard` ; **cache `Issuer.discover`** TTL 1 h + retry-once ; **slug tenant dans le state OIDC** vérifié au callback ; **`csvSafe()`** sur les champs libres de l'export CSV ; **`updateMany` conditionnel** sur les transitions buy-side + `createDrafts` transactionnel `P2002 → 409` ; 6 tests e2e ; 14ᵉ migration |

**La boucle économique complète fonctionne** : le client commande depuis son portail →
confirmation → planification (split possible) → tender automatique par lane avec courriel →
acceptation transporteur sans compte → dispatch → exécution mobile chauffeur → suivi public →
POD avec photo → facture transporteur brouillon → approbation.

**Chiffres** : 3 modules métier actifs (transportation, customer-portal, billing) + le plan
d'administration plateforme ; 219 tests (65 vitest shared + 67 jest unitaires API + 87 E2E,
tous verts et rejouables) ; 14 migrations ; ~75 endpoints ; 32 pages web dont 5 publiques à
jeton et 2 plateforme.

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

## Prochaine session : Phase 8

L'[audit TMS](./audit-tms-2026-06-10.md) est la boussole. La phase 7 est **complète** (7.1, 7.2,
7.3, 7.4 tous livrés). Phase 8 recommandée :

1. **BOL généré** — Lettre de transport (Bill of Lading) PDF générée à partir des données du load ;
   numéro de séquence dédié (BOL) ; endpoint de téléchargement ; intégration dans la page load.
2. **Sélection de mode LTL / FTL** — champ mode sur TransportOrder et Load ; filtrage des taux
   par mode (audit TMS §4) ; affichage dans l'UI et les exports.
3. **Moteur d'exceptions simple** — détection des retards (fenêtres temporelles 7.2 vs
   `actualArrivalAt`) ; alertes dans l'UI (badge sur le load) ; événement de tracking
   `DELAY_DETECTED` ; correspond aux trous §9/§4/§10 de l'audit sous la ligne MVP.

### Dette connue à garder en tête (ne pas « réparer » en silence)

- Permissions dans le JWT → effet au prochain refresh (≤15 min) — assumé ; même fenêtre
  pour les access tokens d'un tenant suspendu (documenté dans platform-tenants.service.ts).
- Cache modules en mémoire processus → passer à Redis quand l'API scale horizontalement.
- Courriels : driver `log` en dev ; tender/identité/livraison/invitation plateforme envoyés.
- Route v0 auto-générée (éditeur manuel dispo) ; pas de re-split après exécution.
- Webhooks limités à 5 tentatives ; configs d'intégration legacy encore en clair jusqu'au
  premier passage du script `reencrypt-secrets` (sweep initial documenté dans runbooks.md).
- L'utilisateur `service-account@pulsar.local` apparaît dans la page Users (cosmétique).
- Le driver S3 (restauré en phase 6 après l'incident `.gitignore`) n'a jamais tourné en CI
  (CI = driver local) — smoke test contre un vrai bucket avant le premier déploiement S3.
- `pnpm-workspace.yaml` local porte des placeholders auto-générés par pnpm (« set this to
  true or false ») et un `package-lock.json` parasite traîne — à nettoyer hors phase.

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
