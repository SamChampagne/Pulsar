# Pulsar — Product Specification

_Status: living document. Version 0.1 — foundation phase._

## 1. Vision

Pulsar is a **modular logistics operating platform** sold as B2B SaaS. Rather than a monolithic
TMS, Pulsar is a **platform core** (tenants, identity, RBAC, audit, documents, notifications,
integrations, module registry) on which **business modules** are activated per customer:

| Module                    | Status      | Scope                                                       |
| ------------------------- | ----------- | ----------------------------------------------------------- |
| Core                      | ✅ Built     | Tenancy, users, roles/permissions, audit, modules registry  |
| **Transportation (TMS)**  | 🚧 Building | First commercial module — manufacturing TMS                 |
| Fleet                     | Planned     | Asset lifecycle, maintenance, compliance                    |
| Yard                      | Planned     | Gate check-in/out, dock scheduling, yard moves              |
| Light WMS                 | Planned     | Receiving, putaway, picking                                 |
| Customer Portal           | Planned     | Self-service order entry & visibility for shippers' clients |
| Analytics                 | Planned     | KPIs, carrier scorecards, cost analysis                     |
| Billing                   | Planned     | Freight billing, invoicing, carrier settlement              |

Inspirations: **Fleetbase** (modular LSOS), **Oracle TM** (order release → shipment → rate
offering → itinerary → carrier selection), **SAP TM** (freight unit → freight order → planning →
execution).

## 2. Target customer (module 1)

Mid-size **manufacturers and distributors** (50–5000 shipments/month) that:

- ship from a small number of plants/warehouses to many customer sites,
- use a mix of contracted carriers and spot freight,
- run dispatch on spreadsheets/email today,
- need order-to-POD visibility without an OTM/SAP-scale implementation.

## 3. Domain model (Transportation)

The TMS follows a classical demand → planning → execution decomposition:

| Concept            | Pulsar entity    | OTM analog     | SAP TM analog  |
| ------------------ | ---------------- | -------------- | -------------- |
| Customer demand    | `TransportOrder` | Order Release  | Forwarding Ord.|
| Planning unit      | `Shipment`       | Shipment       | Freight Unit   |
| Carrier execution  | `Load`           | Shipment (buy) | Freight Order  |
| Stop sequence      | `Route` / `Stop` | Itinerary      | Stages         |
| Pricing            | `Rate`           | Rate Offering  | Agreement      |
| Visibility         | `TrackingEvent`  | Tracking Event | Event          |
| Delivery proof     | `ProofOfDelivery`| POD            | POD            |

Master data: `Customer`, `Location`, `Carrier`, `Driver`, `Vehicle`, `Trailer`.

### Lifecycle

```
TransportOrder: DRAFT → CONFIRMED → PLANNED → IN_EXECUTION → COMPLETED → CLOSED
                                  (CANCELLED from any pre-execution state)
Shipment:       PENDING → PLANNED → DISPATCHED → IN_TRANSIT → DELIVERED → CLOSED
Load:           OPEN → PLANNED → DISPATCHED → IN_TRANSIT → COMPLETED
```

Workflow target: **TransportOrder → Shipment → Load → Route → Dispatch → In Transit → Delivered → Closed.**
State machines live in `packages/shared/src/workflows` and are enforced server-side.

## 4. Functional scope v1 (MVP)

1. **Master data**: CRUD customers, locations, carriers, drivers, vehicles, trailers, rates.
2. **Order management**: create/confirm/cancel transport orders; plan → generates shipment.
3. **Planning**: build loads, assign shipments to loads, assign carrier/driver/vehicle/trailer/rate,
   build the route (ordered pickup/delivery stops).
4. **Execution**: dispatch, in-transit, stop arrival/departure, delivery, POD capture.
5. **Visibility**: tracking event timeline per load/shipment.
6. **Platform**: multi-tenant auth (JWT), roles & permissions, per-tenant module activation,
   audit trail on key mutations.

Out of scope v1 (see ROADMAP): optimization/auto-planning, EDI, telematics ingestion, customer
portal, invoicing, multi-leg routing, document storage backend.

## 5. Non-functional requirements

- **Tenancy**: strict tenant isolation at the application layer; design migrable to
  schema-per-tenant if a customer requires it.
- **Auth**: JWT now; architecture must accept SSO (OIDC/SAML) later without re-platforming
  (auth issuance isolated in `core/auth`).
- **API**: versioned REST (`/api/v1`), OpenAPI published, consistent pagination/error envelopes.
- **Auditability**: status changes and sensitive mutations recorded in `audit_logs`.
- **Extensibility**: a new module = new Prisma models + new NestJS module + permission keys +
  module catalog entry. No core changes required.

## 6. Commercial model (assumption to validate)

- Per-tenant subscription, priced by module + active users.
- Modules toggled per tenant via the module registry (already implemented).
