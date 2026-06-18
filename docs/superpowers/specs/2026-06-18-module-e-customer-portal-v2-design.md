# Module E — Customer Portal v2

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Décision de design
Enrichit le Customer Portal existant (pas de nouveau module — `customer-portal`). Ajoute : vue
factures (lecture), vue documents/POD, **templates d'ordres récurrents**, **demandes de
changement** (event→task, sans migration), **branding tenant** (logo/accent). Réutilise le pattern
public token (rule 10 projection, rule 15 re-check). **ShipmentComment différé** (nouvelle entité +
page /shipments/[id] — sortie de scope MVP).

## E-T1 — API + shared
Dans `apps/api/src/modules/customer-portal/` (étendre PortalService + le public controller).
Toutes les requêtes scopées par le customer résolu depuis le token (rule 1) ; projections sans refs
internes (rule 10) ; re-check module dans `customerByToken` (rule 15, existe déjà).

1. **Factures (lecture)** : `GET /public/portal/:token/invoices` → liste `CustomerInvoice` du customer,
   filtrée aux statuts APPROVED/SENT/PAID (jamais DRAFT), projection
   `{invoiceNumber, status, currency, totalAmount, sentAt, paidAt}` (pas de priceDetail/lines internes,
   ou lignes résumées label+amount seulement). Réutilise `CustomerInvoicesService.list(tenantId, status?, customerId)`.

2. **Documents/POD (lecture)** : `GET /public/portal/:token/shipments/:shipmentId/documents` → vérifie
   que le shipment appartient au customer (via son order) sinon 404 ; `DocumentsService.listForEntity(
   tenantId, 'proof-of-delivery', shipmentId)` → projection `[{id, fileName, mimeType, createdAt}]`.
   `GET /public/portal/:token/documents/:documentId/download` → vérifie que le document appartient au
   customer (entityType proof-of-delivery + entityId ∈ ses shipments) puis stream via DocumentsService.
   (Pas de fuite : valider l'ownership avant de servir.)

3. **OrderTemplate** (migration) : modèle `OrderTemplate { id, tenantId, customerId, name,
   originLocationId?, destinationLocationId?, mode TransportMode?, totalWeightKg?, totalVolumeM3?,
   palletCount?, notes?, createdAt, updatedAt, @@index([tenantId, customerId]) }`. Endpoints publics :
   - `GET /public/portal/:token/templates` → liste les templates du customer (projection sans tenantId/customerId).
   - `POST /public/portal/:token/templates` `{name, originLocationId?, destinationLocationId?, mode?,
     totalWeightKg?, totalVolumeM3?, palletCount?, notes?}` → crée (customerId du token ; valider que
     les locationId appartiennent au tenant/customer via OwnershipService).
   - `DELETE /public/portal/:token/templates/:id` (template du customer).
   - `POST /public/portal/:token/orders` (EXISTE) : accepter un `templateId?` optionnel — si fourni,
     pré-remplir depuis le template (le body peut surcharger). (Réutilise la logique createOrder existante.)

4. **Change request** (sans migration, event→task) : `POST /public/portal/:token/change-requests`
   `{ orderId?, shipmentId?, kind, note }` (kind @IsIn(['DATE','ADDRESS','CANCEL','OTHER'])). Valide
   l'ownership (order/shipment du customer). Émet `DomainEventsService.emit(tenantId,
   'portal.change-request', {type:'transport-order'|'shipment', id}, {customerName, kind, note, orderNumber?})`.
   Ajouter dans `@pulsar/shared/operating/policies.ts` le type `PORTAL_CHANGE_REQUEST='portal.change-request'`
   + policy → TaskSpec (catégorie `CHANGE_REQUEST`, severity WARNING, dedupKey
   `portal-change:<orderId|shipmentId>:<kind>:<bucket>`, assignHint UNASSIGNED). Tester la policy.
   Best-effort emit. Retourne {ok:true}.

5. **Branding tenant** (sans migration — `Tenant.settings.branding`) : 
   - Admin `PUT /customer-portal/branding` (`@RequireModule(CUSTOMER_PORTAL)` + `customer-portal.links.manage`)
     `{ logoUrl?, accentColor? }` → merge dans `tenant.settings.branding`. Audit.
   - `getPortalView` expose `branding: { logoUrl?, accentColor? }` (depuis settings) pour que la page
     publique l'applique. (logoUrl = URL libre fournie par l'admin ; pas d'upload pour le MVP.)

## E-T2 — Web
- Page `/portal/[token]/+page.svelte` (existe) — passer en sections/onglets :
  - **Commandes** : liste (drill-down léger) + créer (avec sélecteur de **template** + champs pré-remplis,
    et « Enregistrer comme template »).
  - **Factures** : tableau lecture seule (numéro, statut, total, dates).
  - **Documents** : par shipment, lister + télécharger POD (lien authentifié par token → download endpoint).
  - **Demande de changement** : formulaire (kind + note + order/shipment) → POST.
  - **Branding** : appliquer `branding.logoUrl`/`accentColor` via `PublicShell` (prop logo + style accent).
- Admin branding : un petit panneau (page settings ou customers) gardé `customer-portal.links.manage`
  pour saisir logoUrl + accentColor (PUT /customer-portal/branding).
- `PublicShell` : accepter une prop `brand?: { logoUrl?, accentColor? }` (logo + accent), fallback Pulsar.
- api<T>() sans Bearer sur le public ; feedback inline (pas de toaster public).

## Contraintes
Token = seul credential (rule 1) ; projection sans refs internes (rule 10) ; re-check module (rule 15) ;
fichiers via DocumentsService avec **ownership re-vérifié** avant de servir (rule 12 + 1) ; change request
via DomainEvents→policy pure testée ; OwnershipService sur locationId/order/shipment ; audit branding/templates ;
TransportMode/enums depuis shared. Pas de fuite de documents d'un autre customer.

## Hors-scope (différés)
ShipmentComment/chat (entité + page /shipments/[id]), upload de logo (URL libre pour le MVP), édition
de template avancée, paiements.

## Critères de succès
1. Client voit ses factures (APPROVED/SENT/PAID) et ses POD/documents (et uniquement les siens).
2. Templates : créer/lister/supprimer ; créer une commande depuis un template (pré-rempli).
3. Demande de changement → OperationalTask créé (policy testée).
4. Branding : logo + accent appliqués sur la page publique ; réglables par l'admin.
5. Tenant-scopé/owner-vérifié partout ; API boote ; typecheck propre ; shared tests verts.
