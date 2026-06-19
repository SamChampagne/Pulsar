# Chantier 4 — Connect / Ingestion

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Décisions de design

- **Connect reste core-gated** (pas de nouveau module métier). On ajoute deux permissions
  `core.connect.read` / `core.connect.manage` pour la surface d'ingestion ; la nav `connect`
  existe déjà.
- **Entités : 5 (Lebron) → 3** (anti-sur-modélisation, couvre la valeur) :
  - `InboundMessage` — la file d'entrée (Inbox). Absorbe `ParsedDocument` (champs parsés dans
    `parsed Json?`). Source + statut + lien document + résumé + erreur.
  - `ImportBatch` — un run d'import CSV (cible, statut, compteurs, mapping, document source).
  - `ImportRow` — résultat par ligne (absorbe `MappingException` : `status=FAILED` + `error`).
  - `IntegrationRun` non créé : couvert par `InboundMessage`/`ImportBatch` (+ `WebhookDelivery`
    existant pour l'outbound). `MappingException` non créé (= `ImportRow` en échec).
- **CSV = ingestion réelle** ; **PDF = stockage + invoice structurée (pas d'OCR)** ; **email
  entrant = hors-scope** (aucun récepteur n'existe).
- Tout est best-effort/auditer ; fichiers via `DocumentsService` (règle 12) ; numéros via
  `SequencesService` (règle 8) ; events via `DomainEventsService` (réutilisé).

## Enums & shared (`packages/shared/src/connect/`)
- `InboundSource = 'CSV' | 'PDF' | 'DOCUMENT' | 'WEBHOOK'` (pas EMAIL/EDI pour l'instant).
- `InboundStatus = 'RECEIVED' | 'PARSED' | 'IMPORTED' | 'FAILED' | 'IGNORED'`.
- `ImportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'`.
- `ImportRowStatus = 'IMPORTED' | 'FAILED'`.
- `IMPORT_TARGETS` (pure data) : catalogue `{ key, label, requiredColumns[], optionalColumns[],
  permission }` pour `customers`, `locations`, `carriers`, `items`, `vehicles`, `trailers`.
  (rates/lanes différés — DTO complexes.)
- Helpers purs testés : `applyMapping(row: Record<string,string>, mapping): Record<string,unknown>`
  (renomme colonnes→champs DTO, trim), `validateRequired(record, requiredColumns): string[]`
  (liste des champs manquants), `coerceTypes(record, target)` (nombres/bool basiques).
- `parseCsv(text): { headers: string[]; rows: Record<string,string>[] }` — parseur CSV minimal
  robuste (quotes, virgules, CRLF). Pur, testé. (Si une dépendance CSV existe déjà dans l'API,
  l'utiliser côté API à la place ; sinon ce parseur shared sert.)

## Schéma (`packages/database/prisma/schema.prisma`) + migration
Trois modèles tenant-scopés (+ indexes `(tenantId, status, createdAt)`), document via FK souple
(`documentId String?`, pas de relation Prisma dure) :
- `InboundMessage { id, tenantId, source InboundSource, status InboundStatus, kind String?,
  summary String, documentId String?, parsed Json?, error String?, refType String?, refId String?,
  createdById String?, createdAt, updatedAt }`
- `ImportBatch { id, tenantId, number String?, target String, status ImportStatus, totalRows Int,
  importedRows Int, failedRows Int, mapping Json, documentId String?, error String?,
  createdById String?, createdAt, updatedAt }`
- `ImportRow { id, tenantId, batchId String, rowIndex Int, status ImportRowStatus, error String?,
  data Json, createdAt }` (index `(tenantId, batchId)`).
Enums Prisma miroirs des shared (mêmes valeurs, règle 3). Séquences : ajouter `'import-batch'`
(préfixe `IB`) et `'inbound-message'` (préfixe `IN`).

## Morceaux

### C4-M1 — Schéma + shared (enums/targets/helpers/parseCsv) + permissions + migration
Shared `connect/` (types, IMPORT_TARGETS, applyMapping/validateRequired/coerceTypes/parseCsv, tests).
Permissions `core.connect.read/manage`. Prisma 3 modèles + enums + migration + séquences IB/IN.

### C4-M2 — CSV importer (API)
`apps/api/src/core/connect/` : `ConnectModule`, `ImportsService`, controller.
- `GET /connect/imports` (connect.read) → liste ImportBatch.
- `GET /connect/imports/:id` (connect.read) → batch + rows (paginé).
- `POST /connect/imports` (connect.manage) multipart : `file` (CSV) + `target` + `mapping(JSON)`.
  → stocke le CSV via DocumentsService (entityType `import-batch`), crée `ImportBatch` (number IB-),
  parse, pour chaque ligne : `applyMapping`→`coerceTypes`→`validateRequired`, appelle le service
  master-data du target (`customers/locations/carriers/items/vehicles/trailers`), écrit `ImportRow`
  (IMPORTED/FAILED+error), met à jour les compteurs + statut final. Crée aussi un `InboundMessage`
  (source CSV) lié. Best-effort par ligne (une ligne en échec n'arrête pas le batch). Tenant-scopé.
  **Sécurité** : l'endpoint exige `core.connect.manage` ET la permission `IMPORT_TARGETS[target]
  .permission` (vérifiée contre `user.permissions`) — pas d'escalade (importer = créer la donnée).
- Adapter `IMPORT_TARGETS[target]` → service create via une petite table d'aiguillage dans le
  service (injecte CustomersService/LocationsService/CarriersService/ItemsService/VehiclesService/
  TrailersService). Émet `connect.import-batch.completed` (DomainEvents).

### C4-M3 — Ingestion document/PDF (API)
- `POST /connect/inbound/carrier-invoice` (connect.manage + `billing.freight-audit.manage`)
  multipart : `file` (PDF) + champs structurés (`carrierId, carrierInvoiceNumber, currency?,
  lines[]`). → stocke le PDF (DocumentsService entityType `incoming-carrier-invoice`), crée
  l'invoice via `FreightAuditService.create` (sourceRef `pdf-ingestion`), attache le document à
  l'invoice, crée `InboundMessage` (source PDF, status IMPORTED, refType/refId vers l'invoice).
  Pas d'OCR — champs fournis par l'appelant (humain/agent/futur OCR).
- `POST /connect/inbound/document` (connect.manage) multipart : `file` + `refType` + `refId`
  (ex. POD/BOL → shipment/load). → stocke via DocumentsService, crée `InboundMessage` (source
  DOCUMENT). 
- `GET /connect/inbox` (connect.read) → liste `InboundMessage` (filtres source/status), `:id`
  détail (lien document download). `POST /connect/inbox/:id/ignore` (connect.manage).

### C4-M4 — Web UI (Inbox + Imports)
- Page `/connect/inbox` : liste InboundMessage (badges source/status), détail (document, ref,
  parsed, erreur), action Ignorer. Liens nav ajoutés au domaine `connect`.
- Page `/connect/imports` : liste des batches + assistant d'import CSV (choisir target, upload
  CSV, mapper colonnes→champs via `IMPORT_TARGETS`, lancer), résultats (importés/échecs + erreurs
  par ligne). Réutilise `uploadDocument`/multipart (le endpoint est multipart, pas le doc upload).

## Hors-scope
OCR/extraction PDF automatique, EDI, email entrant, import rates/lanes (DTO complexes), webhook
inbound receiver (séparé). Documentés comme différés.

## Critères de succès
1. 3 modèles + enums + migration ; shared connect testé (parseCsv/mapping/targets).
2. Import CSV : un CSV de customers/carriers/etc. crée les enregistrements, ImportRow par ligne,
   compteurs justes, lignes invalides → FAILED+error sans bloquer le batch ; permission target
   exigée (pas d'escalade).
3. PDF carrier-invoice : crée l'IncomingCarrierInvoice (sourceRef pdf-ingestion) + document attaché
   + InboundMessage.
4. Inbox liste/détaille les messages entrants ; Imports lance et montre les résultats.
5. Tenant-scopé partout ; API boote ; typecheck propre ; shared tests verts.
