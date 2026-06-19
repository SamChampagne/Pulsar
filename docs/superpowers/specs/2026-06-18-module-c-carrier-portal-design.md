# Module C — Carrier Portal

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Décision de design
Calque exact du **Customer Portal** : un token sur l'entité (`Carrier.portalToken String? @unique`),
admin mint/revoke (gardé), pages publiques `@Public()` token-résolues avec projection rule 10 +
re-check module rule 15. Réutilise tenders/loads/IncomingCarrierInvoice/DocumentsService.

## C-T1 — Fondation (shared + schéma + migration)
- `MODULE_KEYS.CARRIER_PORTAL='carrier-portal'` + `MODULE_CATALOG` (available:true).
- `PERMISSIONS.CARRIER_PORTAL = { LINKS_MANAGE:'carrier-portal.links.manage', READ:'carrier-portal.read' }`
  (+ union + catalog via factory).
- Prisma : ajouter `portalToken String? @unique` au modèle `Carrier`. Migration
  (`pnpm db:migrate --name carrier_portal_token`).

## C-T2 — API (`apps/api/src/modules/carrier-portal/`)
`CarrierPortalModule` (importe Prisma, DocumentsModule, TendersModule/TransportationModule pour
`TendersService`, TenantModulesCacheService, AuditLogs). Enregistré dans `app.module.ts`.

`CarrierPortalService` :
- `carrierByToken(token)` (privé) : `findUnique({where:{portalToken:token}})` → 404 si absent ;
  re-check `CARRIER_PORTAL` activé pour `carrier.tenantId` (TenantModulesCacheService) sinon 403.
- `generateLink(tenantId, carrierId)` : assert carrier owned ; si `portalToken` existe le renvoie,
  sinon `randomBytes(24).toString('base64url')` + update ; renvoie `{ url: ${WEB_URL}/carrier-portal/${token} }`. Audit.
- `revokeLink(tenantId, carrierId)` : `portalToken=null`. Audit.
- `getView(token)` : projection rule 10 (PAS de tenantId/carrierId) :
  `{ shipper: tenant.name, carrier:{name,code,email,phone,contactName},
     tenders:[{id, loadNumber, status, expiresAt, message}],
     loads:[{loadNumber, status, dispatchedAt, completedAt, shipments:[{shipmentNumber,status,actualDeliveryAt}]}],
     invoices:[{carrierInvoiceNumber,currency,chargedTotal,matchedTotal,varianceTotal,status,
       disputeReasonCode,disputeNote,resolution,paidAt}] }`.
  Requêtes scopées `tenantId=carrier.tenantId AND carrierId=carrier.id`.
- `respondTender(token, tenderId, accept, declineReason?)` : résout le carrier par token, vérifie
  que le tender appartient (tenantId+carrierId), lit `tender.token` et **réutilise**
  `TendersService.respond(tender.token, accept, declineReason)` (zéro duplication de la logique
  load/auto-tender). 404 si le tender n'est pas au carrier.
- `uploadPod(token, loadId, file)` : carrier par token ; vérifie load owned (tenantId+carrierId) ;
  mime image/pdf ; `DocumentsService.upload(carrier.tenantId, {entityType:'load-pod', entityId:loadId,
  fileName,mimeType,body, uploadedById:undefined})`.
- `uploadInvoiceAttachment(token, invoiceId, file)` : idem, invoice owned (tenantId+carrierId),
  `entityType:'carrier-invoice-attachment', entityId:invoiceId`.

Controllers :
- Admin `@RequireModule(CARRIER_PORTAL)` `@Controller('carrier-portal/carriers')` :
  `POST :carrierId/portal-link` (LINKS_MANAGE) → generateLink ; `DELETE :carrierId/portal-link` (LINKS_MANAGE).
  (Optionnel `GET carrier-portal/links` (READ) liste des carriers avec/ sans token — facultatif.)
- Public `@Public()` `@Controller('public/carrier-portal')` :
  `GET :token` → getView ; `POST :token/tenders/:tenderId/accept` ; `POST :token/tenders/:tenderId/decline` {reason?} ;
  `POST :token/loads/:loadId/pod` (multipart) ; `POST :token/invoices/:invoiceId/attachment` (multipart).

## C-T3 — Web
- **Admin** : sur la page carriers (liste ou détail), action « Portail transporteur » (gardée
  `carrier-portal.links.manage`) → génère + affiche le lien copiable `${origin}/carrier-portal/${token}` + révoquer.
  (Réutilise le pattern du customer-portal link s'il existe en UI ; sinon un bouton + modal simple.)
- **Public** : `apps/web/src/routes/carrier-portal/[token]/+page.svelte` (HORS groupe `(app)`,
  mirror de `portal/[token]/+page.svelte`, `PublicShell`) : profil transporteur, **tenders**
  (accepter/refuser), **loads** (statut + shipments + upload POD), **factures** (statut/variance/
  dispute en lecture + upload pièce jointe). `api<T>()` sans Bearer (token visiteur absent).

## Contraintes
Tenant isolation via token (jamais depuis le body) — règle 1 ; projection sans refs internes — règle 10 ;
re-check module — règle 15 ; token `randomBytes(24).base64url` ; fichiers via DocumentsService — règle 12 ;
réutiliser `TendersService.respond` (ne pas réimplémenter la logique de tender/auto-tender) ; audit mint/revoke ;
`@RequireModule(CARRIER_PORTAL)` sur l'admin ; `@Public()` sans garde sur le public.

## Hors-scope
Paiements réels, modification de dispute par le transporteur (lecture seule côté portail),
compliance CARRIER (pas de subject CARRIER — différé ; docs génériques entityType 'carrier' si besoin plus tard).

## Critères de succès
1. Module activable ; lien généré/révoqué (admin) ; lien copiable en UI.
2. Page publique : transporteur voit ses tenders/loads/factures (projection sans tenantId/carrierId).
3. Accepter/refuser un tender depuis le portail réutilise la logique tender existante (load mis à jour).
4. Upload POD (load) + pièce jointe facture via DocumentsService (contexte public).
5. Tenant-scopé ; API boote ; typecheck propre.
