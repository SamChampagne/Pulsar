# Module D — Driver Mobile PWA

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Décision de design
Le lien public driver existe déjà (`Load.driverToken`, page `/driver/[token]`, endpoints stops
arrive/depart, POD photo, position, BOL). Module D **étend** cette surface (pas de nouveau module —
reste sous TRANSPORTATION public, gardé par re-check module rule 15). On ajoute : signature, exception/
damage, notes de stop visibles, et on rend la page **installable (PWA)**.

## D-T1 — API + shared
1. **Stop.notes dans la projection** : `getDriverView` (`public-links.service.ts`) expose `notes: s.notes`
   dans le map des stops (1 ligne).
2. **Signature** : `POST /public/driver/:token/pod/:shipmentId/signature` (multipart PNG, ou body
   `{ dataUrl }`). Stocke via `DocumentsService.upload` (entityType `proof-of-delivery`,
   entityId=shipmentId, mime image/png) puis upsert `ProofOfDelivery.signatureDocumentId` (créer le POD
   s'il n'existe pas, sinon update). tenantId résolu par le token. Re-check module rule 15.
3. **Exception/damage** : `POST /public/driver/:token/exception` body `{ shipmentId?, stopId?, kind, note }`
   (kind ex. DAMAGE/DELAY/REFUSED/OTHER). Crée un `TrackingEvent { type: EXCEPTION, loadId, ... }` et
   **émet** `DomainEventsService.emit(tenantId, 'driver.exception', {type:'load', id:loadId}, {loadId,
   loadNumber, shipmentId?, stopId?, kind, note})`. Ajouter dans `@pulsar/shared/operating/policies.ts`
   le type d'évènement `DRIVER_EXCEPTION='driver.exception'` + une policy → `TaskSpec` (catégorie
   `DRIVER_EXCEPTION`, severity selon kind : DAMAGE/REFUSED=CRITICAL sinon WARNING, dedupKey
   `driver-exception:<loadId>:<kind>:<bucket>`), pour que ça remonte dans le Workbench/Control Tower.
   Tester la policy (pure).
   Mime/validation ; throttle léger comme `driverRecordPosition`.

## D-T2 — Web (PWA + page enrichie)
1. **PWA assets** : `apps/web/static/manifest.webmanifest` (name « Pulsar Driver », short_name, theme_color,
   background_color, display standalone, start_url `/`, icons → réutiliser `favicon.svg` avec
   `purpose:"any maskable"` pour éviter la génération binaire ; PNG 192/512 = polish différé) ;
   `app.html` : `<link rel="manifest">`, `<meta name="theme-color">`, balises apple-mobile-web-app.
   Ne pas casser le SPA (adapter-static). (Pas de service worker offline — hors-scope.)
2. **Page `/driver/[token]/+page.svelte`** (existe) — enrichir :
   - Afficher `stop.notes` (notes dispatch) par stop.
   - **Signature** : un canvas de capture (pointer events) par shipment au moment du POD →
     export PNG (toDataURL) → POST signature. Bouton effacer.
   - **Exception/damage** : un bouton « Signaler un problème » → petit formulaire (kind select +
     note + shipment/stop optionnel) → POST exception ; confirmation inline.
   - Feedback d'erreur inline (page publique sans toaster), états de chargement.
   - Conserver le partage de position existant.

## Contraintes
Public token = seul credential (rule 1 : tenantId jamais du body) ; projection sans refs internes (rule 10) ;
re-check module TRANSPORTATION (rule 15) ; fichiers via DocumentsService (rule 12) ; exception via
DomainEvents → policy `@pulsar/shared/operating` (pure, testée) → OperationalTask (réutilise le pipeline
existant) ; signature stockée comme Document + `ProofOfDelivery.signatureDocumentId`. Enums policy shared.

## Hors-scope
Offline/service worker, sync en arrière-plan, PNG icons générés (SVG suffit pour installable),
nouvelle entité (réutilise TrackingEvent/ProofOfDelivery/Document).

## Critères de succès
1. Stop.notes visibles côté driver.
2. Signature capturée → stockée → liée à `ProofOfDelivery.signatureDocumentId`.
3. Exception driver → TrackingEvent EXCEPTION + domain event → OperationalTask créé (policy testée).
4. Page installable (manifest + icônes + meta) sans casser le SPA.
5. Tenant-scopé par token ; API boote ; typecheck propre ; shared tests verts.
