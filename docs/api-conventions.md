# API conventions

Base URL: `/api/v1`. OpenAPI/Swagger served at `/api/docs`.

## Authentication

- `POST /auth/login` → `{ accessToken (15 min), refreshToken (30 d), user, tenant }`.
- `POST /auth/refresh` rotates the refresh token and returns a new pair (permissions re-read
  from the DB). `POST /auth/logout` revokes it.
- All other endpoints require `Authorization: Bearer <accessToken>` unless marked `@Public()`.
- The JWT carries `sub` (user id), `tenantId`, `email`, `permissions[]`.

## Public namespace

`/public/**` endpoints are token-authenticated (capability links), not JWT-authenticated:
tender response, shipment tracking, driver stop/POD operations. The token in the URL is the
credential; payloads never expose tenant internals. See [collaboration.md](./collaboration.md).

## Resources

- Plural kebab-case nouns: `/transportation/transport-orders`, `/users`, `/audit-logs`.
- Business modules are namespaced by module key: `/transportation/...`.
- Standard verbs: `GET` (list/detail), `POST` (create), `PATCH` (partial update),
  `DELETE` (delete/deactivate).
- **Workflow actions are explicit sub-resources**, not status PATCHes:
  `POST /transportation/transport-orders/:id/confirm | plan | cancel | close`,
  `POST /transportation/loads/:id/assign | dispatch | start-transit | complete | cancel`.
  Rationale: transitions have side effects and validation; a raw `status` field would bypass the
  state machine.

## Pagination & filtering

List endpoints accept `page` (default 1), `pageSize` (default 25, max 100), `search`, plus
resource-specific filters (e.g. `status`). They return:

```json
{ "items": [...], "total": 123, "page": 1, "pageSize": 25 }
```

## Errors

Standard NestJS envelope:

```json
{ "statusCode": 400, "message": "Invalid transition DRAFT → CLOSED", "error": "Bad Request" }
```

- `400` validation / invalid workflow transition
- `401` missing/expired token
- `403` missing permission or module not enabled for the tenant
- `404` not found **within the caller's tenant** (cross-tenant ids look like 404, never 403)
- `409` uniqueness conflicts (duplicate code, POD already exists…)

`message` may be a string array for field validation errors. A machine-readable `code` field is
planned (phase 1).

## Conventions for new endpoints

- Controller: `@ApiTags`, `@ApiBearerAuth`, `@RequirePermissions(...)` (and `@RequireModule` on
  business modules at class level).
- Take `tenantId`/`user.id` from `@CurrentUser()`; never from the payload.
- DTOs validated with class-validator; unknown fields are rejected globally
  (`forbidNonWhitelisted`).
- Dates: ISO-8601 strings in/out (UTC).
