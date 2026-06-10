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
  Tender PENDING ──expiresAt past───▶ EXPIRED    (lazy, on next public read; load → PLANNED)
```

`LoadsService.dispatch` refuses a TENDERED load without an ACCEPTED tender. Cancelling a load
cancels its pending tender. Responses emit tracking events and webhooks
(`tender.sent|accepted|declined`). Email delivery of the link is **not** implemented yet — the
UI copies the link to the clipboard (see TODO).

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

## Webhooks (v0)

`WebhooksService.emit(tenantId, event, data)` POSTs to every ENABLED integration whose key
starts with `webhook`. Config JSON: `{ "url", "secret"?, "events"?: [] }`. Signature:
`X-Pulsar-Signature: sha256=HMAC(secret, body)`. Events today: `tender.sent`,
`tender.accepted`, `tender.declined`, `load.dispatched`, `load.completed`.
Fire-and-forget with 5 s timeout — a durable outbox with retries is phase 3.

## Carrier scorecard

`GET /transportation/analytics/carriers` (permission `transportation.analytics.read`):
completed/active loads, tender acceptance rate (accepted/responded), on-time delivery %
(actual ≤ planned), estimated spend. Computed on read — pre-aggregation can wait for real volume.
