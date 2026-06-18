# Module B — Procurement / Bid Board

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Objectif
Nouveau module métier `procurement` : RFP sur des lanes, invitations transporteurs (lien public
tokenisé), offres (bids) concurrentes, attribution (award) → création optionnelle d'un `Rate`,
guide de routage dérivé des awards. Réutilise lanes/carriers/rates ; aucun nouveau moteur de rating.

## Entités (Prisma + migration)
- `Rfp { id, tenantId, rfpNumber String? (RFP-), title, description?, status RfpStatus @default(DRAFT),
  deadline DateTime?, createdById?, createdAt, updatedAt, @@index([tenantId,status,createdAt]) }`
- `RfpLane { id, tenantId, rfpId, laneId, mode TransportMode?, volumeEstimate Int?, @@index([tenantId,rfpId]) }`
- `RfpInvite { id, tenantId, rfpId, carrierId, token String @unique, status InviteStatus @default(SENT),
  sentAt @default(now()), respondedAt?, @@index([tenantId,rfpId]) }`
- `Bid { id, tenantId, rfpId, rfpLaneId, carrierId, rateType RateType, amount Decimal(12,2),
  currency String @default("CAD"), validFrom?, validTo?, transitDays Int?, notes?, status BidStatus
  @default(SUBMITTED), submittedAt @default(now()), @@index([tenantId,rfpId]), @@index([tenantId,rfpLaneId]) }`
- `Award { id, tenantId, rfpLaneId @unique, carrierId, bidId?, rateId?, awardedById?, awardedAt @default(now()) }`
Enums Prisma miroirs des shared (règle 3). Séquence `'rfp'` préfixe `RFP`.

## Shared (`packages/shared/src/procurement/procurement.workflow.ts`)
- `enum RfpStatus { DRAFT, OPEN, EVALUATION, AWARDED, CANCELLED }` + `canTransitionRfp(from,to)`
  (DRAFT→OPEN/CANCELLED ; OPEN→EVALUATION/CANCELLED ; EVALUATION→AWARDED/OPEN/CANCELLED ; AWARDED/CANCELLED terminal).
- `enum BidStatus { SUBMITTED, SHORTLISTED, ACCEPTED, REJECTED }` + `canTransitionBid` (SUBMITTED→SHORTLISTED/ACCEPTED/REJECTED ; SHORTLISTED→ACCEPTED/REJECTED ; terminal ACCEPTED/REJECTED).
- `enum InviteStatus { SENT, RESPONDED, EXPIRED }` (pas de workflow, transitions directes).
Re-export depuis `index.ts`. Tests : tables de transition.

## Permissions / module / nav
- `MODULE_KEYS.PROCUREMENT='procurement'` + `MODULE_CATALOG` (available:true).
- `PERMISSIONS.PROCUREMENT = { READ:'procurement.read', MANAGE:'procurement.manage' }` (+ union + catalog via factory `procurement`).
- Nav domaine `procurement` (`module: PROCUREMENT`, `anyPerms:['procurement.read']`, liens
  `/procurement/rfps`, `/procurement/routing-guide`) + `MODULE_UNIVERSES['procurement']` (accent distinct).

## Morceaux

### B-M1 — Fondation : shared (module/permissions/workflows tested) + schéma + migration + séquence + module scaffold
Shared (module key, permissions, workflows + tests). Prisma 5 entités + enums + migration + séquence RFP.
`apps/api/src/modules/procurement/procurement.module.ts` vide-ish (controllers/services ajoutés en B-M2),
enregistré dans `app.module.ts`.

### B-M2 — API (RFP CRUD + lanes + invites + bids + award) + public bid flow
`ProcurementService` + `RfpsController` (`@RequireModule(PROCUREMENT)`):
- `GET /procurement/rfps` (read, paginé), `GET /procurement/rfps/:id` (read ; inclut lanes (+lane), invites
  (+carrier), bids (+carrier), awards).
