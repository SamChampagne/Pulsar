# Accounts And Multi-Tenant Foundation

PlaniAdvance now has a minimal account model that can support a future SaaS or
multi-company deployment without coupling the APS engine to authentication
details.

## Current Model

- `Organization`: tenant boundary for a company, plant group, or customer.
- `UserAccount`: human user identity placeholder.
- `Membership`: user-to-organization link with role.
- `Workspace.organization_id`: optional tenant ownership for planning spaces.

Roles:

- `owner`
- `admin`
- `planner`
- `viewer`

## MVP API

- `GET /accounts/organizations`
- `POST /accounts/organizations`
- `GET /accounts/users`
- `POST /accounts/users`
- `GET /accounts/organizations/{organization_id}/memberships`
- `POST /accounts/organizations/{organization_id}/memberships`
- `GET /accounts/users/{user_id}/memberships`
- `GET /accounts/organizations/{organization_id}/workspaces`

This is an account foundation, not full authentication yet. No password,
session, JWT, OAuth, or user login flow is stored here.

## Tenant Context Headers

Requests can declare who is acting and for which tenant via two optional
headers:

- `X-Organization-Id`: scopes the request to a specific organization.
- `X-User-Id`: identifies the acting user; requires `X-Organization-Id`
  and a matching active `Membership`.

Behavior:

- No headers -> unscoped local/dev behavior (all data visible).
- `X-Organization-Id` + `X-User-Id` -> reads filter to that tenant; writes
  default their `organization_id` to that value; cross-tenant payloads are
  rejected (403).
- `X-Organization-Id` without `X-User-Id` -> 400.
- Unknown `X-Organization-Id` -> 404.
- `X-User-Id` without `X-Organization-Id` -> 400.
- `X-User-Id` without active membership in the organization -> 403.

The resolution happens in `api/tenant.py::get_tenant_context`. This is
the single seam where a real authentication layer (JWT, session, ERP
token) will be plugged in later. The header-based form is good enough
for internal tools, server-to-server calls, and tests.

Currently applied to:

- `GET|POST /workspaces`, `GET /workspaces/{id}`
- `GET|POST /work-orders`, `GET|DELETE /work-orders/{id}`
- `GET|POST /machines`, `GET|DELETE /machines/{id}`

Scheduling run/compare/CTP/disruption now scope work orders and machines to
the tenant. Other workshop routes (resources, calendars, inventory, supplies,
persisted scheduling runs) do not yet fully honor the context - that is the
next extension point.

## Design Intent

The APS engine should remain tenant-agnostic. Tenant boundaries belong in the
API/application/infrastructure layers through IDs, repositories, and access
checks. This keeps scheduling strategies reusable for single-plant installs,
on-prem deployments, and future SaaS.

## Next Steps

- Extend organization scoping to resources, calendars, inventory, supplies, and scheduling runs.
- Replace header-based identity with a real auth mechanism (JWT/session/API key -> user mapping).
- Decide whether accounts are local, OAuth-backed, or ERP/SSO-backed.
- Add audit events for user/account actions.
