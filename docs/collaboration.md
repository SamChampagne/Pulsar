# Collaboration layer — tokenized public access

How external actors (carriers, drivers, end customers) interact with Pulsar **without an
account**: design, security model and endpoints. Functional walkthrough:
[guide-fonctionnel.md](./guide-fonctionnel.md) §5.

## Design

Three kinds of capability links, each carrying the narrowest possible scope:

| Link     | Token lives on           | Grants                                                                  | Revocation                                          |
| -------- | ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------- |
| Tender   | `Tender.token`           | View load summary; accept or decline **once**                           | Cancel tender / expiry (lazy)                       |
| Tracking | `Shipment.trackingToken` | Read-only status page (no tenant internals)                             | `DELETE /shipments/:id/share`                       |
| Driver   | `Load.driverToken`       | Stop ARRIVED/DEPARTED + POD (+photo) on that load                       | `DELETE /loads/:id/driver-link`                     |
| Portal   | `Customer.portalToken`   | Read-only order/shipment list for one customer (customer-portal module) | `DELETE /customer-portal/customers/:id/portal-link` |

Principles:

- Tokens are 24 random bytes (base64url, `node:crypto`), stored in plain text — they are
  _capabilities_, not credentials; revocation is a column update.
- Public endpoints live under `/api/v1/public/**`, marked `@Public()` (skip JwtAuthGuard);
  Modules/Permissions guards pass because no metadata is attached. **The token is the
  credential** — every handler revalidates it on each call.
- Public payloads are projection-built: they must never contain `tenantId` or internal ids
  beyond what the actor needs (asserted in `collaboration.e2e-spec.ts`).

## Tender lifecycle

```
Load PLANNED ──POST /loads/:id/tender──▶ Load TENDERED + Tender PENDING (expiresAt, default 48h)
  Tender PENDING ──carrier accepts──▶ ACCEPTED   (load stays TENDERED; dispatch now allowed)
  Tender PENDING ──carrier declines─▶ DECLINED   (load → PLANNED)
  Tender PENDING ──shipper cancels──▶ CANCELLED  (load → PLANNED)
  Tender PENDING ──expiresAt past───▶ EXPIRED    (lazy on public read + 5-min cron; load → PLANNED)
```

`LoadsService.dispatch` refuses a TENDERED load without an ACCEPTED tender. Cancelling a load
cancels its pending tender. Responses emit tracking events and webhooks
(`tender.sent|accepted|declined|expired`). When the carrier has an email address, the response
link is emailed automatically (see Email channel below); the UI also offers copy-to-clipboard.

### Auto-tendering (lane preference lists)

`LaneCarrierPreference` stores an ordered carrier list per origin→destination pair
(`GET/PUT /transportation/lanes`, web page `/lanes`). `POST /loads/:id/auto-tender` offers the
load to the first carrier of the lane without a DECLINED/EXPIRED tender on that load; each
decline (`TendersService.advanceChain`) or expiry (`TenderExpiryService`, cron every 5 min)
automatically tenders the next carrier, until acceptance or exhaustion. Tenders in a chain carry
`isAuto: true`. Chain advancement is best-effort: a failure logs and leaves the load PLANNED for
manual handling.

## Email channel

`EmailService` (global, best-effort — a mail failure never breaks the business operation):

- `EMAIL_DRIVER=log` (default): emails are written to the application log — dev/CI safe.
- `EMAIL_DRIVER=smtp`: real delivery via nodemailer (`SMTP_*` variables, `EMAIL_FROM`).

Current senders:

| Channel                | Wording                           | Gating                                                                                 | Source                         |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| Tender link to carrier | —                                 | carrier has email address                                                              | `tenders.service.ts`           |
| User invitation        | —                                 | always sent                                                                            | `users.service.ts`             |
| Password reset         | —                                 | always sent                                                                            | `auth.service.ts`              |
| Delivered notification | —                                 | order has customer contact email                                                       | `loads.service.ts`             |
| Billing statement      | `Billing statement <CINV-number>` | customer has email; `EmailService.send` must return `true`; statement must be APPROVED | `customer-invoices.service.ts` |

