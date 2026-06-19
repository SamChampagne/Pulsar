# ShipmentComment — fil de commentaires par shipment (spec)

Reliquat différé du **module E** (Customer Portal v2). Branche `analytics-control-tower`. Autonomie.

## But

Un fil de commentaires par shipment entre le **client** (via le portail public, token
`Customer.portalToken`) et le **staff interne**. Persisté (contrairement au change-request
fire-and-forget). Clôt module E.

## Existant à mirrorer (NE PAS dévier)

- `customer-portal/portal.service.ts` : résolution token (`Customer.portalToken`), re-check module
  (rule 15 : `TenantModulesCacheService` → `MODULE_KEYS.CUSTOMER_PORTAL`, sinon 403), vérif ownership
  (le client ne touche que ses shipments), audit, projection publique (rule 10 : jamais `tenantId`/
  refs internes). Le change-request (`PortalChangeRequestInput`, endpoint `POST /public/portal/:token/
  change-requests`) est le sibling le plus proche — mirrorer sa structure.
- `PortalPublicController` (`/public/portal/:token/...`), `randomBytes(24).toString('base64url')`
  (token déjà sur Customer — AUCUN nouveau token).
- Interne : `ShipmentsController` (`GET /transportation/shipments/:id` PLANNING_READ ; share/revoke
  TRACKING_WRITE). Liste shipments web a déjà un pattern de modale (cf. loads list).

## Périmètre LIVRÉ (phase-1)

### Incrément 1 — database + API

**`packages/database`** : modèle `ShipmentComment`
```prisma
model ShipmentComment {
  id          String   @id @default(cuid())
  tenantId    String
  shipmentId  String
  authorType  String   // 'CUSTOMER' | 'STAFF'
  authorId    String?  // userId (STAFF) | customerId (CUSTOMER) — interne, jamais exposé public
  authorName  String
  body        String
  createdAt   DateTime @default(now())
  shipment    Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  @@index([tenantId, shipmentId, createdAt])
  @@map("shipment_comments")
}
```
+ back-relation `Shipment.comments`. Migration SQL à la main (pattern récent, timestamp >
`20260619120000`) + `pnpm db:generate` (offline). Pas de nouvel enum Prisma (authorType = String,
union TS côté shared/DTO).

**API — public (PortalService + PortalPublicController)** :
- `GET /public/portal/:token/shipments/:shipmentId/comments` — résout token+tenant, re-check module
  (rule 15), assure que `shipmentId` appartient à un order du client (ownership), retourne le fil
  trié `createdAt asc` en **projection rule 10** : `{ id, authorType, authorName, body, createdAt }`
  (jamais `tenantId`/`authorId`/`shipmentId` interne au-delà du strict nécessaire — exposer juste
  ces champs).
- `POST /public/portal/:token/shipments/:shipmentId/comments` body `{ body: string }` (validé non
  vide, longueur max raisonnable ex 2000) — crée un comment `authorType='CUSTOMER'`,
  `authorId=customerId`, `authorName` = nom du client. Audit `CREATE` entityType `shipment-comment`.
  Retourne le comment projeté (rule 10).
- Réutiliser le helper existant de résolution token/ownership de PortalService (ne pas réimplémenter).

**API — interne (ShipmentsService + ShipmentsController)** :
- `GET /transportation/shipments/:id/comments` (PLANNING_READ) — tenant-scopé, fil complet projeté
  (interne peut voir authorType/authorName/body/createdAt ; pas besoin de authorId).
- `POST /transportation/shipments/:id/comments` (PLANNING_MANAGE) body `{ body }` — crée
  `authorType='STAFF'`, `authorId=user.id`, `authorName` = nom du user (fallback email). `assertOwned`
  du shipment (rule 9), audit `CREATE`. Réutiliser les perms existantes (PAS de nouvelle permission).

### Incrément 2 — Web

- **Portail public** (`apps/web/src/routes/portal/[token]/+page.svelte`) : par shipment (dans la
  section/onglet shipments), un accès « Commentaires » qui charge le fil + un champ de saisie pour
  poster. Mirrorer la mécanique du change-request (api client public via token dans l'URL, notice
  succès/erreur). Recharger le fil après post.
- **Interne** (`apps/web/src/routes/(app)/shipments/+page.svelte`) : une action « Commentaires » par
  ligne ouvrant une modale (mirrorer la modale détail de la liste loads) : fil + champ de réponse
  staff. Recharger après post.
- Pas de page détail shipment créée. Pas de nouveau design system.

## DIFFÉRÉ (phase-2)

- Notification staff à la réception d'un commentaire client (NotificationsService — destinataires à
  définir) ; ou domain event `shipment.comment` → policy → tâche. Non-lus / badges. Édition/suppression.

## Règles CLAUDE.md

- Rule 1 (tenant scope toutes requêtes), 10 (projection publique stricte, pas de tenantId/refs ;
  token existant base64url), 15 (re-check module dans le service public), 9 (assertOwned shipment
  côté interne ; ownership client côté public), 6 (audit create), 3/7 (db changé ⇒ generate+rebuild).
  Pas de nouvel enum, pas de nouvelle permission.

## Tâches

- **SC-T1 (db+api)** : modèle + migration + generate ; endpoints publics (PortalService) + internes
  (ShipmentsService). Vérifier : typecheck api 0 nouvelle err, build nest OK, gating+tenant-scope+
  ownership+projection rule 10+re-check rule 15+audit. db:generate OK.
- **SC-T2 (web)** : section portail + modale interne. Vérifier : `pnpm --filter web typecheck` 0 err.
- Reviewer après chaque incrément (insister rule 10 fuite + rule 15 + ownership public).