- `POST /procurement/rfps` (manage) — crée RFP (rfpNumber via séquence) ; `PATCH :id` (manage, titre/desc/deadline).
- `POST :id/lanes` (manage) ajoute un RfpLane (laneId vérifié OwnershipService) ; `DELETE :id/lanes/:laneId`.
- `POST :id/invites` (manage) `{carrierId}` → crée RfpInvite (token `randomBytes(24).base64url`), email best-effort.
- `POST :id/open` / `:id/evaluation` / `:id/cancel` (manage) — transitions via `canTransitionRfp` + claim `updateMany`.
- `POST :id/bids/:bidId/shortlist|reject` (manage) — `canTransitionBid`.
- `POST :id/award` (manage) `{ rfpLaneId, bidId, createRate?:bool }` — vérifie le bid, crée `Award`
  (upsert sur rfpLaneId @unique), passe le bid ACCEPTED ; si `createRate` → `RatesService.create`
  ({name:`Award ${carrier}`, rateType:bid.rateType, baseAmount:bid.amount, carrierId, laneId, validFrom/To,
  status ACTIVE}) et stocke `rateId`. Audit (`@Audit`/AuditLogsService), tenant-scopé, OwnershipService.
  Quand tous les rfpLanes ont un award → RFP `AWARDED` (best-effort).
- `GET /procurement/routing-guide` (read) — **dérivé** : liste des Awards du tenant (lane + carrier + rate),
  pas de table dédiée.
Public (`@Public()`, `/public/rfp-invites/:token`) :
- `GET` → projection (rule 10) : `{ rfp:{title,description,deadline,status}, shipper:tenant.name,
  lanes:[{rfpLaneId, origin/destination résumé, mode, volume}] }` — pas de tenantId/ids internes superflus.
  Re-check module activation (rule 15).
- `POST /public/rfp-invites/:token/bids` `{ rfpLaneId, rateType, amount, currency?, transitDays?, notes? }`
  → crée un `Bid` (carrierId = invite.carrierId), passe l'invite RESPONDED. Claim/validation token.

### B-M3 — Web UI + nav/universe
- nav `procurement` + universe.
- `/procurement/rfps` : liste (numéro, titre, statut, deadline, #lanes/#bids) + création (titre/desc/deadline).
- `/procurement/rfps/[id]` : détail — lanes (ajout depuis les lanes existantes), invites (ajouter carrier →
  affiche le lien public), bids par lane (tableau comparatif prix/transit/statut, actions shortlist/reject/
  **award** avec case « créer le tarif »), transitions RFP (open/evaluation/cancel).
- `/procurement/routing-guide` : tableau dérivé (lane → carrier attribué, tarif, date).

## Contraintes
Tenant isolation (règle 1) ; transitions via `canTransition*` (règle 2) + claim `updateMany` ; FK via
OwnershipService (règle 9) ; numéros via SequencesService (règle 8) ; award peut créer un Rate via
`RatesService` (règle 11 : pas de recompute ailleurs) ; public = token `randomBytes(24).base64url`,
projection sans refs internes (règle 10), re-check module (règle 15) ; audit (règle 6/14) ;
`@RequireModule(PROCUREMENT)` + `procurement.read|manage`. Enums shared↔prisma identiques (règle 3).

## Hors-scope
Pondération service/scoring automatique des bids, RFP multi-round, contre-offres, EDI. (Différés.)

## Critères de succès
1. Module activable ; RFP créable avec numéro RFP-, lanes ajoutables.
2. Invite génère un lien public ; un transporteur soumet un bid via le token (projection sans refs internes).
3. Comparaison des bids par lane ; award attribue + (option) crée un Rate ACTIVE ; RFP→AWARDED quand complet.
4. Routing-guide dérivé liste les awards.
5. Tenant-scopé ; transitions gardées ; API boote ; typecheck propre ; shared tests verts.