Tender responses include `emailedTo` so callers/tests know whether the email was handed off.

## Module cache

`TenantModulesCacheService` (30 s TTL, in-memory) backs `ModulesGuard` — no DB hit per guarded
request. Toggling a module invalidates the tenant's entry immediately. Single-process by design;
move to Redis when the API scales horizontally.

## Auth: refresh tokens

- `POST /auth/login` → `{ accessToken (15 min), refreshToken (30 d) }`.
- `POST /auth/refresh` rotates: presented token is revoked, a new pair is issued, permissions are
  **re-read from the DB** (role changes apply at next refresh, not next login).
- `POST /auth/logout` revokes the refresh token.
- Storage: `refresh_tokens` table, SHA-256 hash only.
- Web client (`$lib/api/client.ts`): single-flight transparent refresh-and-retry on 401.

## File storage

`FILE_STORAGE` injection token → driver chosen by `STORAGE_DRIVER`:

- `local` (default): files under `apps/api/<STORAGE_LOCAL_DIR>` (gitignored).
- `s3`: any S3-compatible store (`@aws-sdk/client-s3`); see `.env.example` for variables.

`POST /documents/upload` (multipart, 10 MB max) and `GET /documents/:id/download` (stream).
POD photos from the driver page land as documents with `entityType=proof-of-delivery`.

## Cost engine

`calculateRateCost` (packages/shared, pure + unit-tested): FLAT / PER_KM / PER_HUNDREDWEIGHT
(kg→CWT) / PER_PALLET / SPOT, fuel surcharge %, minimum charge. Returns `null` when the
required metric is missing — never silently 0. `LoadCostService.recompute` persists
`Load.estimatedCost` and runs after resource assignment and route (re)builds.

## Connecteurs

Un seul chapitre pour tout ce qui relie Pulsar à l'extérieur, dans l'ordre du flux : sortie
(webhooks), entrée (récepteur JSON), EDI X12, accès partenaire (clés API) et calendrier (iCal).
Le hub `/connect` (catalogue `CONNECTION_CATALOG`, `@pulsar/shared`) est la porte d'entrée UI ;
`/integrations` reste le studio de configuration, `/connect/inbound-hooks` et `/connect/edi` les
écrans dédiés aux deux plans entrants.

### Webhooks sortants (outbox durable)

`WebhooksService.emit(tenantId, event, data)` persists one `webhook_deliveries` row per ENABLED
integration whose key starts with `webhook` and matches the event, then attempts delivery
inline. Failures are retried by a 1-minute cron with backoff (1m, 5m, 30m, 2h, 6h — 5 attempts,
then FAILED). Config JSON: `{ "url", "secret"?, "events"?: [], "format"?: "json" }` — the
integrations studio spelling `{ "endpointUrl", "webhookSecret" }` is accepted too
(`resolveWebhookTarget`, `@pulsar/shared`). Headers:
`X-Pulsar-Signature: sha256=HMAC(secret, body)`, `X-Pulsar-Event`, `X-Pulsar-Delivery`.

**Feed (règle 55).** Every business event persisted by `DomainEventsService.emit` is bridged to
the outbox (best-effort, fire-and-forget), so the outbox covers the whole catalog, not just the
TMS events. `tender.sent` and `tender.accepted` have no domain event and stay direct emits.

**`events` vide = tous les événements du catalogue.** An absent or empty `events` array
subscribes the integration to **every** event of `GET /integrations/events`
(`DOMAIN_EVENT_CATALOG`) — list the event types explicitly to narrow the egress. Integrations
created before the bridge are pinned to the 6 historical TMS events at boot by
`WebhookEventsBackfillService` (idempotent, marked by `config.eventsBackfilledAt`; a boot hook
rather than a SQL migration because `Integration.config` is encrypted at rest).

**Formats.** `config.format`: `json` (canonical envelope `{ event, occurredAt, data }`),
`slack` (incoming webhook, mrkdwn escaped), `teams` (MessageCard), `x12` (raw interchange from
`data.x12`, `text/plain`). Unknown value → `json`.

