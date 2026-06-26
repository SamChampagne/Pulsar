# Arc « modules opérationnels avancés » — Yard, Fleet, Achats

> Objectif (Sam, 2026-06-25) : rendre **Yard (cour)**, **Fleet/Assets** et **Achats** beaucoup plus
> riches/utiles, niveau ERPNext. Décisions actées : Achats = **les deux** (approfondir le fret +
> ajouter l'achat de marchandises) ; exécution = **arc complet sur les 3**, livré par vagues, en
> sous-agents, tout sur la branche `crm-email-threads` (non mergée), commits par fonctionnalité.

Patterns à respecter (CLAUDE.md) : state machines pures dans `@pulsar/shared` (règle 2), enums
mirrorés `schema.prisma`↔shared (règle 3), endpoints `@RequireModule`+`@RequirePermissions`
tenant-scopés (règles 1/5), FK via `OwnershipService` (règle 9), audit (règle 6), n° via
`SequencesService` (règle 8), fichiers via `DocumentsService` (règle 12), GL via `LedgerService`
(règle 41/42), stock via `InventoryService.postMovement` (règle 33). Web : `$state`+`$effect`,
`api<T>()`, `<Input>` (step=any par défaut désormais).

---

## Vague A — Fleet / Assets

Nouveaux modèles Prisma (mirror enums shared) :
- **OdometerReading** : `tenantId, vehicleId? XOR trailerId?, readingKm, readAt, source(MANUAL|WORK_ORDER|FUEL_LOG), note`. Historique append-only. KPI coût/km dérivé.
- **FuelLog** : `tenantId, vehicleId? XOR trailerId?, filledAt, volume, unit(L|GAL|KWH), totalCost, currency, odometerKm?, location?, note`. Efficacité (L/100km) dérivée à la lecture.
- **MaintenancePart** : `tenantId, maintenanceOrderId, description, qty, unitCost, lineTotal(=qty×unitCost)`. WO coût = Σ pièces + main-d'œuvre.
  - MaintenanceOrder : +`laborHours Decimal?`, +`laborRate Decimal?`, +`partsCost Decimal?` (recalcul). `costAmount` devient le total dérivé (parts+labor) à la complétion.
- **InspectionTemplate** : `tenantId, name, appliesTo(VEHICLE|TRAILER|DRIVER|ANY), isActive`, lignes **InspectionTemplateItem** `{label, category, order}`.
- **InspectionReport** (DVIR) : `tenantId, templateId, vehicleId?/trailerId?/driverId?, status(DRAFT|PASSED|FAILED), inspectedAt, inspectorName, odometerKm?, note`, lignes **InspectionItem** `{label, result(PASS|FAIL|NA), note}`. Statut dérivé : un FAIL ⇒ FAILED. Un FAILED peut best-effort ouvrir un WO REPAIR (proposé, pas auto).
- **Vehicle/Trailer** : +`fixedAssetId String?` (lien souple vers Billing `FixedAsset`, ownership vérifié) — affichage valeur comptable ; **pas** de GL depuis Fleet en v1.

Permissions : réutiliser `fleet.read|manage` (pas de nouvelle clé).
Endpoints (tous `@RequireModule(FLEET)`):
- `GET/POST /fleet/odometer-readings` (+ filtre asset) ; `GET /fleet/assets/:kind/:id/usage` (KPI coût/km, km/mois).
- `GET/POST /fleet/fuel-logs` ; agrégats efficacité.
- `POST /fleet/maintenance-orders/:id/parts` + `DELETE …/parts/:partId` ; labor sur complétion.
- `GET/POST /fleet/inspection-templates` ; `GET/POST /fleet/inspections` + `POST :id/submit`.
- `GET /fleet/reports/cost` (coût maintenance+carburant par asset/mois/type, calculé à la lecture).
Web : enrichir `FleetAssetDetail` (onglets Usage/Carburant/Inspections/Valeur), page `/fleet/reports`,
`/fleet/inspections`. Helpers purs shared : `costPerKm`, `fuelEfficiency`, `deriveInspectionStatus`,
`canTransitionInspection`, `workOrderTotal(parts,labor)`.

## Vague B — Yard

- **DetentionRate** : `tenantId, locationId?, freeMinutes, ratePerHour, currency, dailyCapHours?`. Défaut tenant si locationId null.
- **DetentionCharge** : `tenantId, visitId, minutes, billableMinutes, amount, currency, status(DRAFT|WAIVED|BILLED), waivedReason?, invoiceId?`. Généré à la sortie (best-effort) depuis le dwell ; `waive`/`bill` (→ ligne facture transporteur Billing). Dwell désormais **persisté** sur YardVisit (`dwellMinutes`, `detentionMinutes`) à la sortie.
- **AppointmentSlotTemplate** : `tenantId, locationId, dayOfWeek, startTime, endTime, capacity, spotType?`. Génère la dispo du calendrier ; `computeSlotAvailability` pur.
- Web : `/yard/calendar` (grille semaine, créneaux+capacité, glisser un RDV), `/yard/reports` (dwell P50/P90, no-show %, utilisation quai), détention dans le détail visite.
- Helpers purs : `computeDetention(dwell, rate)`, `computeSlotAvailability`, percentiles.

## Vague C — Achats (fret, approfondissement)

- **Comparateur de soumissions** : vue côte-à-côte par lane (taux normalisé, transit, score transporteur), surlignage meilleure offre. `scoreBid` pur (composite coût/transit/score).
- **Auto-attribution** : `POST /procurement/rfps/:id/auto-award` selon politique (`LOWEST_COST|FASTEST|BEST_SCORE`) configurable. Crée Award + Rate.
- **Routing-guide auto-sync** : à l'attribution, mettre à jour `LaneCarrierPreference` (réaction règle 38 ou direct dans le service award).
- **Devis spot / mini-bid** : `Bid` avec `rfpId=null` + `SpotQuote` léger : `POST /procurement/spot-quotes` (lane, carriers[], deadline) ; acceptation crée Rate.
- **Baseline & KPI économies** : `RfpLane.baselineRate?` ; `GET /procurement/savings` (Award vs baseline, roll-up tenant). Calculé à la lecture.

## Vague D — Achats marchandises (nouveau module `purchasing`)

Clé module `PURCHASING` (MODULE_CATALOG, available:true) + permissions `purchasing.read|manage`.
- **Supplier** : master fournisseur (`code, name, email, phone, terms, isActive, customData`). N° via Sequences.
- **PurchaseOrder** (DRAFT→SUBMITTED→APPROVED→RECEIVED→CLOSED|CANCELLED, `canTransitionPurchaseOrder`) + **PurchaseOrderLine** `{itemId? (WMS), description, qty, unitCost, lineTotal}`. N° PO-.
- **PurchaseReceipt** : réception (totale/partielle) → `InventoryService.postMovement` (RECEIPT) dans la même transaction (règle 33) ; lie `Receipt` WMS si item stockable.
- **SupplierInvoice** : facture fournisseur → GL `Dr Expense/Inventory / Cr AP` via `LedgerService.post` (règle 41/42), rapprochée au PO (variance prix). Réutilise le flux Billing AP + paiements (règle 42).
- Connexions : WMS (items/stock), Billing (GL/AP/paiements), Agents (outils `create_purchase_order`/`receive_goods`/`approve_supplier_invoice` via la file, règles 22/29).
- Hard rules à écrire (50+) : PO state machine + claim conditionnel, réception→stock atomique, GL idempotent, tenant-scope/module-gating.

---

## Ordre d'exécution
A (Fleet) → B (Yard) → C (Achats fret) → D (Achats marchandises). Une migration Prisma par vague.
Chaque fonctionnalité : shared (helper+test) → schema/migration → API service+controller → web → vérif navigateur → commit. Hard rules CLAUDE.md mises à jour par vague.
