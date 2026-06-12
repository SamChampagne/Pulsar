# État du projet — point de reprise

> 🇫🇷 Document de synthèse pour reprendre le travail (humain ou session Claude Code).
> Mis à jour à la fin de la **phase 8**. Détail des tâches : [TODO.md](../TODO.md) ·
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
| 8 — Ligne MVP audit fermée (BOL, modes, exceptions) | ✅ | **BOL généré** : `buildBolData` pure (shipper = 1er stop PICKUP / fallback originLocation ; consignee = dernier DELIVERY / fallback destinationLocation), `renderBol` pdfkit (LETTER, 3 blocs signature + lignes exceptions + conditions), `BolService.generate` (DISPATCHED+, séquence BOL-, entityType `bill-of-lading`, audité), `POST /loads/:id/bol`, `GET /loads/:id/documents`, `GET /public/driver/:token/bol` (token-résolu, pas d'id interne dans le payload public, 404 si pas encore généré) ; **mode de transport** : enum `TransportMode` (FTL/LTL/PARCEL) sur `TransportOrder`, `Load`, `Rate` (null = tous modes), filtrage des deux côtés au rating, héritage premier-assign, `modeWarning` non bloquant, `suggestMode` hint (≤30 kg PARCEL / ≤4000 kg LTL / au-dessus FTL) — arbitrage à seuils non couvert (§4) ; **moteur d'exceptions** : `isLate` pure, cron 5 min + `tick(now)`, dedup `(stopId, deadline)`, événement `DELAYED` + `Notification` tenant (userId nullable, read-by-one = read-for-all v1), cloche UI ; 15ᵉ migration |
| 9 — Refonte UI (console hybride) | ✅ | **Design system maison** (Tailwind 4, tokens CSS prêts dark-mode, 17 composants `$lib/components/ui` + barrel), **shell repliable** (sidebar sombre par groupes, palette ⌘K navigation+actions avec slot assistant IA réservé, cloche notifications, pile d'overlays Escape), **28 pages refondues** (pattern liste+Panel, densité commutable persistée, skeletons, Modals form-in-children, helpers format), **LoadMap Leaflet** (détail load interne : stops + dernière position, lecture seule), pages publiques re-skinnées **sans exposition supplémentaire** (notes tender et liste shipments chauffeur retirées au passage), plan plateforme distinct (badge danger). **Zéro changement API** (`git diff main -- apps/api packages` vide) ; 93 e2e + 89 unit verts. Carte publique différée (payload sans coordonnées) ; UI MFA plateforme inexistante (gap préexistant noté) |

**La boucle économique complète fonctionne** : le client commande depuis son portail →
confirmation → planification (split possible) → tender automatique par lane avec courriel →
acceptation transporteur sans compte → dispatch → exécution mobile chauffeur → suivi public →
POD avec photo → BOL PDF généré → détection automatique des retards → facture transporteur
brouillon → approbation → relevé client.

**Chiffres** : 3 modules métier actifs (transportation, customer-portal, billing) + le plan
d'administration plateforme ; 16 migrations ; ~78 endpoints ; 28 pages web sur le design
system phase 9 (Tailwind 4, 17 composants partagés, carte Leaflet sur le détail load).

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

## Prochaine session — phase 10 : OSRM + carte opérationnelle (décidé au brainstorming du 2026-06-12)

La refonte UI (phase 9) est livrée — spec : [2026-06-12-refonte-ui-design.md](./superpowers/specs/2026-06-12-refonte-ui-design.md).
**Test manuel humain encore à faire** sur la branche `phase-9` avant merge (les e2e ne
couvrent pas le rendu visuel).

**Phase 10 cadrée (hors périmètre phase 9, décidé au brainstorming)** :
- Moteur carto **OSRM** (backend) : distances/temps automatiques sur les routes,
  fiabilise PER_KM (recommandation audit §7 « intégrer, ne pas écrire » ; Fleetbase
  valide le pattern `OSRM_HOST` configurable).
- **Carte opérationnelle live** sur le dashboard : loads actifs, dernières positions,
  retards en rouge (le composant `LoadMap` de la phase 9 est le germe).
- **Décision d'exposition** : coordonnées dans le payload public de suivi (oui/non)
  pour la carte publique — différée de la phase 9 exprès.

Puis **phase 11 : différenciateurs IA** (§19.2 agent opérationnel avec file « actions
proposées » — la palette ⌘K de la phase 9 lui réserve déjà sa place dans l'UI ;
§19.1 ingestion de grilles ; §19.4 extraction factures PDF). Voir le benchmark
Fleetbase (2026-06-12) : aucune IA chez eux, c'est l'axe de différenciation.

Les deux options stratégiques antérieures restent valides (ci-dessous).

La **phase 8 est complète**. Les trois trous sous la ligne MVP de l'[audit TMS](./audit-tms-2026-06-10.md)
(tarification §5, BOL §9, exceptions §10) sont tous soldés (§5 et §11 par les phases 7.1/7.3,
§9 et §10 par la phase 8). Il n'y a plus de blocage MVP.

**Deux options stratégiques (après la refonte UI), sans choix imposé :**

**(a) Pilote client** — stabilisation opérationnelle avant de mettre Pulsar entre les mains d'un
premier client réel :
- Taxes sell-side (GST/QST/TVA) sur `CustomerInvoice` / `CustomerInvoiceLine`
- Smoke test S3 en vrai bucket (le driver est restauré mais n'a jamais tourné en CI)
- Durcissement opérationnel (erreurs standards machine-lisibles, throttling sur les endpoints
  publics à fort trafic potentiel, alerte épuisement de liste tender)

**(b) Différenciateurs de l'audit §19** — les deux paris jugés atteignables avec refactoring ciblé :
- **Freight audit autonome (§19.4)** : entité « facture transporteur entrante », import/match
  contre `Load.estimatedCost`, tolérance, dispute — ROI le plus démontrable (2-5 % des montants)
- **Agent opérationnel (§19.2)** : clés d'idempotence explicites, file « actions proposées »
  pour validation humaine — le substrat (API permissionnées, compte de service, audit) est déjà là

### Dette connue à garder en tête (ne pas « réparer » en silence)

- Permissions dans le JWT → effet au prochain refresh (≤15 min) — assumé ; même fenêtre
  pour les access tokens d'un tenant suspendu (documenté dans platform-tenants.service.ts).
- Cache modules en mémoire processus → passer à Redis quand l'API scale horizontalement.
- Courriels : driver `log` en dev ; tender/identité/livraison/invitation plateforme envoyés.
- Route v0 auto-générée (éditeur manuel dispo) ; pas de re-split après exécution.
- Webhooks limités à 5 tentatives ; configs d'intégration legacy encore en clair jusqu'au
  premier passage du script `reencrypt-secrets` (sweep initial documenté dans runbooks.md).
- L'utilisateur `service-account@pulsar.local` apparaît dans la page Users (cosmétique).
- **L'UI du login plateforme n'a aucun écran MFA** (constat phase 9) : le backend 7.4
  gère TOTP/recovery/step-tokens, mais le front `platform/login` ne fait que
  email+mot de passe — un compte avec MFA actif ne peut pas compléter son login en UI.
  À traiter quand `PLATFORM_MFA_ENFORCED` sera activé quelque part.
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
