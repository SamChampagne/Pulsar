# Aide à la saisie + refonte du portail client + connecteurs — design (arc 3)

Date : 2026-09-17 · Branche : `access-module-core-locations` (même branche, demande de Sam) · Base : a3aedc7.
Demandes : « refonte du portail client (trop petit, pas d'information) », « plus de connecteurs, l'app
doit se connecter à tout », « plus d'aide pour remplir les champs : on ne tape pas un nom d'entrepôt,
on le sélectionne — fais le tour de l'app ».

## A. Aide à la saisie (pickers partout)

### A1. Constats (audit du 2026-09-17)
- Un seul composant de recherche : `EntityPicker` (modal + recherche, `pageSize` 20 figé, exige un
  champ `name`, exige `GET /:id`, pas de navigation clavier ↑/↓/Entrée). Les endpoints bins,
  drivers, vehicles/trailers, comptes GL n'ont pas de `name` → libellés vides (bug visible en WMS).
- ~60 `<Select>` chargés en `pageSize: 100` sans avertissement de troncature (commandes de transport,
  ressources du load, cour, WMS, factures, achats, tarifs…).
- Texte libre pour des codes internes : comptes GL (4 écrans), SKU/`materialRef` en fabrication,
  chauffeur/remorque à la porte de cour, pays/province/fuseau des lieux, ville/province/pays des
  lanes et du rate studio, devise, unités WMS.

### A2. Décisions
1. **`EntityPicker` v2** (même fichier, rétro-compatible) : props `labelKey` (défaut `name`),
   `detailKey?` (ex. `code`, `zone`, `city`), `valueKey` (défaut `id` — permet `sku`), `pageSize`
   (défaut 20), `listShape: 'paginated' | 'array'` (comptes GL renvoient un tableau nu → filtrage
   client), `selectedLabel?` (affichage sans appel `GET /:id`), `allowCreate?: { label, onCreate }`
   (bouton « Créer … » dans le modal, ex. entrepôt via `LocationFormModal`). Clavier : ↑/↓ déplacent
   la sélection, Entrée sélectionne, Échap ferme ; sémantique `role="listbox"`/`option` +
   `aria-activedescendant`, en conservant `aria-haspopup="dialog"`, `aria-busy`, `role="status"`.
   Message de troncature conservé. Vitest sur la logique de libellé (`formatItem`) extraite dans
   `apps/web/src/lib/components/ui/entity-picker.ts` (pur).
2. **Référentiels statiques purs** dans `@pulsar/shared/reference/` : `COUNTRIES` (CA, US, MX, FR, …
   ISO-3166-1 alpha-2 + libellés FR), `REGIONS_BY_COUNTRY` (provinces CA + états US, ISO-3166-2),
   `CURRENCIES` (CAD, USD, EUR, MXN, GBP), `WMS_UNITS` (EA, KG, LB, L, M, PAL, BOX, CS). Fuseaux via
   `Intl.supportedValuesOf('timeZone')` côté web (pas de données dupliquées). Composant web
   `ReferenceSelect` (Select alimenté par un référentiel, avec option vide « Sélectionner… »).
3. **Libellés FR des statuts** : `STATUS_LABELS_FR` dans `apps/web/src/lib/components/ui/status.ts`
   (tous les enums TMS/WMS/Yard/Billing/Portail), `labelFor` l'utilise avec repli sur l'actuel ;
   tons ajoutés pour `IN_EXECUTION`, `CLOSED`. Impact app-wide voulu (UI 100 % FR).
4. **Application, par priorité** (top 15 de l'audit, tous traités) :
   - Commandes de transport : Client, Origine, Destination → pickers (`/transportation/customers`,
     `/locations`).
   - Ressources du load (`LoadResourcesPanel`) : Transporteur, Chauffeur, Véhicule, Remorque, Tarif →
     pickers (`labelKey` `name`/`unitNumber`, chauffeur = `firstName lastName` via `detailKey`) +
     libellés FR.
   - Affectation shipment → load : picker `/transportation/loads` filtré serveur (`status=OPEN`).
   - Cour : porte, rendez-vous, spots → Site (`/locations?type=WAREHOUSE`), Remorque, Transporteur ;
     `YardArrival` et porte : Chauffeur et Remorque → pickers avec repli texte conservé
     (`allowFreeText`), le champ libre reste disponible pour un chauffeur externe.
   - WMS : réception, préparation, emplacements → Entrepôt picker (`/wms/sites`, avec `allowCreate`
     → `LocationFormModal` WAREHOUSE) ; inventaire → Article picker (`/wms/choices/items`) + bins
     (`/wms/sites/:id/bins`, `labelKey: 'code'`, `detailKey: 'zone'`) ; comptages → bin picker ;
     `StockMoveForm`/`WarehouseLineEditor` → libellés corrigés.
   - Comptes GL (ledger, budgets, modes de paiement, gabarits de taxe) → picker
     `/billing/ledger/accounts` (`listShape: 'array'`, `valueKey: 'code'`, `detailKey: 'name'`).
   - Factures : Transporteur / Client à facturer → pickers.
   - CRM pipeline : Entreprise → picker `/crm/companies` (remplace Select + champ « Rechercher »).
   - Lieux (`LocationFormModal`) : Pays et Province → `ReferenceSelect`, Fuseau → `<datalist>` Intl.
   - Lanes et Rate Studio : Pays/Province → `ReferenceSelect` ; Ville → `<datalist>` alimenté par les
     villes des lieux du tenant (`GET /locations?pageSize=100` distinct côté client).
   - Fabrication : `productRef`/`materialRef` → picker `/wms/choices/items` avec `valueKey: 'sku'`.
   - Divers : devise → `ReferenceSelect` (rates, fleet, freight-audit), unité WMS → `ReferenceSelect`,
     `type="email"`/`type="url"` là où l'audit les signale manquants.
5. Règle générale (hard rule 53) : un champ qui référence une entité ou un vocabulaire fermé utilise
   `EntityPicker`/`ReferenceSelect`, jamais `Input` libre ni `<Select pageSize:100>`.

## B. Refonte du portail client

### B1. Constats
Le portail (jeton et session) tient dans une carte `max-w-3xl` centrée verticalement : 4 onglets,
commandes en liste plate, aucun KPI, aucune carte, factures sans PDF, demandes de changement non
persistées, statuts en anglais. Pourtant l'API expose déjà la carte de suivi (`/public/tracking/:token`),
les POD, les documents et le PDF des factures.

### B2. Décisions
1. **Coquille plein écran** propre au portail (`routes/portal/(app)/+layout.svelte`, sans
   `PublicShell`) : barre haute (logo/branding, expéditeur, nom de l'entreprise cliente, menu
   utilisateur), navigation gauche (Tableau de bord, Commandes, Factures, Documents, Demandes,
   Modèles, Utilisateurs si ADMIN), contenu `p-6`, `data-theme` appliqué, `--t-accent` surchargé par
   la marque (correction : surcharger `--t-accent`, pas `--accent`). Le portail jeton `/portal/[token]`
   réutilise la même coquille (mode dégradé : pas de menu utilisateur).
2. **Backend (petits enrichissements, tous scopés `(tenantId, customerId)`)** :
   - `view` : ordres + `mode, totalWeightKg, totalVolumeM3, palletCount, notes, updatedAt` ; shipments
     + `plannedPickupEarly/Late, plannedDeliveryEarly/Late, actualPickupAt, weightKg, palletCount,
     documentCount, hasPod` et, pour les shipments IN_TRANSIT/DISPATCHED, `lastPosition {lat,lng,at}`
     (même règle que le suivi public : une seule position, jamais d'historique).
   - `GET /portal/orders?status&search&page&pageSize` paginé (`Paginated`) — le `view` garde 50 pour
     le tableau de bord.
   - `GET /portal/shipments/:id` : projection de suivi réutilisant `public-links.service` (origine/
     destination coordonnées, fenêtres, actuals, POD, événements ≤ 50, `lastPosition`), ownership via
     `customerShipment`.
   - Factures : `id, amountPaid, taxAmount, netAmount, approvedAt` ajoutés ; `GET /portal/invoices/:id/pdf`
     (document `customer-invoice`, ownership).
   - **Demandes de changement persistées** : modèle `PortalChangeRequest { tenantId, customerId,
     portalUserId?, orderId?, shipmentId?, kind, note, status OPEN|ACKNOWLEDGED|RESOLVED|REJECTED,
     staffResponse?, createdAt, resolvedAt }` (enum miroir règle 3) ; `POST /portal/change-requests`
     écrit la ligne PUIS émet l'événement existant ; `GET /portal/change-requests` ; côté staff
     `GET /customer-portal/change-requests?status`, `POST …/:id/acknowledge|resolve|reject { response? }`
     (perm `customer-portal.users.manage` réutilisée — pas de nouvelle clé), transitions via
     `canTransitionPortalChangeRequest` (`@pulsar/shared`, règle 2), audit.
   - Correction du `Decimal` sérialisé en chaîne : les montants sont renvoyés en nombre (projection).
3. **Web portail** :
   - **Tableau de bord** : tuiles (commandes actives, expéditions en transit, livrées 30 j, factures
     à payer + montant par devise, demandes ouvertes), carte `PortalMap` (positions des expéditions en
     transit + origines/destinations, Leaflet, public-safe), dernières commandes, dernières factures.
   - **Commandes** : `FilterBar` (statut, recherche, période) + `Table` paginée ; `Drawer` de détail
     par commande (fenêtres, mesures, notes, expéditions) ; « Nouvelle demande de transport » en
     `Modal` (formulaire actuel + `EntityPicker` sur les lieux du client + modèles).
   - **Suivi d'expédition** : `Drawer` large : statut FR, `TrackMap`, `TrackingTimeline`, prévu vs réel,
     POD (signataire, date, documents téléchargeables), fil de commentaires.
   - **Factures** : tableau (numéro, statut, émise, échéance/envoyée, montant, payé, solde), totaux par
     statut et devise, bouton PDF.
   - **Documents** : liste plate triable (expédition, type, nom, date) + téléchargement.
   - **Demandes** : historique avec statut et réponse du staff + formulaire.
   - **Modèles**, **Utilisateurs** (existant), **Mon compte** (changer mot de passe via forgot flow).
   - Responsive (menu en `Drawer` sous `lg`).
4. **Côté staff** : page `/customer-portal/requests` (liste des demandes, actions), lien dans le
   domaine « Portail client ».

## C. Connecteurs

### C1. Constats
Sortant : outbox webhooks robuste mais alimentée par 6 événements TMS seulement ; les 26 événements
métier (`DomainEventsService`) n'y arrivent jamais. Entrant : aucun récepteur webhook ; import CSV
6 entités ; PDF facture transporteur ; IMAP. Studio `/integrations` = assistant de configuration sans
adaptateur (« test de connexion » simulé). Foundation connecteurs = types purs inutilisés. Pas d'EDI,
pas de SFTP, pas d'OAuth client, pas de file durable générique.

### C2. Décisions (v1 = tout testable hors ligne)
1. **Événements → webhooks** : `DomainEventsService.emit` publie aussi vers `WebhooksService.emit`
   (best-effort, jamais bloquant) ; catalogue `GET /integrations/events` (types + description + exemple
   de payload) ; filtre `events[]` par intégration conservé ; **formats** de livraison
   `config.format: 'json' | 'slack' | 'teams'` (payload texte prêt pour un « incoming webhook »
   Slack/Teams) ; `POST /integrations/:id/test` devient réel pour les clés `webhook*` (ping signé).
   Deliveries : `POST /integrations/:id/deliveries/:deliveryId/replay`.
2. **Récepteur webhook entrant** : `POST /public/hooks/:inboundToken` (`@Public()`, throttlé) ;
   `inboundToken` = 32 octets base64url stocké haché dans `Integration.config` (comme les clés API) ;
   HMAC optionnel (`X-Signature: sha256=…` avec `config.inboundSecret`) ; idempotence sur
   `X-Idempotency-Key` ou hash du corps (table `InboundMessage`, `source: 'WEBHOOK'`) ; corps JSON
   → mapping (`buildDryRunMapping` promu en `applyMapping`, mêmes 4 transformations + `default`,
   `concat`) → **cible** `config.target` ∈ `transport-order.create | location.upsert |
   customer.upsert | carrier.upsert | item.upsert` (réutilise `createRecord` de l'import CSV, même
   permission re-vérifiée avec le service-account) ; réponse `{ inboxId, status }`. Rule 15 : module
   du service cible vérifié.
3. **EDI X12** dans `@pulsar/shared/edi` (pur, fixtures) : tokenizer d'enveloppes ISA/GS/ST, lecture
   204 (Motor Carrier Load Tender) → commande canonique `{ shipmentId, stops[], equipment, weight,
   references }` ; génération 990 (accept/decline) ; génération 214 (statut d'expédition à partir des
   événements d'un shipment : AF/X1/D1…) ; lecture 210 (facture transporteur) → lignes pour
   `FreightAuditService`. API : `POST /connect/edi/inbound` (texte X12, `Integration` key `edi-*`
   avec ISA/GS ids partenaire) → 204 crée un `TransportOrder` DRAFT + `InboundMessage{source:'EDI'}`
   (nouvelle valeur) + 990 renvoyé dans la réponse et journalisé ; 210 → `IncomingCarrierInvoice` ;
   `GET /transportation/shipments/:id/edi/214` génère le 214 courant (perm `transportation.tracking.read`).
   Livraison sortante des 214 : via l'outbox webhook (format `x12`) quand l'intégration EDI a une
   `url`. Pas d'AS2/VAN v1 (TODO).
4. **API partenaires** : Swagger déclare `X-Api-Key` (`addApiKey`) ; clés API : `expiresAt?`
   optionnel + presets de portée (`read-only`, `orders-intake`, `tracking`) dans `@pulsar/shared`
   (pure data) appliqués dans l'UI des clés.
5. **iCal** : `GET /public/ical/yard/:token` (flux des rendez-vous de quai du tenant, jeton par
   tenant dans `TenantModule.settings` yard), générateur pur `buildIcs` dans `@pulsar/shared`.
6. **Hub Connexions** (`CONNECTION_CATALOG`) : entrées mises à jour — Webhooks sortants (✓), Webhook
   entrant (✓), EDI X12 (✓), Slack/Teams (✓ via format), iCal (✓), Twilio/M365/Meta restent PLANNED ;
   `/integrations` : textes « bientôt » retirés là où le test est réel ; nouvel écran
   `/connect/inbound-hooks` (créer un récepteur, voir le jeton une fois, voir la boîte de réception).
7. Hors périmètre v1 (dette, TODO) : SFTP/FTP, OAuth client (QuickBooks/Shopify), télématique,
   AS2/VAN, SCIM, file durable partagée (les deux outbox restent), export data warehouse.

## D. Hard rules à ajouter
53. (Aide à la saisie) Tout champ de formulaire référençant une entité ou un vocabulaire fermé passe
    par `EntityPicker` (recherche serveur, `labelKey/valueKey`) ou `ReferenceSelect` (référentiels
    purs de `@pulsar/shared/reference`) — jamais un `Input` libre ni un `<Select>` chargé en
    `pageSize: 100`. Les statuts s'affichent via `labelFor` (libellés FR de `status.ts`).
54. (Portail client v2) Toute donnée exposée au portail passe par une projection explicite scopée
    `(tenantId, customerId)` ; les positions = une seule position par expédition non livrée (règle 20) ;
    aucune donnée transporteur/coût. `PortalChangeRequest` ne change de statut que via
    `canTransitionPortalChangeRequest` ; la création écrit la ligne avant d'émettre l'événement.
55. (Connecteurs) Les événements métier atteignent les intégrations UNIQUEMENT via
    `DomainEventsService.emit → WebhooksService.emit` (best-effort) ; un récepteur entrant est
    identifié par un `inboundToken` haché, idempotent sur `InboundMessage`, et n'écrit qu'à travers les
    services métier existants (`createRecord`) sous le service-account, avec module + permission
    re-vérifiés (règles 13/15). Le parsing/génération EDI et iCal vit dans `@pulsar/shared` (pur).

## E. Livrables
Code + tests (Vitest shared/web, Jest unit/e2e, Playwright), 1 migration (`PortalChangeRequest` +
`InboundSource` valeur `EDI` si enum Prisma, sinon rien), docs : CLAUDE.md 53-55, etat-du-projet,
TODO, `docs/plans/pickers-portal-connectors.md`, `docs/collaboration.md` (webhooks : catalogue
d'événements, récepteur entrant, EDI).
