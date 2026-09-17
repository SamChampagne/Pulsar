# Aide à la saisie + refonte du portail client + connecteurs — plan (arc 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) remplacer la saisie libre d'entités/vocabulaires par des sélecteurs partout ; (B) faire du portail client un vrai espace de travail riche ; (C) rendre Pulsar connectable : tous les événements vers les webhooks, récepteur entrant, EDI X12, API partenaires, iCal.

**Architecture:** A = `EntityPicker` v2 + référentiels purs + libellés FR, appliqués formulaire par formulaire. B = coquille portail plein écran + enrichissements de projection + `PortalChangeRequest` persisté + tracking par expédition réutilisant la projection publique. C = pont `DomainEvents → Webhooks` + formats Slack/Teams + récepteur `/public/hooks/:token` réutilisant le mapping et `createRecord` + EDI pur dans shared + Swagger/API keys + iCal.

**Tech Stack:** NestJS + Prisma, `@pulsar/shared` (Vitest), SvelteKit Svelte 5, Leaflet, Jest e2e, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-pickers-portal-connectors-design.md`

## Global Constraints
- Branche unique `access-module-core-locations` ; base a3aedc7 ; commits par tâche + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Règles 1 (tenant), 2 (state machines), 3 (enums miroir), 5 (permissions), 6/14 (audit), 9 (FK), 10/20 (projections publiques/portail), 13 (service-account), 15 (module re-check), 50-52 (arcs précédents) ; nouvelles 53-55 (spec §D).
- `@pulsar/shared` pur/browser-safe ; rebuild après modification. Pas de nouvelle dépendance npm sauf indication (aucune prévue : EDI, iCal, référentiels sont écrits à la main).
- UI FR, composants `$lib/components/ui`, `Field`, erreurs locales, `confirmAction`. Baselines : svelte-check 0 erreur / 12 warnings ; ne jamais lancer `pnpm format` sur tout le repo (drift préexistant) — formater seulement les fichiers touchés.
- Commandes : shared `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/shared test` ; API `pnpm --filter @pulsar/api typecheck|test -- <p>|test:e2e -- test/<f>` (BD Docker up, API :3100, admin `admin@pulsar.dev`/`admin123`/`acme`, plateforme `platform@pulsar.dev`/`admin123`) ; web `pnpm --filter @pulsar/web typecheck|test`, Playwright `pnpm --filter @pulsar/web exec playwright test e2e/<f>` (le serveur web dev tourne déjà sur 5173 ; ne pas tuer les processus node du dev server — utiliser `reuseExistingServer`).
- Migrations : `pnpm db:generate` puis `pnpm db:migrate --name <snake>` depuis la racine ; ne jamais lancer `prisma format` sur tout le schéma.

---

## Partie A — Aide à la saisie

### Task A1: `EntityPicker` v2 + `ReferenceSelect` + référentiels + libellés FR
**Files:** Modify `apps/web/src/lib/components/ui/EntityPicker.svelte` ; Create `apps/web/src/lib/components/ui/entity-picker.ts` (+ `.test.ts`), `apps/web/src/lib/components/ui/ReferenceSelect.svelte` ; Modify `ui/index.ts`, `ui/status.ts` (+ `status.test.ts`) ; Create `packages/shared/src/reference/{geo.ts,currencies.ts,units.ts,index.ts}` (+ `reference.spec.ts`) ; Modify `packages/shared/src/index.ts`.
**Interfaces:**
- `EntityPicker` props (tous optionnels sauf `endpoint`, `label`) : `labelKey='name'`, `detailKey?`, `valueKey='id'`, `pageSize=20`, `listShape:'paginated'|'array'='paginated'`, `selectedLabel?`, `filters?`, `allowCreate?: { label: string; onCreate: () => void }`, `allowFreeText?: boolean` (si vrai, un bouton « Utiliser “texte” » propose la saisie brute → `value` = texte, `onfreetext?(text)`), `disabled`, `value $bindable`. Résolution du libellé : `selectedLabel` sinon `GET endpoint/:value` si `listShape==='paginated'` et `valueKey==='id'`, sinon recherche dans la dernière liste. Clavier : ↑/↓/Entrée/Échap ; `role="listbox"`/`role="option"` + `aria-activedescendant`.
- `entity-picker.ts` : `formatItem(item, labelKey, detailKey): { label: string; detail?: string }`, `filterArray(items, query, keys)` ; tests.
- `ReferenceSelect` props : `options: { value: string; label: string }[]`, `value $bindable`, `placeholder='Sélectionner…'`, `disabled`, `aria-label`.
- Shared : `COUNTRIES: { code, name }[]` (CA, US, MX, FR, GB, DE, ES, IT, BE, NL, CH), `REGIONS_BY_COUNTRY: Record<string, { code, name }[]>` (CA provinces/territoires, US états), `CURRENCIES` (CAD, USD, EUR, MXN, GBP), `WMS_UNITS` (EA, KG, LB, L, M, PAL, BOX, CS) ; `regionsFor(country)`.
- `status.ts` : `STATUS_LABELS_FR: Record<string,string>` couvrant TransportOrderStatus, ShipmentStatus, LoadStatus, StopStatus, TenderStatus, Receipt/PickOrder, YardVisit/DockAppointment, CustomerInvoice/IncomingCarrierInvoice/Payment, PortalUserStatus, ReleaseNote*, PortalChangeRequestStatus ; `labelFor(status)` = FR sinon repli actuel ; `STATUS_TONE` + `IN_EXECUTION: 'info'`, `CLOSED: 'neutral'`, `ACKNOWLEDGED: 'info'`, `RESOLVED: 'ok'`, `REJECTED: 'danger'`.
- [ ] TDD Vitest (formatItem, filterArray, référentiels, labelFor FR) → impl → svelte-check → commit `feat(web,shared): EntityPicker v2, ReferenceSelect, reference data, French status labels`.

### Task A2: Pickers TMS (commandes, ressources du load, shipments→load, factures, CRM pipeline)
**Files:** `routes/(app)/transport-orders/+page.svelte`, `lib/components/loads/LoadResourcesPanel.svelte`, `routes/(app)/shipments/+page.svelte`, `routes/(app)/invoices/+page.svelte`, `routes/(app)/crm/pipeline/+page.svelte`.
- Remplacer chaque `<Select>` chargé en `pageSize:100` par `EntityPicker` (endpoints : `/transportation/customers`, `/locations`, `/transportation/carriers`, `/transportation/drivers` (`labelKey:'lastName'`, `detailKey:'firstName'` — ou `selectedLabel` composé), `/transportation/vehicles` (`labelKey:'unitNumber'`), `/transportation/trailers` (`unitNumber`), `/transportation/rates` (`labelKey` = champ le plus lisible, lire le service), `/transportation/loads` avec `filters={{ status:'OPEN' }}`, `/crm/companies`). Vérifier que chaque endpoint expose `GET /:id` ; sinon passer `selectedLabel`. Libellés FR dans `LoadResourcesPanel`.
- [ ] svelte-check, Vitest, smoke Playwright jetable (créer une commande via pickers), commit `feat(web): entity pickers on transport orders, load resources, shipments, invoices, CRM pipeline`.

### Task A3: Pickers Cour + WMS
**Files:** `routes/(app)/yard/{gate,appointments,spots}/+page.svelte`, `lib/components/yard/YardArrival.svelte`, `routes/(app)/wms/{receiving,picking,bins,inventory,cycle-counts}/+page.svelte`, `lib/components/wms/{StockMoveForm,WarehouseLineEditor}.svelte`.
- Cour : Site → `/locations` `filters={{type:'WAREHOUSE'}}` ; Remorque → `/transportation/trailers` ; Transporteur → `/transportation/carriers` ; Chauffeur/Remorque de `YardArrival` et porte → pickers avec `allowFreeText` (chauffeur externe).
- WMS : Entrepôt → `/wms/sites` avec `allowCreate` ouvrant `LocationFormModal` WAREHOUSE (réutiliser le motif de `wms/+page.svelte`) ; Article → `/wms/choices/items` (`labelKey:'name'`, `detailKey:'sku'`) ; bins → `/wms/sites/:siteId/bins` (`labelKey:'code'`, `detailKey:'zone'`, `pageSize` 50) ; corriger `StockMoveForm`/`WarehouseLineEditor` (libellés vides) sans toucher au protocole d'idempotence (`operationKey`, `expectedUpdatedAt`, état `uncertain`).
- [ ] svelte-check, Playwright `wms-workspace`/`wms-guided-operations`/`yard-workspace` verts, commit `feat(web): entity pickers across yard and WMS forms`.

### Task A4: Comptes GL, lieux, lanes/rate studio, fabrication, divers
**Files:** `routes/(app)/billing/{ledger,budgets}/+page.svelte`, `lib/components/billing/{ModesOfPayment,TaxTemplates}.svelte`, `lib/components/locations/LocationFormModal.svelte`, `routes/(app)/{lanes,rate-studio}/+page.svelte`, `routes/(app)/manufacturing/{boms,orders,routings}/+page.svelte`, `routes/(app)/rates/+page.svelte`, `lib/components/fleet/FleetOrderDrawer.svelte`, `routes/(app)/wms/items/+page.svelte`, `routes/(app)/customers/+page.svelte`, `routes/(app)/settings/sso/+page.svelte`, `routes/(app)/crm/inbox/+page.svelte`, `routes/(app)/carriers/+page.svelte`.
- Comptes GL → `EntityPicker` `/billing/ledger/accounts` (`listShape:'array'`, `valueKey:'code'`, `labelKey:'code'`, `detailKey:'name'`).
- Lieux : Pays/Province → `ReferenceSelect` (province dépend du pays) ; Fuseau → `<datalist>` Intl. Lanes/Rate Studio : idem + Ville `<datalist>` des villes des lieux du tenant.
- Fabrication : `productRef`/`materialRef` → `EntityPicker` `/wms/choices/items` `valueKey:'sku'`.
- Devise → `ReferenceSelect(CURRENCIES)` ; unité WMS → `ReferenceSelect(WMS_UNITS)` ; `type="email"`/`type="url"`, `pattern` SCAC.
- [ ] svelte-check, Vitest, smoke, commit `feat(web): GL account picker, reference selects for geo/currency/units, item pickers in manufacturing`.

### Task A5: Playwright pickers + revue de couverture
**Files:** Create `apps/web/e2e/pickers.spec.ts`.
- 3 tests mockés : (1) commande de transport : ouvrir le picker Client, taper, ↑/↓/Entrée, valeur choisie ; (2) WMS réception : picker Entrepôt affiche « Créer un entrepôt » avec `core.locations.manage` ; (3) `/locations` : Pays CA → Province propose QC/ON.
- `grep -rn "pageSize: 100" apps/web/src/routes | wc -l` avant/après dans le rapport (les listes restantes justifiées une par une).
- [ ] commit `test(web): playwright coverage for entity pickers`.

## Partie B — Portail client v2

### Task B1: Shared + Prisma : `PortalChangeRequest`, enum `InboundSource` EDI, machine à états
**Files:** `packages/shared/src/portal/portal.ts` (+ spec) : `PortalChangeRequestStatus { OPEN, ACKNOWLEDGED, RESOLVED, REJECTED }`, `canTransitionPortalChangeRequest(from, to)` (OPEN→ACKNOWLEDGED|RESOLVED|REJECTED ; ACKNOWLEDGED→RESOLVED|REJECTED) ; `PortalChangeRequestKind { DATE, ADDRESS, CANCEL, OTHER }` ; `packages/shared/src/connect/connect.ts` : `InboundSource` + `'EDI'` ; `schema.prisma` : `model PortalChangeRequest { id, tenantId, customerId, portalUserId?, orderId?, shipmentId?, kind, note, status @default(OPEN), staffResponse?, createdAt, updatedAt, resolvedAt? ; @@index([tenantId, customerId, status]) ; FK tenant, customer (Cascade), portalUser (SetNull) }` + enums miroir ; si `InboundMessage.source` est un enum Prisma, ajouter `EDI`. Migration `portal_change_requests`.
- [ ] Vitest, generate, migrate, builds, api typecheck, commit `feat(shared,db): portal change requests model and state machine`.

### Task B2: API portail — projections enrichies, orders paginés, shipment detail, invoices + PDF, change requests
**Files:** `portal.service.ts`, `portal-session.controller.ts`, `portal.controller.ts` (routes jeton : `GET :token/orders`, `:token/shipments/:id`, `:token/invoices/:id/pdf`, `:token/change-requests` ajoutées pour parité), Create `portal-change-requests.service.ts` (+ spec), `portal-change-requests.admin.controller.ts` ; `dto/portal.dto.ts`.
- `getPortalViewFor` : sélections enrichies (spec §B2.2) + `lastPosition` pour IN_TRANSIT/DISPATCHED (réutiliser la logique de `public-links.service` — extraire une fonction partagée `lastPositionForShipment(tx, shipmentId)` si nécessaire ; jamais d'historique) ; montants en `Number(...)`.
- `listOrdersFor(ctx, { status?, search?, page, pageSize })` → `Paginated`.
- `getShipmentTrackingFor(ctx, shipmentId)` : `customerShipment` puis projection identique à `GET /public/tracking/:token` (extraire la projection dans une fonction réutilisée par les deux).
- `listInvoicesFor` : + `id, amountPaid, taxAmount, netAmount, approvedAt` (nombres) ; `downloadInvoicePdfFor(ctx, id)` : `Document` `entityType 'customer-invoice'`, `entityId = invoice.id`, ownership `customerId`.
- Change requests : `create` (ligne puis événement `portal.change-request` avec `changeRequestId`), `listFor(ctx)`, staff `list(tenantId, status?)`, `acknowledge|resolve|reject(tenantId, id, actorUserId, response?)` avec `canTransition…` + claim `updateMany` conditionnel + audit ; routes staff `@RequireModule(CUSTOMER_PORTAL)` + `USERS_MANAGE`.
- [ ] Unit spec (transitions, projection sans PK/coûts), typecheck, e2e phase4/phase5/portal-accounts verts, commit `feat(portal): richer projections, paginated orders, shipment tracking, invoice pdf, persisted change requests`.

### Task B3: Web portail — coquille plein écran + tableau de bord + `PortalMap`
**Files:** `routes/portal/(app)/+layout.svelte`, Create `lib/portal/components/{PortalShell,PortalMap,KpiTile}.svelte`, `routes/portal/(app)/dashboard/+page.svelte` (home ; `/portal/orders` reste), `routes/portal/[token]/+page.svelte` (même coquille, mode dégradé), `lib/portal/types.ts`.
- Coquille : barre haute (logo `branding.logoUrl` ou nom expéditeur, entreprise cliente, menu utilisateur), nav gauche (Tableau de bord `/portal/dashboard`, Commandes, Factures, Documents, Demandes, Modèles, Utilisateurs si ADMIN), `Drawer` mobile ; `--t-accent` = `branding.accentColor` (corriger `PublicShell`-style `--accent`) ; `data-theme="warm"`.
- Tableau de bord : tuiles (motif `dashboard/+page.svelte:375-396`), `PortalMap` (Leaflet dynamique comme `OpsMap`, marqueurs origine/destination/position pour les expéditions en transit du `view`, fit bounds, public-safe), dernières commandes (5), factures à payer (5).
- [ ] svelte-check, Playwright `portal-accounts` toujours vert, capture d'écran, commit `feat(web): full-width customer portal shell and dashboard with live map`.

### Task B4: Web portail — Commandes (filtre/pagination/détail/nouvelle demande), Suivi d'expédition
**Files:** `routes/portal/(app)/orders/+page.svelte`, Create `lib/portal/components/{OrdersTable,OrderDrawer,ShipmentTrackingDrawer,NewOrderModal}.svelte` ; réutiliser `TrackMap`, `TrackingTimeline`, `CommentsThread` (le rendre indépendant du `<tr>`), `TemplatesPanel`.
- Commandes : `FilterBar` (statut `ReferenceSelect` sur `TransportOrderStatus` FR, recherche, période) + `Table` paginée (`GET /orders`), clic → `OrderDrawer` (fenêtres, mesures, notes, expéditions avec statut FR et bouton « Suivre » → `ShipmentTrackingDrawer`) ; « Nouvelle demande de transport » → `NewOrderModal` (formulaire actuel, `EntityPicker` sur les lieux du client via `view.locations` en `listShape:'array'`).
- Suivi : `GET /shipments/:id` → statut, `TrackMap`, `TrackingTimeline`, prévu vs réel, POD + documents, commentaires.
- [ ] svelte-check, Playwright (mock) : liste + drawer + tracking drawer rendus, commit `feat(web): portal orders workspace with detail and shipment tracking drawers`.

### Task B5: Web portail — Factures, Documents, Demandes, Modèles, Mon compte + staff `/customer-portal/requests`
**Files:** `routes/portal/(app)/{invoices,documents,requests,templates,account}/+page.svelte`, composants correspondants ; staff `routes/(app)/customer-portal/requests/+page.svelte` + nav domaine « Portail client » (lien « Demandes »).
- Factures : tableau + totaux par statut/devise (nombres), PDF via `client.download('/invoices/:id/pdf')`. Documents : liste plate (agrège les documents des expéditions du `view`, tri). Demandes : historique (`GET /change-requests`) + formulaire. Modèles : CRUD existant. Mon compte : infos + « Réinitialiser mon mot de passe » (forgot flow).
- Staff : liste des demandes (statut, client, ordre, note), actions Accuser réception / Résoudre (réponse) / Rejeter via `confirmAction`.
- [ ] svelte-check, Playwright portal + nav test, commit `feat(web): portal invoices, documents, requests, templates, account; staff change-requests page`.

### Task B6: e2e + Playwright portail v2
**Files:** Modify `apps/api/test/portal-accounts.e2e-spec.ts` (ou nouveau `portal-v2.e2e-spec.ts`) : orders paginés (filtre statut), shipment detail (200 pour A, 404 pour B), invoice pdf (404 si aucun document ; 200 si l'e2e en crée un via l'API billing existante), change request : créer → liste portail → staff acknowledge → resolve avec réponse → portail voit `RESOLVED` + réponse → transition invalide 400. `apps/web/e2e/portal-accounts.spec.ts` étendu : dashboard rend 5 tuiles, carte présente.
- [ ] 2 runs verts, commit `test(portal): e2e and playwright for portal v2`.

## Partie C — Connecteurs

### Task C1: Pont événements → webhooks + formats Slack/Teams + catalogue + test réel + replay
**Files:** `core/operating/domain-events.service.ts` (appel best-effort `webhooks.emit(tenantId, type, payload)` après persistance de l'événement — jamais bloquant), `core/integrations/webhooks.service.ts` (`format` → `formatPayload(event, data, format)` pur dans `packages/shared/src/integrations/webhook-formats.ts` + spec : `json` (actuel), `slack` `{ text, blocks? }`, `teams` (MessageCard minimal), `x12` (corps texte brut, `Content-Type: text/plain`)), `integrations.service.ts` (`test` réel pour `key startsWith 'webhook'` : POST signé `{ event: 'ping' }` avec timeout 5 s → rapport), `integrations.controller.ts` (`GET /integrations/events` catalogue depuis `DOMAIN_EVENT_TYPES` + descriptions FR + exemple ; `POST /integrations/:id/deliveries/:deliveryId/replay`), `packages/shared/src/operating/policies.ts` (descriptions + exemples si absents → nouveau `DOMAIN_EVENT_CATALOG`).
- [ ] Vitest formats, unit webhooks (format appliqué, replay réinitialise attempts), e2e `integrations.e2e-spec.ts` (nouveau) : créer une intégration webhook vers un serveur HTTP local lancé dans le test (node `http`), déclencher un événement (ex. créer une commande portail → `portal.change-request`, ou `PATCH` un lieu ? choisir un événement émis facilement : `connect.import-batch.completed` via un import CSV) → delivery reçue signée ; replay → 2e réception. Commit `feat(integrations): domain events feed webhooks; slack/teams formats; event catalog; real test and replay`.

### Task C2: Récepteur webhook entrant + mapping réel
**Files:** Create `core/connect/inbound-hooks.service.ts` (+ spec), `core/connect/inbound-hooks.controller.ts` (`@Public() @UseGuards(ThrottlerGuard) @Controller('public/hooks')` : `POST :inboundToken`), staff `core/integrations/inbound-hooks.admin.controller.ts` (`POST /integrations/:id/inbound-token` génère et renvoie le jeton UNE fois, stocke `sha256` dans `config.inboundTokenHash`, `config.inboundSecret` optionnel, `config.target`, `config.mappings`), `core/integrations/mapping.ts` (promotion de `buildDryRunMapping` → `applyMapping(payload, mappings)` pur, déplacé dans `packages/shared/src/integrations/mapping.ts` + spec avec transformations `trim|uppercase|number|date.iso|default:<v>|concat:<sep>`), `imports.service.ts` (`createRecord` exporté/réutilisable par cible avec service-account + permission).
- Flux : résoudre `Integration` par hash du jeton (index sur `config` impossible → table ? Ruling : ajouter colonne `inboundTokenHash String? @unique` sur `Integration` — migration `integration_inbound_token`) ; module + statut ENABLED ; HMAC si `inboundSecret` ; idempotence (`X-Idempotency-Key` ou sha256 du corps, `InboundMessage.dedupKey` — vérifier le modèle, ajouter la colonne si absente dans la même migration) ; `InboundMessage{source:'WEBHOOK', status}` ; `applyMapping` → `createRecord(target)` ; réponse 202 `{ inboxId, status: 'IMPORTED'|'FAILED', error? }`.
- [ ] Unit + e2e (`inbound-hooks.e2e-spec.ts` : token → POST JSON → transport order créé ; mauvais HMAC → 401 ; rejeu même clé → 200 idempotent sans doublon), commit `feat(connect): inbound webhook receiver with mapping to business services`.

### Task C3: EDI X12 pur (`@pulsar/shared/edi`)
**Files:** Create `packages/shared/src/edi/{x12.ts, x12-204.ts, x12-990.ts, x12-214.ts, x12-210.ts, index.ts}` + specs + fixtures (`packages/shared/src/edi/__fixtures__/*.edi`).
- `parseX12(text): { interchange: ISA, groups: GS[], transactions: { st, segments: Segment[] }[] }` (détection des séparateurs depuis ISA, tolérant CRLF) ; `serializeX12(...)`.
- `read204(tx): CanonicalLoadTender { shipmentId (B2-04), purpose (B2-06), references (L11), equipment (N7), stops[{ type (S5-02 CL/CU), sequence, name, address, city, state, postal, country, dates (G62), weight/qty (AT8) }], notes }` ; `build990(tender, { accept: boolean, reason? }, envelope)` ; `build214(shipment: { number, status, events[{ code, at, city?, state? }] }, envelope)` avec codes AT7 (AF/X3/X1/D1/AG…) ; `read210(tx): { invoiceNumber, carrierScac, date, total, lines[{ description, amount, qty?, unit? }] , references }`.
- [ ] Vitest sur fixtures (204 réaliste, 210, round-trip 990/214 → parseX12), commit `feat(shared): pure EDI X12 parser and 204/990/214/210 mappers`.

### Task C4: API EDI (204 → commande + 990, 210 → facture transporteur, 214 sortant)
**Files:** Create `core/connect/edi.service.ts` (+ spec), `core/connect/edi.controller.ts` (`POST /connect/edi/inbound` texte X12, header `X-Integration-Key` ou body `{ integrationKey, content }` ; perm `core.connect.manage` ou via récepteur entrant C2 avec `config.format:'x12'`), `transportation/shipments` (`GET /transportation/shipments/:id/edi/214` perm `TRANSPORTATION.TRACKING_READ`), `Integration` clé `edi-<partner>` config `{ isaSenderId, isaReceiverId, gsSenderId, gsReceiverId, url? }`.
- 204 → `TransportOrdersService.create` (DRAFT, lieux résolus/créés par adresse : `LocationsService` upsert par `code` = `EDI-<hash adresse>` type CUSTOMER_SITE — ruling ; customer = celui de l'intégration `config.customerId` obligatoire) + `InboundMessage{source:'EDI'}` + 990 accept dans la réponse et journalisé ; erreur de mapping → 990 decline + `FAILED`. 210 → `FreightAuditService.create` (carrier par SCAC `config.carrierId` sinon 400). 214 : depuis les événements de suivi du shipment. Si `Integration.config.url` → livraison via outbox format `x12`.
- [ ] Unit + e2e `edi.e2e-spec.ts` (fixtures partagées : POST 204 → commande DRAFT + 990 ; GET 214 → texte X12 parsable ; POST 210 → facture entrante), commit `feat(connect): EDI X12 inbound 204/210 and outbound 990/214`.

### Task C5: API partenaires (Swagger X-Api-Key, expiration, presets de portée) + iCal
**Files:** `apps/api/src/main.ts` (`addApiKey({ type:'apiKey', name:'x-api-key', in:'header' }, 'api-key')`), `core/api-keys/*` (`expiresAt?` — colonne `ApiKey.expiresAt DateTime?` dans la migration de C2 ; refus si expiré dans `validate`), `packages/shared/src/api-key-presets.ts` (`API_KEY_SCOPE_PRESETS: read-only (toutes .read), orders-intake (transportation.orders.manage + master-data.read + core.locations.read), tracking (transportation.tracking.read)` + spec) ; web `settings/api-keys` : presets + date d'expiration. iCal : `packages/shared/src/ical.ts` (`buildIcs(events[{ uid, start, end, summary, location?, description? }])` pur + spec), `modules/yard/public-ical.controller.ts` (`@Public() GET /public/ical/yard/:token` → rendez-vous de quai des 90 prochains jours ; jeton dans `TenantModule.settings` yard `icalToken` généré via `POST /yard/ical-token` perm `yard.manage`).
- [ ] Vitest, unit, e2e (`GET /api/docs-json` contient le scheme ; clé expirée → 401 ; iCal 200 `text/calendar`), commit `feat(api): partner API key presets and expiry, swagger api-key scheme, yard iCal feed`.

### Task C6: Hub Connexions + Studio + écran récepteurs entrants
**Files:** `packages/shared/src/integrations/connections.ts` (catalogue : webhooks sortants ✓, webhook entrant ✓ `/connect/inbound-hooks`, EDI X12 ✓ `/connect/edi`, Slack/Teams ✓ (format), iCal ✓ `/yard/config`), `routes/(app)/connect/+page.svelte`, `routes/(app)/integrations/+page.svelte` (retirer « bientôt » là où réel ; sélecteur `format` ; liste des événements depuis `GET /integrations/events` avec cases), Create `routes/(app)/connect/inbound-hooks/+page.svelte` (créer un récepteur : cible, mappings, secret ; jeton affiché une fois ; boîte de réception filtrée `source=WEBHOOK|EDI`), `routes/(app)/connect/edi/+page.svelte` (partenaires EDI : ISA/GS ids, client, transporteur, test avec une fixture 204 collée → aperçu canonique via `POST /connect/edi/preview` (ajouter en C4 : parse sans écrire)).
- [ ] svelte-check, Playwright `connect` (mock) 2 tests, commit `feat(web): connections hub with inbound hooks, EDI partners and event catalog`.

### Task C7: Docs, règles 53-55, gates complets
**Files:** `CLAUDE.md`, `docs/etat-du-projet.md`, `TODO.md` (dette spec §C2.7 + mineures du registre), `docs/collaboration.md` (webhooks : catalogue, formats, récepteur, EDI), `docs/plans/pickers-portal-connectors.md`.
- Gates : `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` complet, Playwright `pickers`, `portal-accounts`, `connect`, `whats-new`, `access-roles`, `wms-workspace`, `git diff --check`.
- [ ] commit `docs: pickers, portal v2, connectors — rules 53-55, status and debt`.

## Ordre
A1 → A2 ∥ A3 ∥ A4 (fichiers disjoints ; un implémenteur à la fois par défaut, parallèle autorisé si aucun fichier commun) → A5. B1 → B2 → B3 → B4 → B5 → B6. C1 → C2 → C3 → C4 → C5 → C6. C7 en dernier. B et C peuvent s'entrelacer avec A (fichiers disjoints), mais jamais deux tâches touchant `schema.prisma` en même temps (B1, C2/C5 migration).
