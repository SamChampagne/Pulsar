# Collaboration layer — tokenized public access

How external actors (carriers, drivers, end customers) interact with Pulsar **without an
account**: design, security model and endpoints. Functional walkthrough:
[guide-fonctionnel.md](./guide-fonctionnel.md) §5.

## Design

Three kinds of capability links, each carrying the narrowest possible scope:

| Link    | Token lives on       | Grants                                            | Revocation                      |
| ------- | --------------------- | ------------------------------------------------- | ------------------------------- |
| Tender  | `Tender.token`        | View load summary; accept or decline **once**     | Cancel tender / expiry (lazy)   |
| Tracking| `Shipment.trackingToken` | Read-only status page (no tenant internals)    | `DELETE /shipments/:id/share`   |
| Driver  | `Load.driverToken`    | Stop ARRIVED/DEPARTED + POD (+photo) on that load | `DELETE /loads/:id/driver-link` |
| Portal  | `Customer.portalToken`| Read-only order/shipment list for one customer (customer-portal module) | `DELETE /customer-portal/customers/:id/portal-link` |

Principles:

- Tokens are 24 random bytes (base64url, `node:crypto`), stored in plain text — they are
  *capabilities*, not credentials; revocation is a column update.
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

| Channel | Wording | Gating | Source |
| ------- | ------- | ------ | ------ |
| Tender link to carrier | — | carrier has email address | `tenders.service.ts` |
| User invitation | — | always sent | `users.service.ts` |
| Password reset | — | always sent | `auth.service.ts` |
| Delivered notification | — | order has customer contact email | `loads.service.ts` |
| Billing statement | `Billing statement <CINV-number>` | customer has email; `EmailService.send` must return `true`; statement must be APPROVED | `customer-invoices.service.ts` |

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

## Webhooks (durable outbox)

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

## Inbound API keys

`POST /api-keys` (permission `core.api-keys.manage`) returns the full key **once**
(`pk_…`, SHA-256 hash at rest). Requests authenticate with the `X-Api-Key` header instead of a
JWT; the key carries its own scope list (read **and** write). Key requests act as the tenant's
hidden **service account** user (`service-account@pulsar.local`, status DISABLED — can never
sign in), so write paths get a real user id for audit/FK attribution. Revocation is immediate;
`lastUsedAt` is stamped on use.

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
