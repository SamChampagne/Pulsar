# Platform administration plane

Cross-tenant operations for Pulsar staff: create tenants, provision their first
admin, suspend/re-activate them and toggle modules — without touching the seed.
Shipped in phase 6.

## Who is a platform admin

A platform admin is a normal `User` carrying the boolean flag
`User.isPlatformAdmin`. We deliberately did **not** model platform staff as
out-of-tenant principals: every guard, audit row and service in the codebase
assumes `user.tenantId` is present, and making it nullable would ripple through
the whole isolation model. Instead:

- Platform staff live in a dedicated **`platform` tenant** (seeded), like any
  other user, so `tenantId` stays non-null everywhere.
- The flag grants extra power **only** through the `/platform/*` endpoints; in
  every other part of the app a platform admin is just a normal user of the
  `platform` tenant.

Seeded account: `platform@pulsar.dev` / `platform123`.

## How the gate works

```
JwtAuthGuard → PlatformAdminGuard → ModulesGuard → PermissionsGuard
```

- `@PlatformAdmin()` (class-level on `PlatformController`) marks the platform
  plane. `PlatformAdminGuard` lets every non-marked route through untouched and,
  for marked routes, requires `user.isPlatformAdmin`.
- The flag is carried in the JWT (`platformAdmin: true`), mirroring how
  permissions are embedded. **Revoking platform access takes effect at the next
  token refresh** (≤15 min) — same trade-off as permissions (see CLAUDE.md).
- Platform routes are intentionally **not** module-gated and **never** read the
  caller's `tenantId`: they take an explicit `:id`/`:tenantId`. Per-tenant
  isolation elsewhere is therefore unaffected — the plane is purely additive.

## Endpoints

All under `/api/v1/platform`, all gated by `@PlatformAdmin()`:

| Method & path                     | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `GET /overview`                   | Platform-wide counts (tenants/active/suspended/…). |
| `GET /tenants`                    | Paginated tenant list (`search`, counts, modules). |
| `POST /tenants`                   | Provision tenant + admin + modules (see below).    |
| `GET /tenants/:id`                | Tenant detail with the full module matrix.         |
| `PATCH /tenants/:id`              | Rename a tenant.                                   |
| `POST /tenants/:id/suspend`       | Suspend — blocks **all** logins for the tenant.    |
| `POST /tenants/:id/activate`      | Re-activate a suspended tenant.                    |
| `PATCH /tenants/:id/modules/:key` | Enable/disable a business module for the tenant.   |

### Tenant provisioning

`POST /platform/tenants` runs the same recipe as the seed, in a single
transaction:

1. create the tenant (`status` defaults to `TRIAL`);
2. enable `core` + every requested (available) module;
3. create a full-access `admin` system role;
4. create the initial administrator and attach the role.

The admin's password is optional: omit it and the account is created `INVITED`
with a one-shot 72 h activation link, emailed and also returned as `inviteUrl`
(same flow as user invitations). Slugs are unique platform-wide and validated
(`^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`); duplicates return `409`.

### Suspension

`Tenant.status = SUSPENDED` is enforced at login (`AuthService.login` already
rejects suspended tenants). Existing access tokens still work until they expire
(≤15 min) but cannot be refreshed once the owning user's tenant is suspended —
acceptable for an admin-grade kill switch; tighten later if needed.

## Audit

Tenant create / rename / status change / module toggle all call
`AuditLogsService.log` under the **target** tenant's id with the acting platform
admin's user id, so each tenant's audit trail records who provisioned or
suspended it.

## Web

`/(app)/platform/tenants` (list + create form) and `/(app)/platform/tenants/[id]`
(lifecycle + module matrix). The "Platform" nav section is shown only when
`$auth.user.isPlatformAdmin` is true.
