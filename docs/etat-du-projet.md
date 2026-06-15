# État du projet — point de reprise

> 🇫🇷 Document de synthèse pour reprendre le travail (humain ou session Claude Code).
> Mis à jour à la fin de la **phase 15-A**. Détail des tâches : [TODO.md](../TODO.md) ·
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
| 9 — Refonte UI (console hybride) | ✅ | **Design system maison** (Tailwind 4, tokens CSS prêts dark-mode, 17 composants `$lib/components/ui` + barrel), **shell repliable** (sidebar sombre par groupes, palette ⌘K navigation+actions avec slot assistant IA réservé, cloche notifications, pile d'overlays Escape), **28 pages refondues** (pattern liste+Panel, densité commutable persistée, skeletons, Modals form-in-children, helpers format), **LoadMap Leaflet** (détail load interne : stops + dernière position, lecture seule), pages publiques re-skinnées **sans exposition supplémentaire** (notes tender et liste shipments chauffeur retirées au passage), plan plateforme distinct (badge danger). **Zéro changement API** (`git diff main -- apps/api packages` vide) ; 93 e2e + 89 unit verts. Carte publique différée (payload sans coordonnées). Retours du test manuel intégrés : pages détail résilientes aux échecs des appels auxiliaires, modal rates élargi, **UI MFA plateforme livrée** (TOTP, enrôlement forcé, recovery codes — vérifiée par login TOTP réel) |
| 10 — OSRM + carte opérationnelle | ✅ | **Moteur carto** `RoutingService` core (drivers env `ROUTING_DRIVER`/`GEOCODING_DRIVER`, défaut `none`, timeout 3 s best-effort, jamais bloquant), distances/durées auto au build de route (`distanceSource MANUAL\|OSRM\|HAVERSINE`, manuel jamais écrasé — y compris demi-coordonnées, géométrie GeoJSON simplifiée stockée même en manuel), **fallback haversine** badgé « estimate » dans l'UI ; **géocodage Nominatim** (cache BD global `geocode_cache`, 1 req/s in-process, UA custom, échec jamais mis en cache) au create/update de location ; **positions chauffeur** (`POST /public/driver/:token/position` borné ±90/±180, re-check module, throttlé 20/min/IP, dédoublonné 60 s + dedupKey minute race-proof ; pings page chauffeur : immédiat + visibilitychange + 2 min, indicateur avec opt-out) ; **carte live dashboard** (`GET /loads/active-map` sans géométrie, `isLate` du moteur d'exceptions réutilisé, OpsMap polling 45 s onglet visible, retards rouges, fitBounds premier chargement seulement) ; **suivi public avec carte** (lastPosition + coords o/d, jamais d'historique ni les autres stops) ; géométrie OSRM réelle sur le détail load (`L.geoJSON`) ; docker profil `osrm` opt-in + doc d'amorçage ; e2e OSRM réel conditionnelle ; 17ᵉ migration ; 10 e2e phase 10 |
| 11 (palier 1) — Gouvernance d'agents + MCP | ✅ | **Identité `Agent`** (cousine d'`ApiKey` : permissions + `caps` + un service-user caché DISABLED PAR agent pour l'attribution d'audit, jamais loginable ; clé `ak_` montrée une seule fois, hash sha256 stocké) ; **endpoint MCP Streamable-HTTP stateless** `POST /api/v1/mcp` (auth par clé d'agent via header `X-Agent-Key`, `@modelcontextprotocol/sdk` 1.29) qui n'expose que les outils autorisés = permissions ∩ modules du tenant ∩ `caps.toolAllowlist` ; **8 outils dispatch** dans un registre unique (tier/permission/module/zod/handler réutilisant les services TMS) — READ/LOW exécutés en direct, MUTATING/SENSITIVE mis en **file `ProposedAction`** (idempotente sur `(agentId, idempotencyKey)`, plafonds montant + débit/min vérifiés à l'enfilage) ; **inbox d'approbation humaine** (`GET /agent-actions`, `POST :id/approve\|reject`, permissions `core.agents.actions.*`) : l'approbation re-vérifie le statut (claim atomique) puis exécute le vrai appel attribué à l'agent et audité avec l'approbateur ; `caps.autoApprove` = seul contournement de la file ; **2 pages web** (réglages agents avec clé unique + scopes + plafonds ; inbox actions avec badge nav gated `core.agents.actions.read`) ; aucun LLM ne tourne dans Pulsar à ce palier (BYO-agent, MCP-agnostique, Hermes = client de référence) ; **guide de connexion [docs/agents.md](./agents.md)** ; 18ᵉ migration ; 7 e2e phase 11 |
| 11 (palier 2a) — Agents-employés (cerveau Hermes dans Pulsar) | ✅ | **Agent-employé** = persona/rôle/modèle LLM/**niveau d'autonomie** (`PROPOSE`/`ACT_LOW`/`AUTONOMOUS`, `@pulsar/shared`) ajoutés à l'entité `Agent` ; **assistant ⌘K** qui *streame* la conversation via **ACP** (`AgentRuntimeService` **spawn un processus Python Hermes par conversation** sur stdio — isolation tenant car l'enregistrement MCP de Hermes est process-global ; `HermesAcpClient` + faux serveur ACP pour les tests) ; **Hermes = cerveau, Pulsar = maison** (UI, identité, outils MCP, file de gouvernance) — les appels d'outils de l'agent tapent `POST /api/v1/mcp` **en tant qu'agent** via un **jeton de session** court (`AGENT_SESSION_SECRET`, fallback `JWT_SECRET`) → chemin palier 1 ; **conversations persistées** (`AgentConversationsService` + endpoints `GET/POST /agent-conversations`, `GET :id`, `POST :id/messages`, tour SSE) ; **gouvernance palier 1 réutilisée** + correction d'un trou : le **plafond montant est désormais appliqué sur le chemin d'auto-approbation** (`mcp-server.factory.ts`) — l'autonomie ne lève jamais les caps ; perm `core.agents.chat` ; runtime **opt-in & best-effort** (Hermes absent ⇒ 503, jamais de crash) ; **MCP-agnostique** (Hermes = runtime de référence) ; champs web (persona/rôle/modèle/autonomie/avatar) + panneau ⌘K ; 19ᵉ migration ; e2e `phase11b-agents-employes` |
| 11 (R1) — Runtime Hermes managé par Pulsar | ✅ | **Installation et configuration sans toucher au `.env`** : `pnpm agents:setup` installe Hermes dans `hermes-agent/.venv` via **uv** (récupère automatiquement un CPython 3.12 autonome — Hermes exige 3.11–3.13, donc aucune install Python manuelle) ; **config par tenant** (`AgentRuntimeConfig`, 20ᵉ migration) éditable dans **Réglages → Runtime agents** : choix d'un provider du catalogue `RUNTIME_PROVIDERS` (`@pulsar/shared`, pure data browser-safe) puis soit une **clé API chiffrée via `CryptoService`** (jamais renvoyée en clair), soit un **login OAuth** (Codex/Nous) dont Pulsar streame en SSE le device code + URL et dont les jetons vivent dans le `HERMES_HOME` par tenant ; **builder d'env** (`agent-runtime-env.ts`) + `runtime-config.service` (crypto) + `runtime-config.controller` (REST + SSE), injection de la config dans `openSession` du `AgentRuntimeService` ; endpoints `/agent-runtime` (`GET providers`, `GET`/`PUT`, `POST test`, `POST connect` SSE — gated `core.agents.manage`) ; runtime best-effort par tenant (503 si Hermes absent) ; page web Réglages + e2e `phase11r1-agent-runtime` |
| 11 (R2) — Espace Agents (citoyens de premier ordre) | ✅ | **Agents promus au niveau supérieur de la navigation** : onglet **Agents** → **roster de cartes « employés »** → page agent (`/agents/[id]`) à trois volets — **Profil & config guidée** (aide inline + presets de rôle `AGENT_ROLE_PRESETS` de `@pulsar/shared`), **Activité** (conversations + actions proposées + compteurs `conversations`/`pending`/`executed`/`rejected`) et **Chat** (parler à cet employé) ; `GET /agents/:id` projette le profil **sans `secretHash` ni `serviceUserId`** et `GET /agents/:id/activity` renvoie l'activité **scopée tenant + agent** (gated `core.agents.read`) ; presets = pure data testée (`role-presets.spec`) + e2e `phase11r2-agent-experience` |
| 12 — Operating Workbench | ✅ | **Outbox `DomainEvent`** (best-effort, worker `processPending` race-safe claim `PENDING→PROCESSED`, échecs terminaux) ; **policies événement→tâche** dans `@pulsar/shared/operating` (pures, testées) : retards de stop et échecs tender émis comme events, mappés en `OperationalTask` idempotente sur `(tenantId, dedupKey)` ; **`OperationalTask` + inbox `/workbench`** (statuts via `canTransitionOperationalTask`, 2 permissions `core.operating.tasks.*`, tri priorité + statut) ; **`WorkbenchAgentRunner`** headless best-effort (agent `alwaysOn` + `handlesCategories` réveillé sur ses cas, Hermes absent ⇒ skip tâche revenue OPEN, `runCron` n'émet jamais d'exception) ; **4 outils workbench** au registre (list/get/claim/resolve tasks) + `triggeredByRef = "task:<id>"` dans le jeton de session agent ; 21ᵉ migration |
| 13 — Main-d'œuvre 24/7 | ✅ | **`AgentWorkerService`** dispatcher unique (réveil sur event + cron filet de sécurité, file en mémoire, concurrence plafonnée global/tenant/agent) ; **`AgentRun`** ledger durable + `GET /agents/:id/runs` ; **heartbeat** (`lastSeenAt`/`lastRunAt`) ; **`PAUSED` kill switch à chaud réversible** (endpoints pause/resume/run-now/pause-all) tuant les sessions Hermes en vol via `AgentRuntimeService.killAgentSessions`, `REVOKED` permanent ; **retry borné** sur erreurs de connectivité runtime (`classifyRunError` de `@pulsar/shared`, Hermes absent ⇒ run `SKIPPED`, autre échec terminal → tâche en OPEN) ; **revert claim-guarded** (un run ne revert IN_PROGRESS→OPEN que s'il a réellement claim) ; règle 24 préservée (best-effort, jamais de crash) + actions via file `ProposedAction` `triggeredByRef = "task:<id>"` ; UI web « Activité 24/7 » ; 22ᵉ migration |
| 14 — Autonomie & policy engine | ✅ | **Porte de policy unifiée** : `evaluatePolicy` (`@pulsar/shared`, pur) au **point de décision unique** (`ProposedActionsService.handleMutatingTool`, appelé par le handler MCP) tranche auto-act vs propose ; **policy-as-data** — règles effectives depuis `caps.policies` ou le preset dérivé du dial `autonomyLevel` (`caps.autoApprove` legacy toujours honoré, rétro-compatible) ; **auto-exécution persistée dans le registre des propositions** (`ProposedAction EXECUTED autoApproved=true`, auditable + **compté pour le cap débit/min** — trou fermé : le chemin auto respecte désormais le débit) ; **cap MONTANT dur** (`maxAmountPerAction`) appliqué dans `enqueue` sur TOUS les chemins (seule enforcement montant pour un agent en PROPOSE, au-dessus → DENY, jamais levé par l'autonomie) ; **circuit breaker réversible** (`Agent.breakerTrippedAt` rétrograde en PROPOSE, ne modifie JAMAIS `autonomyLevel`, jamais d'escalade auto) ; **score de confiance** + **promotion d'autonomie confirmée par un humain** ; règles 23/24 préservées ; règle 29 ; 23ᵉ migration |

**La boucle économique complète fonctionne** : le client commande depuis son portail →
confirmation → planification (split possible) → tender automatique par lane avec courriel →
acceptation transporteur sans compte → dispatch → exécution mobile chauffeur → suivi public →
POD avec photo → BOL PDF généré → détection automatique des retards → facture transporteur
brouillon → approbation → relevé client.

**Chiffres** : 3 modules métier actifs (transportation, customer-portal, billing) + le plan
d'administration plateforme ; 23 migrations ; ~90 endpoints (dont `loads/active-map`,
`public/driver/:token/position`, `mcp` / `agents` / `agent-actions` / `agent-conversations`,
`agent-runtime` — install/config du runtime managé, `operational-tasks` / `/workbench`, et
`agents/:id/runs` + pause/resume/run-now/pause-all — main-d'œuvre 24/7) ;
31 pages web sur le design system phase 9 (Tailwind 4, 17 composants partagés) ; carte
opérationnelle live sur le dashboard + cartes Leaflet sur le détail load et le suivi public
(phase 10) ; couche gouvernance d'agents + endpoint MCP exposant 8 outils dispatch sous
validation humaine (phase 11 palier 1) ; agents-employés (cerveau Hermes spawné par
conversation, assistant ⌘K) sur la même file de gouvernance, plafond montant appliqué à
l'auto-approbation (phase 11 palier 2a) ; **runtime Hermes installé via `pnpm agents:setup`
(uv) et configuré par tenant dans Pulsar — clé chiffrée ou login OAuth** (phase 11 R1) ;
**agents promus citoyens de premier ordre** — roster, profil + config guidée (presets de rôle),
activité et chat sur `/agents` (phase 11 R2) ; **Operating Workbench** — outbox DomainEvent,
policies événement→tâche pures, inbox `/workbench`, WorkbenchAgentRunner headless best-effort,
4 outils workbench + `triggeredByRef` (phase 12) ; **main-d'œuvre 24/7** — `AgentWorkerService`
dispatcher (event + cron, concurrence plafonnée), `AgentRun` ledger durable + heartbeat, `PAUSED`
kill switch à chaud tuant les sessions Hermes en vol, retry borné sur connectivité, revert
claim-guarded, UI « Activité 24/7 » (phase 13) ; **autonomie & policy engine** — porte de
policy unifiée (`evaluatePolicy` pur, point de décision unique), policy-as-data
(`caps.policies` + preset du dial d'autonomie, rétro-compatible), auto-exécution persistée
dans le registre des propositions (cap débit fermé sur le chemin auto), circuit breaker
réversible (rétrograde en PROPOSE, jamais d'escalade) et promotion d'autonomie confirmée par
un humain (phase 14) ; **Control Tower — observabilité** — KPI par agent, dashboard manager du
tenant, timeline d'activité/audit unifiée, compteur de trips de breaker alimentant le score de
confiance, **calculés à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog`
(`deriveAgentKpis`/`mergeTimeline` purs, aucun store de rollup, **aucune migration** — toujours 23)
(phase 15-A).

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
| Connexion d'un agent IA (MCP) / Hermes | [agents.md](./agents.md) |

## Prochaine session — Pulsar Agent OS (phases 15 → 22)

La **phase 15-A est livrée** (Control Tower — observabilité) sur la branche `phase-15`
(suite des phases 12 → 14 livrées). PR à ouvrir vers `main`.

La direction est verrouillée : voir la **roadmap stratégique adoptée le 2026-06-14**,
[docs/superpowers/specs/2026-06-14-pulsar-agent-os-roadmap.md](./superpowers/specs/2026-06-14-pulsar-agent-os-roadmap.md).
North star = **OS logistique modulaire où des agents Hermes tournent 24/7 comme employés
gouvernés**. Arc = agents d'abord (approfondir sur les 3 modules actuels), puis modules tressés
— chaque nouveau module arrive avec son agent.

- **Acte I (substrat 24/7)** : ~~12 Operating Workbench~~ ✅ · ~~13 Main-d'œuvre 24/7~~ ✅ ·
  ~~14 Autonomie & policies~~ ✅ · ~~15-A Control Tower (observabilité)~~ ✅ ·
  15-B red-team (prompt-injection + cross-tenant) · 15-C playbooks.
- **Acte II (agents phares)** : 16 Freight Audit autonome (§19.4) · 17 Planification continue (§19.5).
- **Acte III (modules tressés, ré-ordonnable)** : 18 Integrations · 19 Yard · 20 Fleet · 21 WMS ·
  22 Analytics/réseau de données.

**Prochain pas concret** (au choix de Sam) : soit terminer la phase 15 avec **15-B** (harnais
red-team : prompt-injection + cross-tenant) puis **15-C** (playbooks) ; soit pivoter vers
**l'Acte II** — **phase 16 Freight Audit autonome** (§19.4) ou **phase 17 planification continue**
(§19.5). Pulsar reste **MCP-agnostique** ; Hermes est le runtime de référence.

Benchmark Fleetbase (2026-06-12) : aucune IA chez eux — c'est l'axe de différenciation.

### Dette connue à garder en tête (ne pas « réparer » en silence)

- Permissions dans le JWT → effet au prochain refresh (≤15 min) — assumé ; même fenêtre
  pour les access tokens d'un tenant suspendu (documenté dans platform-tenants.service.ts).
- Cache modules en mémoire processus → passer à Redis quand l'API scale horizontalement.
- Courriels : driver `log` en dev ; tender/identité/livraison/invitation plateforme envoyés.
- Route v0 auto-générée (éditeur manuel dispo) ; pas de re-split après exécution.
- Webhooks limités à 5 tentatives ; configs d'intégration legacy encore en clair jusqu'au
  premier passage du script `reencrypt-secrets` (sweep initial documenté dans runbooks.md).
- L'utilisateur `service-account@pulsar.local` apparaît dans la page Users (cosmétique).
- ~~UI MFA plateforme absente~~ — **réglé en fin de phase 9** : `platform/login` gère
  les 4 états (credentials → TOTP/recovery → enrôlement forcé avec secret manuel →
  affichage unique des recovery codes). Pas de QR code (secret + URL otpauth copiables) —
  une lib QR est un petit plus futur si besoin.
- Le driver S3 (restauré en phase 6 après l'incident `.gitignore`) n'a jamais tourné en CI
  (CI = driver local) — smoke test contre un vrai bucket avant le premier déploiement S3.
- `pnpm-workspace.yaml` local porte des placeholders auto-générés par pnpm (« set this to
  true or false ») et un `package-lock.json` parasite traîne — à nettoyer hors phase.
- `routes.createForLoad` : check de statut puis OSRM (≤3 s) puis deleteMany+create hors
  transaction — fenêtre TOCTOU élargie ; à envelopper dans une transaction avec re-check.
- `loads/active-map` : requête « dernière position par load » non bornée (dédup en JS) —
  passer à `DISTINCT ON` ou borner temporellement, et prévoir une purge des POSITION_UPDATE.
- Règle 15 incohérente sur les anciens handlers publics : seul `driver/:token/position`
  re-vérifie l'activation du module (getTracking/getDriverView/driverUpdateStop/driverCreatePod
  ne le font pas — préexistant, à harmoniser).
- Throttle Nominatim 1 req/s in-process : mono-instance seulement (à revoir avec le passage
  Redis du cache modules).

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
