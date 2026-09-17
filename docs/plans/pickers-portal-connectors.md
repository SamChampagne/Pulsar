# Aide à la saisie, portail client v2 & connecteurs (arc 3)

Date : 2026-09-17. Branche : `access-module-core-locations` (base `a3aedc7`, 34 commits jusqu'à
`867564b` inclus + ce commit de documentation ; **non mergée, non poussée**). Spec :
`docs/superpowers/specs/2026-09-17-pickers-portal-connectors-design.md`. Registre d'exécution :
`.superpowers/sdd/2026-09-17-pickers-portal-connectors/progress.md`.

## Résultat métier

Trois demandes de Sam, traitées comme trois sous-projets sur la même branche :

1. **« Plus d'aide pour remplir les champs : on ne tape pas un nom d'entrepôt, on le sélectionne —
   fais le tour de l'app. »** → `EntityPicker` v2 + `ReferenceSelect` + référentiels purs,
   appliqués aux 15 familles d'écrans identifiées par l'audit. Les statuts et les dates passent
   au français partout (`labelFor`, `fr-CA`).
2. **« Refonte du portail client (trop petit, pas d'information). »** → le portail quitte sa carte
   `max-w-3xl` pour une vraie application : coquille plein écran, tableau de bord avec KPI et
   carte, poste de travail Commandes, suivi d'expédition, factures avec PDF, documents, demandes
   de changement **persistées** et suivies côté staff.
3. **« Plus de connecteurs, l'app doit se connecter à tout. »** → les 26 événements métier
   alimentent enfin l'outbox webhook, avec formats Slack/Teams/X12 ; un récepteur webhook
   **entrant** écrit dans les services métier ; l'EDI X12 (204/990/210/214) existe de bout en
   bout ; les clés API partenaires gagnent expiration et modèles de portée ; la cour se publie en
   iCal ; un hub `/connect` réunit le tout.

Règles ajoutées : **53** (aide à la saisie), **54** (portail v2), **55** (connecteurs).

## A. Aide à la saisie (pickers partout)

### Socle

- `@pulsar/shared/reference` (pur, browser-safe) : `COUNTRIES` (11 pays ISO-3166-1 alpha-2,
  libellés FR), `REGIONS_BY_COUNTRY` + `regionsFor()` (13 provinces/territoires CA, 50 états US +
  DC), `CURRENCIES` (CAD/USD/EUR/MXN/GBP), `WMS_UNITS` (EA/KG/LB/L/M/PAL/BOX/CS).
- `EntityPicker` **v2** (`apps/web/src/lib/components/ui/EntityPicker.svelte`, rétro-compatible) :
  `labelKey` (plusieurs champs possibles : `'firstName lastName'`), `detailKey`, `valueKey`
  (permet une clé naturelle : `code`, `sku`), `pageSize`, `listShape: 'paginated' | 'array'`
  (les comptes GL renvoient un tableau nu), `selectedLabel` (pas d'appel `GET /:id`),
  `allowCreate` (bouton « Créer … », p. ex. un entrepôt via `LocationFormModal`), `allowFreeText`
  (chauffeur/remorque externes à la porte de cour). Clavier ↑/↓/Entrée/Échap, `role="listbox"` +
  `aria-activedescendant`, message de troncature conservé. Logique de libellé extraite pure
  (`entity-picker.ts`) et testée au Vitest.
- `ReferenceSelect` : `Select` alimenté par un référentiel, option vide « Sélectionner… »,
  `clearable`, et — décision de la revue A4 — **conservation d'une valeur stockée absente du
  catalogue** comme option supplémentaire, pour qu'aucun enregistrement existant ne soit effacé en
  silence.
- `STATUS_LABELS_FR` (`apps/web/src/lib/components/ui/status.ts`) : libellés FR de tous les enums
  TMS/WMS/Yard/Billing/Portail, consommés par `labelFor` (repli sur l'ancien comportement).
- `$lib/format` : `formatDate`/`formatDateTime` passent en locale **`fr-CA`** (correctif repris de
  la revue B3 — le portail rendait `9/16/2026`).

### Écrans convertis

Commandes de transport (client/origine/destination) · ressources d'un load (transporteur,
chauffeur, véhicule, remorque, tarif) · affectation shipment → load (picker `/transportation/loads`
filtré serveur, `status=OPEN,PLANNED` — l'API accepte désormais une liste séparée par virgules) ·
cour (site, remorque, transporteur, chauffeur, spots, rendez-vous) · WMS (entrepôt avec
`allowCreate`, articles, bins par `code`/`zone`, comptages) · comptes GL (grand livre, budgets,
modes de paiement, gabarits de taxe — `listShape: 'array'`, `valueKey: 'code'`) · factures
(transporteur / client à facturer) · CRM pipeline (entreprise) · lieux (pays/province en
`ReferenceSelect`, fuseau en `datalist` `Intl.supportedValuesOf`) · lanes et rate studio ·
fabrication (`productRef`/`materialRef` par `valueKey: 'sku'`) · devises et unités.
`grep "pageSize: 100" apps/web/src/routes` est passé de **62** à **57** occurrences (le reste est
listé en dette).

## B. Portail client v2

### API (toutes les projections scopées `(tenantId, customerId)`)

- `PortalShell` de données : `GET /portal/view` enrichi (commandes + `mode`, mesures, notes,
  `updatedAt` ; expéditions + fenêtres prévues, `actualPickupAt`, poids, palettes,
  `documentCount`, `hasPod`, `lastPosition`). `lastPosition` = **une** position, uniquement pour
  un shipment `DISPATCHED`/`IN_TRANSIT` (règle 20) ; jamais d'historique, jamais de `tenantId`,
  de `loadId` ni de `trackingToken`. Coût constant : 1 requête commandes + 1 lieux + 2 agrégats
  groupés (pas de N+1).
- `GET /portal/orders?status&search&page&pageSize` → `Paginated<T>`.
- `GET /portal/shipments/:id` → projection de suivi partagée avec le suivi public
  (`shipment-tracking.view.ts`, extraite de `public-links.service`) : origine/destination,
  fenêtres, réels, POD, ≤ 50 événements, `lastPosition`.
- Factures : `netAmount`/`taxAmount`/`amountPaid`/`approvedAt` ajoutés, montants renvoyés en
  **nombres** (les `Decimal` sortaient en chaînes) ; `GET /portal/invoices/:id/pdf`.
- **Demandes de changement persistées** : `PortalChangeRequest`
  (`kind DATE|ADDRESS|CANCEL|OTHER`, `status OPEN|ACKNOWLEDGED|RESOLVED|REJECTED`, enums mirroités
  règle 3, migration `20260917134920_portal_change_requests`). `POST /portal/change-requests`
  écrit la ligne **puis** émet l'événement. Côté staff :
  `GET /customer-portal/change-requests?status` + `acknowledge|resolve|reject`, permission
  existante `customer-portal.users.manage`, transitions par `canTransitionPortalChangeRequest`
  (règle 2), audit (règle 6).
- Les deux portes du portail (session `/portal/*` et lien `/public/portal/:token/*`) résolvent un
  `PortalContext` et appellent le même cœur `…For(ctx, …)` — elles ne peuvent plus diverger.

### Web

- `PortalShell` : coquille plein écran (barre haute avec marque/logo/menu compte, nav gauche,
  drawer mobile sous `lg`, `data-theme`, `--t-accent` surchargé par la marque du client — et non
  `--accent`, qui en dérive). Réutilisée telle quelle par le plan jeton, en mode dégradé
  (« Accès par lien sécurisé », pas de menu compte).
- **Tableau de bord** : tuiles `KpiTile` (commandes actives, en transit, livrées 30 j, factures à
  payer + montant par devise, demandes ouvertes), `PortalMap` (Leaflet, positions des expéditions
  en transit + origines/destinations, public-safe), dernières commandes, dernières factures.
- **Commandes** : `OrdersTable` (FilterBar + table paginée serveur) partagée par les deux plans,
  `OrderDrawer` (trajet, fenêtres, mesures, notes, expéditions), `ShipmentTrackingDrawer`
  (`TrackMap`, prévu vs réel, POD, documents, `TrackingTimeline`, fil de commentaires),
  `NewOrderModal` (le formulaire de création n'existe plus qu'une fois).
- **Factures** (totaux par statut et devise, bouton PDF), **Documents** (table plate agrégée,
  téléchargement), **Demandes** (historique + réponse du staff), **Modèles**, **Utilisateurs**,
  **Mon compte**.
- Côté staff : `/customer-portal/requests` (file des demandes), atteignable depuis le domaine
  « Portail client » et depuis la fiche client.

## C. Connecteurs

### Sortant

`DomainEventsService.emit` publie désormais aussi vers `WebhooksService.emit` (pont best-effort,
**après** persistance réussie de la ligne `DomainEvent`, jamais bloquant) : l'outbox couvre tout le
`DOMAIN_EVENT_CATALOG` et non plus 6 événements TMS. Les 4 émissions directes devenues doublons ont
été supprimées. Catalogue exposé par `GET /integrations/events`. Formats de livraison
`config.format` : `json` (enveloppe canonique), `slack` (mrkdwn échappé), `teams` (MessageCard),
`x12` (interchange brut, `text/plain`). `POST /integrations/:id/test` est un vrai ping signé pour
les clés `webhook*` ; `POST /integrations/:id/deliveries/:deliveryId/replay` rejoue une livraison
(claim conditionnel). Garde d'egress SSRF (`checkWebhookUrl`, `@pulsar/shared`) à l'écriture et au
test, avec échappatoire `WEBHOOK_ALLOW_PRIVATE_URLS=true` pour le dev/CI. Les intégrations
antérieures au pont sont épinglées aux 6 événements historiques au démarrage
(`WebhookEventsBackfillService`, idempotent — un boot hook plutôt qu'une migration SQL parce que
`Integration.config` est chiffré).

### Entrant (récepteur JSON)

`POST /public/hooks/:inboundToken` : le jeton de l'URL **est** la crédentiale (32 octets
base64url, seul le `sha256` est stocké, dans la colonne indexée `Integration.inboundTokenHash`).
HMAC optionnel (`X-Signature`, comparaison à temps constant sur `rawBody`), idempotence sur
`InboundMessage.dedupKey`, mapping par `applyIntegrationMapping` (`@pulsar/shared`, strict en
entrant, garde anti-pollution de prototype), cibles `transport-order.create | location.upsert |
customer.upsert | carrier.upsert | item.upsert` via le `createRecord` de l'import CSV, sous le
service-account du tenant scopé à la **seule** permission de la cible, module re-vérifié
(règles 13/15). Le seul contrôle humain est à la configuration : poser `config.target` ou émettre
le jeton exige la permission de la cible en plus de `core.integrations.manage`.

### EDI X12

`@pulsar/shared/edi` (pur, fixtures `.edi`, aucune dépendance npm) : tokenizer ISA/GS/ST, lecture
**204** → appel d'offres canonique, génération **990** (accept/decline), génération et lecture
**214** (carte AT7), lecture **210** → facture transporteur. Côté API (`core/connect/edi.service`) :
deux portes (`POST /connect/edi/inbound` authentifiée, `POST /public/hooks/:token` pour un
récepteur EDI), une seule clé d'idempotence (`edi:<sha256(interchange)>`), un 204 crée un
`TransportOrder` **DRAFT** (adresses upsertées en `Location CUSTOMER_SITE` sous le code
déterministe `EDI-<sha1>`), un 210 crée un `IncomingCarrierInvoice` (`FreightAuditService`, règles
16/31 préservées : aucune variance n'est calculée ici). `GET /transportation/shipments/:id/edi/214`
rend l'interchange, `POST …/214/send` le met dans l'outbox webhook (`format: 'x12'`). Ce que le
partenaire voit est toujours un refus **délibéré** (`EdiDeclineError`) ou un message générique —
jamais une exception interne.

### Accès partenaire & calendrier

Clés API : `expiresAt` optionnel (401 générique une fois expirée, indistinguable d'une clé
inconnue), modèles de portée `API_KEY_SCOPE_PRESETS` (`read-only` **calculé** depuis le catalogue,
`orders-intake`, `tracking`), schéma Swagger `x-api-key`. Cour : `POST /yard/ical-token` (audité,
URL construite depuis `API_URL`), `GET /yard/ical-token` → `{ hasToken, rotatedAt }` (jamais le
jeton — la confirmation de rotation survit à un rechargement), `GET /public/ical/yard/:token` →
`text/calendar` des 90 prochains jours, produit par `buildIcs` (`@pulsar/shared`, RFC 5545 : CRLF,
pliage 75 octets, échappement, dates UTC).

### Hub

`CONNECTION_CATALOG` (`@pulsar/shared`) : Webhooks sortants, Webhook entrant, EDI X12,
Slack/Teams (même adaptateur, `format` différent), iCal — tous `AVAILABLE` ; Twilio/M365/Meta
restent `PLANNED`. Écrans : `/integrations` (studio + sélecteur de format + liste blanche
d'événements), `/connect/inbound-hooks` (créer un récepteur, jeton affiché une fois, boîte de
réception), `/connect/edi` (partenaires, aperçu X12 **client-side** d'un 204 collé, envoi d'un 204,
consultation/envoi d'un 214).

## Décisions et arbitrages notables

- **Un seul moteur de mapping** : le dry run du studio et la livraison entrante partagent
  `applyIntegrationMapping` ; en entrant il est **strict** (transformation inconnue = erreur).
- **Le hash du jeton entrant quitte `config`** pour une colonne indexée : `Integration.config` est
  chiffré au repos, donc non interrogeable.
- **Le gate de configuration est le seul contrôle humain** du flux entrant (JSON comme EDI) : un
  récepteur armé délègue une écriture métier à une porte anonyme.
- **`202` même en échec métier** sur le récepteur : le partenaire a un contrat unique, la ligne
  d'inbox fait foi ; seuls jeton/signature/module produisent un code d'erreur.
- **EDI 204 → lieux `CUSTOMER_SITE`** sous un code déterministe dérivé de l'adresse : re-tendre la
  même voie réutilise la même fiche (arbitrage assumé : pas d'appariement d'adresses par
  partenaire en v1).
- **Portail : `ReferenceSelect` et non `EntityPicker`** pour origine/destination — `EntityPicker`
  parle le client tenant (`api()`, bearer staff, redirection `/login`), inexistant sur le plan
  portail ; les lieux du client voyagent déjà dans `view`.
- **Les deux drawers du portail ne cohabitent pas** : ouvrir le suivi efface le drawer commande et
  le restaure à la fermeture (sinon le panneau étroit se posait par-dessus le large).
- **Renforcements issus des revues** : pollution de prototype fermée dans le mapping (critique) ;
  jeton entrant caviardé dans les logs HTTP ; rejeu d'une ligne `RECEIVED` bloquée (claim
  conditionnel après 2 min) ; garde d'egress durci sur 5 tours (IPv4-mapped/translated, 6to4,
  ISATAP, point final, `localhost.localdomain`, 100.64/10) ; refus partenaire génériques en EDI ;
  doublon de facture 210 sur la clé métier ; audit et URL de configuration pour le jeton iCal.

## Tests ajoutés

- Vitest `@pulsar/shared` : référentiels, `entity-picker`, `status`, EDI (5 specs + 3 fixtures),
  `webhook-target`, `webhook-formats`, `mapping`, `ical`, `api-key-presets`, portail
  (`canTransitionPortalChangeRequest`).
- Jest unit API : `shipment-tracking.view`, `portal-change-requests.service`, `inbound-hooks`,
  `webhooks`, `webhook-events-backfill`, `integrations-config|replay|studio`, `edi.service`,
  `edi-identity`, `api-keys.service`, `yard/ical.service`.
- Jest e2e API : `portal-v2`, `inbound-hooks`, `integrations`, `edi`, `api-keys`, `yard-ical`.
- Playwright : `pickers.spec.ts` (nouveau), `connect.spec.ts` (nouveau),
  `customer-portal-requests.spec.ts`, `portal-accounts.spec.ts` (étendu).

## Preuves (gates mesurées le 2026-09-17, BD Docker seedée, HEAD `867564b`)

| Gate        | Commande                                                                                                                                         | Résultat                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck   | `pnpm typecheck`                                                                                                                                 | **0 erreur** (shared/database/api/web) ; 12 avertissements a11y web, baseline inchangée                                                                                                                                                                                                                                                              |
| Unit        | `pnpm test`                                                                                                                                      | **1374 tests / 170 suites** verts (shared 806/86, web 82/9, api 486/75)                                                                                                                                                                                                                                                                              |
| E2E complet | `pnpm test:e2e` (89 suites, `--runInBand`)                                                                                                       | **828 passés / 9 échoués / 1 ignoré** sur 838 ; 83 suites vertes, 1 ignorée, 5 en échec : **7 tests pour cause externe** (moteur APS Python absent — `aps-runtime`, `manufacturing-scheduling`, `manufacturing-agent-tools`), **1 régression** `phase3` (garde d'egress, voir Reprise), **1 fragilité de données** `access-module` (voir ci-dessous) |
| Playwright  | `pickers`, `portal-accounts`, `customer-portal-requests`, `connect`, `whats-new`, `access-roles`, `wms-workspace` (`--project=desktop-chromium`) | **38/38** verts (un premier passage a donné 37/38 : `connect.spec.ts:19` en échec puis vert en isolation — flake de charge sur le serveur de dev partagé)                                                                                                                                                                                            |
| Diff        | `git diff --check`                                                                                                                               | propre                                                                                                                                                                                                                                                                                                                                               |

`access-module.e2e-spec.ts` (cas 6) échoue sur l'**accumulation de données de test**, pas sur du
code de cet arc : la base locale porte **176** lieux `WAREHOUSE` alors que `GET /wms/sites`
retourne 100 lignes par défaut triées `code asc` — le `WH-<suffixe>` fraîchement créé tombe en
page 2. Le correctif appartient au test (filtrer par `search`), pas à l'API :
`apps/api/src/modules/wms` et `core/locations` sont inchangés depuis `a3aedc7`.

Classification complète des échecs :
`.superpowers/sdd/2026-09-17-pickers-portal-connectors/task-18-report.md`.

## Limites connues

- Le garde d'egress est une défense **au niveau de la chaîne** (pas de résolution DNS) : les
  préfixes NAT64 « local-use » plus courts que /96 et Teredo passent encore ; `attempt()` ne
  rejoue pas le garde. Correctif durable = `resolve-then-check` à la connexion.
- `transport-order.create` par récepteur entrant est **at-least-once** (ré-exécution d'une ligne
  `RECEIVED` après 2 minutes) — pas de clé métier idempotente en v1.
- EDI : une seule transaction par interchange entrant, `CANCELLATION`/`CHANGE` traités comme
  `ORIGINAL`, pas de fuseau horaire, numéros de contrôle sortants dérivés de l'horloge, pas
  d'AS2/VAN ni de 997.
- Hors périmètre v1 : SFTP/FTP, OAuth client (QuickBooks/Shopify), télématique, SCIM, file durable
  partagée, export vers un entrepôt de données.
- Dette complète (pickers / portail / webhooks / EDI / clés API-iCal) :
  [TODO.md](../../TODO.md) § « Pickers, portail v2 & connecteurs — dette 2026-09-17 ».

## Reprise

1. **Passe de correction** avant tout : la régression `phase3.e2e-spec.ts` (le garde d'egress
   refuse `http://127.0.0.1:9/unreachable` alors que la suite ne pose pas
   `WEBHOOK_ALLOW_PRIVATE_URLS=true`, contrairement à `integrations.e2e-spec.ts`) et les deux
   correctifs latents du portail (`downloadInvoicePdfFor` sans filtre `application/pdf`, panneaux
   paresseux qui réessaient indéfiniment).
2. Puis les items de la dette classés « sécurité » : `PATCH { status: 'ENABLED' }` qui rouvre un
   récepteur sans permission de cible, `compactConfig()` du studio qui perd `target`/
   `inboundSecret`.
3. Merger la branche (PR recommandé) — elle porte désormais trois arcs (Accès & Lieux cœur,
   comptes portail + Quoi de neuf, et celui-ci).