**Egress guard.** A `webhook*` URL must be public http/https: loopback, link-local and private
ranges are refused at write time and before a live test, unless `WEBHOOK_ALLOW_PRIVATE_URLS=true`
(dev/CI).

**Test & replay.** `POST /integrations/:id/test` performs a real signed `ping` for `webhook*`
keys (5 s timeout; other kinds get a clearly-labelled configuration simulation).
`POST /integrations/:id/deliveries/:deliveryId/replay` re-queues one delivery (conditional
claim — 409 if it is already PENDING). Both are audited (`entityType: 'integration'`).
Inspect deliveries: `GET /integrations/:id/deliveries`.

### Webhooks entrants (récepteur)

`POST /api/v1/public/hooks/<inboundToken>` — un partenaire pousse du JSON, Pulsar écrit dans ses
propres services métier. Aucune clé API, aucun JWT : le jeton de l'URL **est** la crédentiale.

**Jeton.** `POST /integrations/:id/inbound-token` (permissions `core.integrations.manage` **et**
celle de la cible configurée — voir ci-dessous) génère 32 octets base64url et les renvoie **une
seule fois**, avec l'URL complète à donner au partenaire.
Seul le `sha256` est stocké, dans la colonne indexée `Integration.inboundTokenHash` (jamais dans
`config`, qui est chiffré donc non indexable) ; l'API ne renvoie jamais ce hachage mais un booléen
`hasInboundToken`. Ré-émettre **rotationne** : l'ancien jeton devient
invalide immédiatement. Un jeton inconnu, une intégration non `ENABLED` ou une config illisible
renvoient tous le **même 404 générique** — une sonde n'apprend rien.

**Configuration** (dans `Integration.config`, chiffré) :

| Clé             | Rôle                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `target`        | cible métier (obligatoire, voir ci-dessous)                               |
| `mappings`      | `[{ source, target, transform?, required? }]` — chemins pointés (`a.b.c`) |
| `inboundSecret` | optionnel : active la vérification HMAC (masqué en lecture, `***`)        |

**PATCH = fusion, pas remplacement.** `PATCH /integrations/:id` **fusionne** le `config` reçu
par-dessus celui qui est stocké : les clés que le corps ne mentionne pas sont conservées telles
quelles. C'est ce qui permet au studio générique (qui ignore `target`, `inboundSecret`,
`customerId` ou l'identité EDI `isa*`) d'enregistrer un simple renommage sans désarmer le HMAC ni
perdre la cible d'un récepteur en production. Trois règles : une valeur `"***"` renvoyée telle
quelle **conserve le secret stocké** (masquage aller-retour — conséquence : un secret dont la
valeur littérale est `"***"` ne peut pas être posé) ; une valeur `null` **supprime** la clé (seule
façon d'effacer un réglage) ; toute autre valeur écrase. Les gardes (cible + permission, egress
SSRF, identité EDI, chemins de mapping) tournent sur le résultat **fusionné** — une fusion ne peut
donc pas produire une config qu'une écriture directe aurait refusée. Création et mise à jour sont
auditées (`entityType: 'integration'`, `before`/`after` avec les secrets masqués).

**Cibles** (`GET /integrations/inbound-targets`) : `transport-order.create` (module
transportation, permission `transportation.orders.manage`), `location.upsert` (cœur,
`core.locations.manage`), `customer.upsert` et `carrier.upsert` (transportation,
`transportation.master-data.manage`), `item.upsert` (WMS, `wms.manage`). Les `*.upsert` matchent
la **clé naturelle** du tenant (`code`, ou `sku` pour les articles) : deux livraisons identiques
mettent à jour la même ligne au lieu de la dupliquer. `transport-order.create` accepte des codes
(`customerCode`, `originCode`, `destinationCode`) résolus côté serveur, ou directement les ids.

