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

Current senders: tender links to carriers (`tenders.service.ts`), user invitations and password
resets (`users.service.ts` / `auth.service.ts`), delivered notifications to the order's customer
contact (`loads.service.ts`). Tender responses include `emailedTo` so callers/tests know whether
the email was handed to the driver.

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
then FAILED). Config JSON: `{ "url", "secret"?, "events"?: [] }`. Headers:
`X-Pulsar-Signature: sha256=HMAC(secret, body)`, `X-Pulsar-Event`, `X-Pulsar-Delivery`.
Events: `tender.sent|accepted|declined|expired`, `load.dispatched|completed`.
Inspect deliveries: `GET /integrations/:id/deliveries`.

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
