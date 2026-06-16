# Client Software Connection Flow — Spec

> Companion spec for `packages/shared/src/integrations/connector-foundation.ts`. Written so Claude can continue Light WMS while understanding how WMS should connect to the broader Integration Operating Layer.

## North star

A client should be able to connect business software to Pulsar without giving an agent unrestricted API access.

```text
Client software
→ connector blueprint
→ capabilities selected
→ field mapping
→ sandbox evidence
→ monitored activation
→ agent/tool policy gate
→ ProposedAction / audit for risky writes
```

## Why not start with a node graph?

A node graph/workflow designer is a later surface. The first durable primitive is the connector contract:

- which provider is connected;
- how it authenticates;
- what it can read/write;
- which fields are mapped;
- what was tested;
- whether an agent can use it directly.

A visual graph can later compose those primitives. Starting with the graph would hide missing auth, mapping, evidence, and policy decisions.

## Provider blueprints v1

Defined in shared as browser-safe data. Each blueprint separates read-first `defaultCapabilities` from broader `supportedCapabilities` so writes exist in the contract but are never selected by default.

- `odoo` — ERP source of truth.
- `quickbooks` — accounting/billing target.
- `warehouse-wms` — bridge for Light WMS and external warehouse systems.
- `custom-api` — client-specific APIs.
- `webhook` — inbound real-time events.
- `csv-import` — PME-friendly import path when no API exists.

These are not database rows yet. They are the vocabulary that API/UI/WMS can share.

## Capability vocabulary v1

Capabilities are intentionally explicit. The shared readiness summary checks the provider's `recommendedFirstSync` list first, not only the user-selected capabilities. That is deliberate: if QuickBooks recommends `payments.read` for a safe accounting baseline, the onboarding UI can show it as a missing recommended mapping even before the client enables advanced write capabilities.

```text
customers.read / customers.write
orders.read / orders.write
shipments.read / shipments.write
invoices.read / invoices.write
payments.read / payments.write
inventory.read / inventory.write
receiving.read / receiving.write
picking.read / picking.write
webhooks.receive
files.import
```

Guideline:

- `.read` means pull/import/observe, not external mutation.
- `.write` means Pulsar or an agent may mutate an external/system-of-record workflow.
- `webhooks.receive` and `files.import` are treated as read-like ingestion capabilities.

## Risk and approval model

Capabilities map to risk:

- `read`: direct allowed when connector and agent are scoped.
- `low_write`: can become auto-executable in a low-risk policy.
- `controlled_write`: should normally create a `ProposedAction`.
- `sensitive_write`: human approval by default.

Initial helper:

```ts
requiresApprovalForCapability(capability)
```

Current default:

- read/import/receive → no approval;
- orders/inventory/receiving/picking writes → approval by default;
- invoice/payment writes → sensitive approval by default.

## Agent gate

Agent access is not “has API key = allowed”. It is an intersection:

```text
connectorStatus === ENABLED
AND healthState in [ready, live]
AND connectorCapabilities includes requestedCapability
AND agentAllowedCapabilities includes requestedCapability
AND policy allows direct use
```

If a write is not directly allowed, the product path should be:

```text
agent proposes → ProposedAction → human/policy approval → audited execution
```

## Client onboarding sequence

The safe order is:

1. `select-provider`
   - client chooses Odoo/QuickBooks/WMS/API/Webhook/CSV;
   - Pulsar assigns an owner.
2. `authenticate`
   - OAuth/API key/basic/webhook/file import;
   - future API must encrypt secrets.
3. `choose-capabilities`
   - read-first; writes explicit.
4. `map-fields`
   - external fields → Pulsar canonical models.
5. `run-sandbox-test`
   - execute pull/webhook/import in controlled mode;
   - capture evidence.
6. `activate-with-monitoring`
   - health, last success, failure rate, rollback/disable path.

## Pull vs webhook vs CSV

Use all three where appropriate:

- **Pull**: reconciliation and source-of-truth import.
- **Webhook**: real-time trigger, never sole truth for critical records.
- **CSV/import**: onboarding path for PME without APIs.

All should feed the same future event/evidence path.

## WMS handoff for Claude

Light WMS should not invent a separate integration language. It can align with these capabilities:

- `inventory.read`: inventory visibility from WMS/external warehouse.
- `inventory.write`: controlled stock adjustment or sync-back.
- `receiving.read`: inbound/receiving status visibility.
- `receiving.write`: create/update receiving workflow.
- `picking.read`: pick list / status visibility.
- `picking.write`: release/confirm/adjust picking workflow.

Suggested WMS rule:

```text
Internal Pulsar WMS action = normal module permission + audit.
External WMS connector action = integration capability + agent gate + ProposedAction when risky.
```

## Future persistence sketch

After WMS merge, possible schema objects:

```text
IntegrationConnection
- tenantId
- providerKey
- status
- ownerUserId
- authMode
- encryptedCredentialRef/config
- enabledCapabilities Json/String[]
- mappedCapabilities Json/String[]
- testedCapabilities Json/String[]
- lastSuccessAt
- lastFailureAt
- disabledAt

IntegrationMapping
- connectionId
- capability
- externalObject
- fieldMap Json
- version

IntegrationEvidence
- connectionId
- capability
- sandbox/live
- payloadSummary Json
- resultSummary Json
- createdAt
```

Do not add these until the WMS schema has landed to avoid migration churn.

## Acceptance criteria for next API/UI slice

A future `Connect software` wizard should be considered usable only when:

- provider blueprint appears;
- owner is required;
- credentials are never returned to browser;
- capabilities can be selected;
- mapping is required before activation;
- sandbox test produces evidence;
- agent writes route through `ProposedAction` unless policy explicitly allows them;
- connector health appears in `/integrations`.