**Qui peut brancher un récepteur.** Pointer un récepteur vers une cible revient à déléguer cette
écriture à un partenaire : l'utilisateur qui enregistre `config.target` (POST/PATCH `/integrations`)
ou qui émet/rotationne le jeton doit donc détenir **la permission de la cible** en plus de
`core.integrations.manage` — sinon 403. C'est le **seul** contrôle d'autorisation humain du flux :
à la livraison, le principal est le service-account du tenant scopé à cette unique permission
(vérification d'invariant, pas décision d'autorisation — le jeton présenté est la crédentiale).

**Mapping.** `applyIntegrationMapping` (`@pulsar/shared`, pur — le même moteur que le dry run du
studio) avec les transformations `trim | uppercase | number | date.iso | default:<valeur> |
concat:<séparateur>`. En entrant le moteur est **strict** : une transformation inconnue est une
erreur, jamais un passage silencieux. Sans `mappings`, le corps est pris tel quel (mapping
identité). Seuls les champs de la liste blanche de la cible sont transmis au service métier —
`tenantId`, `id`, `status` et consorts ne peuvent pas être injectés. Un chemin (source ou cible)
traversant `__proto__`, `constructor` ou `prototype` est **refusé** : 400 à l'enregistrement de la
config et au dry run, erreur de mapping à la livraison (garde anti-pollution de prototype) —
jamais d'écriture.

**HMAC.** Si `inboundSecret` est présent, le partenaire doit envoyer
`X-Signature: sha256=<hex HMAC-SHA256 du corps brut>` ; comparaison à temps constant sur les
**octets bruts** reçus (`rawBody`), pas sur une re-sérialisation. Signature absente ou invalide →
`401`.

**Idempotence.** Clé = en-tête `X-Idempotency-Key`, sinon `sha256` du corps brut. Elle est stockée
dans `InboundMessage.dedupKey` avec un unique `(tenantId, dedupKey)` : un rejeu renvoie le
**statut réel** d'origine (`200`, `replayed: true`) sans ré-exécuter l'écriture. Si la ligne est
restée `RECEIVED` (processus mort entre la réservation et le résultat), un rejeu **ré-exécute**
la livraison après 2 minutes via un claim conditionnel (deux rejeux concurrents ne peuvent pas
tous les deux relancer l'écriture) ; avant ce délai, la réponse est `202 { status: 'RECEIVED' }`
— une livraison est en cours, réessayer plus tard.

**Traçabilité.** Chaque livraison acceptée crée un `InboundMessage{ source: 'WEBHOOK', status }`
visible dans `GET /connect/inbox`, avec une copie **caviardée et plafonnée** (8 Ko) du payload
(clés `secret|password|token|apikey|authorization|signature` → `***`). L'écriture est attribuée au
service-account du tenant (`service-account@pulsar.local`, règle 13) et **scopée à la seule
permission de la cible** ; le module de la cible est re-vérifié (règle 15 — `/public/**` contourne
le `ModulesGuard`) et un tenant `SUSPENDED` n'a plus aucune surface d'écriture (404 générique, même
convention que `AuthService`). Audit sous le service-account ; le jeton et le secret ne sont jamais
journalisés — le jeton porté par l'URL est caviardé dans le log HTTP
(`/public/hooks/<redacted>`, `redactTokenPath`), comme les autres jetons de capacité
(portail, chauffeur, appel d'offres, suivi, désabonnement).

**Réponses.**

| Code  | Cas                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202` | livraison traitée — `{ inboxId, status: 'IMPORTED' \| 'FAILED', error?, entityType?, entityId? }` ; `status: 'RECEIVED'` = une livraison de même clé est en cours, réessayer |
| `200` | rejeu idempotent — même corps, statut réel d'origine, `replayed: true`, rien de ré-exécuté                                                                                   |
| `400` | corps non-objet, cible non configurée                                                                                                                                        |
| `401` | signature HMAC absente ou invalide                                                                                                                                           |
| `403` | module de la cible désactivé pour le tenant                                                                                                                                  |
| `404` | jeton inconnu / récepteur désactivé (réponse générique)                                                                                                                      |
| `413` | corps trop volumineux : le body-parser JSON de Nest (**100 Ko** par défaut) tranche en premier ; le service garde un plafond de 256 Ko en défense en profondeur              |

Choix assumé : une livraison **acceptée** répond toujours `202`, même quand le mapping ou
l'écriture métier échoue (`status: 'FAILED'` + `error`). Le partenaire a un contrat unique et la
ligne d'inbox fait foi ; seules les erreurs d'accès (jeton, signature, module) sont des codes
d'erreur HTTP. La route est `@Public()` + `ThrottlerGuard`, et `NestFactory.create(AppModule,
{ rawBody: true })` est requis pour la vérification HMAC (activé dans `main.ts`).

### EDI X12 (204 / 990 / 210 / 214)

Le parsing et la génération vivent dans `@pulsar/shared/edi` (pur, browser-safe, fixtures
incluses — règle 55) ; l'API n'est que transport + gouvernance (`core/connect/edi.service.ts`).

**Intégration.** Un partenaire EDI = une `Integration` de clé **`edi-<partenaire>`** **et**
`config.format: "x12"` — les deux moitiés sont exigées partout (gardes, portes d'entrée) : poser
`format: "x12"` sur une clé hors du namespace `edi-` est refusé (400), et une clé `edi-*` sans
format se voit compléter à `x12`. Config :

| Clé             | Rôle                                                                |
| --------------- | ------------------------------------------------------------------- |
| `isaSenderId`   | ISA06 — notre identifiant chez ce partenaire (≤ 15 caractères)      |
| `isaReceiverId` | ISA08 — l'identifiant du partenaire (≤ 15 caractères)               |
| `gsSenderId`    | GS02, par défaut `isaSenderId`                                      |
| `gsReceiverId`  | GS03, par défaut `isaReceiverId`                                    |
| `customerId`    | **obligatoire pour un 204** — le client dont la commande sera créée |
| `carrierId`     | **obligatoire pour un 210** — le transporteur facturant             |
| `url`           | destination des 214 sortants (livrés par l'outbox webhook)          |
| `format`        | `"x12"` — marque le récepteur public comme porte EDI                |

`customerId`/`carrierId` sont vérifiés par `OwnershipService` **à l'enregistrement** (règle 9) et
`url` passe le garde d'egress SSRF (`checkWebhookUrl`), comme une intégration `webhook*`.

**Entrée.** Deux portes, un seul service :

| Porte                              | Auth                                             | Corps                                                                                         |
| ---------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `POST /connect/edi/inbound`        | JWT + `core.connect.manage`                      | `text/plain` (+ en-tête `X-Integration-Key: edi-…`) **ou** JSON `{ integrationKey, content }` |
| `POST /public/hooks/:inboundToken` | jeton entrant (récepteur `config.format: "x12"`) | `text/plain` — même idempotence, même HMAC, même inbox que le récepteur JSON                  |

Nest n'enregistre que les parsers JSON/urlencoded : le middleware `rawTextBody` (ConnectModule)
bufferise les corps `text/*` en exposant `req.body` (chaîne) **et** `req.rawBody` (octets, pour
l'HMAC). Plafond 512 Ko.

**Privilège de configuration.** Armer un récepteur EDI, c'est accorder une écriture métier à une
porte anonyme : en plus de `core.integrations.manage`, l'utilisateur qui pose un `customerId` doit
détenir `transportation.orders.manage`, et celui qui pose un `carrierId`
`billing.freight-audit.manage` (403 sinon). Le contrôle s'applique à la **création**, à la **mise à
jour** (config fusionnée) **et** à l'émission du jeton entrant — exactement comme le gate
`config.target` des récepteurs JSON.

Réponse `202` : `{ inboxId, status: 'IMPORTED' | 'FAILED', transactionSetId, ack?, error?,
entityType?, entityId? }`.

**Idempotence — une seule clé pour les deux portes** : `InboundMessage.dedupKey =
"edi:<sha256(interchange détrimé)>"`, calculée à l'identique sur la porte authentifiée et sur la
porte publique. Un `X-Idempotency-Key` est volontairement **ignoré** en EDI : l'interchange EST
l'identité. Un renvoi répond `replayed: true` sans rien réécrire, et rejoue le **990 d'origine**
(conservé dans `parsed.ack`).

**Ce que le partenaire voit.** `error` (réponse HTTP **et** motif `K1` du 990) ne porte JAMAIS
qu'un refus délibéré (`EdiDeclineError` : module désactivé, FK absente, `B2-04` vide, doublon…).
Toute autre exception (service métier, ORM, runtime) est rendue génériquement
(`"Tender could not be processed"` / `"Interchange could not be processed"`) ; le détail complet
vit uniquement dans `InboundMessage.error` et dans les logs. Le motif partenaire est aussi mémorisé
(`parsed.publicError`) pour qu'un rejeu ne divulgue rien de plus.

Toute livraison est journalisée en `InboundMessage{ source: 'EDI', kind: 'edi' }`, attribuée au
service-account du tenant (règle 13) et auditée (règle 6).

**204 → commande de transport.** `read204` → `TransportOrdersService.create` en **DRAFT** pour
`config.customerId`, numérotée par `SequencesService` (règle 8). Origine = premier arrêt `PICKUP`,
destination = **dernier** arrêt `DELIVERY`. Les adresses deviennent des `Location`
`CUSTOMER_SITE` créées via `core/locations` sous le code déterministe
**`EDI-<sha1(adresse normalisée)[0..12]>`** : re-tendre la même voie réutilise la même fiche. Les
poids en livres (`L`) sont convertis en kilogrammes ; les fenêtres viennent des `G62`
(qualificatifs 10/37/53/64/69/78 = au plus tôt, 38/54/65/70/77 = au plus tard).

**990 (notre réponse).** Toujours renvoyé dans `ack` :

- succès → `B1-04 = 'A'` + un `N9*CN` portant le numéro de commande créé ;
- refus → `B1-04 = 'D'` + le motif en `K1` (≤ 60 caractères) et `InboundMessage` `FAILED`.
  Motifs de refus : module Transportation désactivé (règle 15), `customerId` absent ou inconnu,
  `B2-04` vide, aucun ramassage ou aucune livraison, ville d'arrêt manquante (`N4`).
  Un interchange **structurellement** cassé (ISA illisible, `IEA` manquant, `SE01`/numéros de
  contrôle incohérents) est refusé **sans** 990 : on ne peut pas acquitter ce qu'on n'a pas lu.

**210 → facture transporteur.** `read210` → `FreightAuditService.create` (`sourceRef: 'edi-210'`)
avec une ligne par boucle `LX` (`lineRef` = code de charge `L1-08`, sinon n° de ligne), montants en
`N2` (2 décimales implicites) et devise `C3-01`. Le module **Billing** est re-vérifié dans le
service (règle 15) ; `carrierId` manquant/inconnu ⇒ `FAILED`. Aucune variance n'est calculée ici :
le service compare ensuite au `Load.estimatedCost` figé (règles 16/31). Pas de 990 pour un 210.

**Doublon de facture.** En plus du hash d'interchange, un garde sur la **clé métier**
`(tenantId, carrierId, carrierInvoiceNumber)` refuse une facture déjà reçue :
`Duplicate carrier invoice <n°>` (`FAILED`). Un transporteur qui renvoie la même facture dans une
nouvelle enveloppe (nouveau numéro de contrôle ISA, nouvelle date) ne crée donc pas un second
payable. Aucune migration : c'est un `findFirst` avant création.

**214 (sortant).** `GET /transportation/shipments/:id/edi/214?integrationKey=edi-…`
(`@RequireModule(TRANSPORTATION)` + `transportation.tracking.read`) renvoie l'interchange brut en
`text/plain`. Les statuts viennent des `TrackingEvent` de l'expédition (ordre chronologique,
projection partagée avec le portail — règle 10/20), traduits en codes AT7 par
`at7ForTrackingEvent`, puis clos par le statut courant (`at7ForShipmentStatus`) s'il diffère du
dernier. `MS1` porte la ville d'origine ou de destination selon le côté de l'AT7 ; `MS2` le SCAC du
transporteur et le n° de remorque. Références `L11` : commande (`CN`), référence client (`PO`),
load (`SI`).

`POST /transportation/shipments/:id/edi/214/send?integrationKey=edi-…`
(`transportation.tracking.write`) met le même message dans **l'outbox webhook** existante
(`format: 'x12'` ⇒ corps `text/plain` = `data.x12`, signature `X-Pulsar-Signature`, 5 tentatives
avec backoff). Requiert `config.url`.

**Limites v1** :

- un seul GS/ST par interchange **émis** (limite de la couche pure) ;
- **seule la première transaction d'un interchange entrant est traitée** — un lot multi-ST est lu
  intégralement mais les ST suivants sont ignorés ;
- **un 204 `CANCELLATION`/`CHANGE` est traité comme un `ORIGINAL`** : `B2A-01` est lu par la couche
  pure mais pas exploité, chaque interchange distinct crée une commande (le même interchange rejoué
  reste idempotent) ;
- séparateur de répétition détecté mais non appliqué ; composites non éclatés ;
- motif `K1` tronqué à 60 caractères ;
- **aucun fuseau horaire** : les dates X12 sont rendues telles quelles et interprétées en heure
  locale du serveur ;
- pas d'AS2/VAN ni de 997 ;
- les numéros de contrôle sortants (ISA13/GS06) sont dérivés de l'horloge, pas d'un compteur
  persisté ;
- plafonds de corps : **512 Ko** sur la porte authentifiée, **256 Ko** (comme le JSON) sur la porte
  publique — rien n'est connu de l'intégration avant la bufferisation.

### Clés API partenaires

`POST /api-keys` (permission `core.api-keys.manage`) returns the full key **once**
(`pk_…`, SHA-256 hash at rest). Requests authenticate with the `X-Api-Key` header instead of a
JWT; the key carries its own scope list (read **and** write). Key requests act as the tenant's
hidden **service account** user (`service-account@pulsar.local`, status DISABLED — can never
sign in), so write paths get a real user id for audit/FK attribution. Revocation is immediate;
`lastUsedAt` is stamped on use.

**Expiration (optionnelle).** `POST /api-keys` accepte un `expiresAt` (date future, sinon 400).
Passé cette date, la clé est refusée avec **exactement le même** `401 Invalid API key` qu'une clé
inconnue ou révoquée — un client ne peut pas distinguer les trois cas. L'UI
(`Réglages → Clés API`) saisit une date et envoie la **fin de journée locale** du navigateur, et
affiche une pastille « Expirée » sur les lignes concernées.

**Modèles de portée** (`API_KEY_SCOPE_PRESETS`, `@pulsar/shared`, pure data) — pré-remplissent les
cases de permissions à la création, toujours ajustables ensuite :

| Modèle              | Portées                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `read-only`         | toutes les permissions `*.read` du catalogue (**calculé**, jamais listé à la main)                  |
| `orders-intake`     | `transportation.orders.manage`, `transportation.master-data.read`, `core.locations.read`            |
| `tracking`          | `transportation.tracking.read`                                                                      |

**Swagger.** `/api/docs` déclare désormais le schéma `api-key` (en-tête `x-api-key`,
`DocumentBuilder().addApiKey(...)`) à côté du bearer JWT — un partenaire lit la surface REST sans
qu'on lui explique l'en-tête à la main.

### Flux iCal — rendez-vous de quai (module Yard)

`POST /yard/ical-token` (`@RequireModule(YARD)` + `yard.manage`, audité) génère 24 octets
base64url stockés dans `TenantModule.settings.icalToken` (module `yard`) et renvoie
`{ token, url }` — l'URL est construite depuis la configuration (`API_URL`), jamais depuis
l'en-tête `Host` de la requête. `GET /yard/ical-token` (`yard.read`) renvoie seulement
`{ hasToken, rotatedAt? }` — **jamais** le jeton : la page de configuration sait donc qu'un lien
existe après un rechargement et demande confirmation avant de le régénérer. Régénérer invalide
l'ancien lien immédiatement.

`GET /public/ical/yard/:token` (`@Public()`) renvoie un `text/calendar; charset=utf-8` des
rendez-vous de quai des **90 prochains jours** (hors `CANCELLED`/`NO_SHOW`), à abonner dans
Outlook/Google Calendar. Le corps est produit par `buildIcs` (`@pulsar/shared`, pur, RFC 5545 :
CRLF, pliage à 75 octets sur les points de code, échappement `\`/`,`/`;`/saut de ligne, dates UTC
`YYYYMMDDTHHMMSSZ`). Projection d'affichage seulement (règle 10) : créneau, quai (`spot.code`),
transporteur, remorque au mieux — jamais d'id interne ni de `tenantId`. Jeton inconnu, ligne
`TenantModule` désactivée ou module Yard désactivé donnent tous le même `404`.

## Declarative audit

`@Audit(entityType, action)` on a handler + the global `AuditInterceptor` log the action with
the response `id` after success. Applied to master-data create/update endpoints; workflow
services keep their explicit `AuditLogsService` calls because they record before/after state.
API-key principals are logged without a userId (they are not User rows).

## Customer Portal module

Second business module — proves per-tenant modularity end to end. Management endpoints
(`/customer-portal/customers/:id/portal-link`) sit behind
`@RequireModule(MODULE_KEYS.CUSTOMER_PORTAL)`; the public page (`GET /public/portal/:token`,
web `/portal/[token]`) re-checks module activation in the service because public routes bypass
ModulesGuard. Disabling the module instantly kills both the management API and every issued
portal page. v2 adds **order entry**: `POST /public/portal/:token/orders` lets the customer
submit a transport request that lands as a DRAFT order (no creator user — portal-born, audited
with `source: customer-portal`); the portal view exposes the tenant's active locations
(id/name/city only) for that purpose.

## Billing module (carrier settlement v1)

Third business module. `POST /billing/invoices/draft { carrierId }` bundles the carrier's
COMPLETED, not-yet-invoiced loads (with an estimated cost) into a DRAFT invoice
(`INV-000001`); `InvoiceLine.loadId` is unique, so a load can never be billed twice.
`GET /billing/invoices/billable?carrierId=` previews the next draft;
`POST /billing/invoices/:id/approve` freezes it. Permissions `billing.invoices.read|manage`,
controllers gated by `@RequireModule(MODULE_KEYS.BILLING)`. Customer invoicing and payment
tracking come later.

## Identity flows

- **Invitation**: `POST /users` without a password creates an INVITED account, emails a one-shot
  72 h link (`/reset-password/:token`) and returns `inviteUrl` to the admin. The account cannot
  sign in until the password is set.
- **Password reset**: `POST /auth/forgot-password` (always 200 — no account enumeration) emails a
  1 h link; `POST /auth/reset-password` consumes the token (single use), activates the account if
  INVITED, and revokes every active refresh token of the user.
- Tokens live in `user_action_tokens` (SHA-256 hash at rest).

## Carrier scorecard

`GET /transportation/analytics/carriers` (permission `transportation.analytics.read`):
completed/active loads, tender acceptance rate (accepted/responded), on-time delivery %
(actual ≤ planned), estimated spend. Computed on read — pre-aggregation can wait for real volume.

## Driver BOL (public, phase 8)

`GET /api/v1/public/driver/:token/bol` — streams the latest Bill of Lading PDF for the load
identified by `Load.driverToken`. The driver token is the only credential; the internal load id
and document id are **never** exposed in the public payload (they are resolved server-side).

Responses:

- `200 application/pdf` — binary stream, `Content-Disposition: attachment; filename=<BOL-number>.pdf`.
- `404` — token unknown, or no BOL has been generated for this load yet.

This endpoint is `@Public()` (skips `JwtAuthGuard`, `ModulesGuard`, `PermissionsGuard`). It
re-validates the token on every call (same revocation semantics as other driver endpoints).
Generating the BOL first requires `POST /loads/:id/bol` (authenticated, DISPATCHED+ only).
