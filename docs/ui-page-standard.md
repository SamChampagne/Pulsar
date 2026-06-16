# Pulsar UI page standard

Every Pulsar app page must answer three questions before it shows a table, form, board, or empty state.

## The three questions

1. **Where am I?**
   - Use a concrete page title plus a one-sentence business subtitle.
   - Avoid internal implementation language, inspiration notes, or generic SaaS copy.
   - Example: `Shipments` + `Plan confirmed freight into loads and keep unplanned work visible.`

2. **What matters here right now?**
   - Surface 3–5 page-level signals: totals, open work, overdue/risk states, pending approvals, or active objects.
   - These are not decorative counters. They should help the operator decide where to look first.
   - For empty data, show zero-state signals that explain the workflow rather than leaving a blank grid.

3. **What should I do next?**
   - Provide one primary action and, when useful, one secondary route into the upstream/downstream workflow.
   - Empty states must include a next step, not just `No records yet`.
   - Error states must preserve orientation and offer retry/next action where possible.

## Required page shape

Use this order unless the page is a specialized cockpit like Dispatch:

```svelte
<PageHeader
  title="Shipments"
  subtitle="Plan confirmed freight into loads and keep unplanned work visible."
  count={total}
>
  {#snippet actions()}
    <Button>Primary action</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
  <!-- 3–5 metric cards answering: what matters here now? -->
</div>

<FilterBar>...</FilterBar>

<Table>...</Table>
<!-- EmptyState must answer what happens next. -->
```

## Standard components

- `PageHeader`: answers **Where am I?** with title/subtitle/count/actions.
- `Card`: neutral container for metrics and workflow explanation.
- `EmptyState`: must include `title`, `message`, and usually an action snippet.
- `ErrorNotice`: replaces raw `Internal Server Error` text. Keep pages stable even when the API fails.
- `FilterBar`: belongs after the page signals, not before the user understands the page.

## CRUD page rules

CRUD pages are still operational pages. Do not ship a table-only page.

Each CRUD page needs:

- A business subtitle explaining the object’s role in the TMS workflow.
- Signals derived from currently loaded rows where possible.
- An empty state with the upstream/downstream action:
  - Transport Orders → create order, then confirm/plan into shipments.
  - Shipments → confirm orders or send unplanned shipments to Dispatch.
  - Loads → build from shipments in Dispatch, then tender/dispatch.
  - Customers → add customers before orders/portal links.
  - Carriers → add carriers before tendering loads.
  - Accessorials/Rates/Fuel → configure pricing before rating/audit automation.

## Copy rules

- Prefer logistics language over generic admin language: `Plan`, `Tender`, `Dispatch`, `Resolve`, `Approve`, `Sync`.
- Avoid meta copy: no `inspired by`, `prototype`, `mock`, `current version`, or implementation notes in user-visible UI.
- Choose one product language per surface. Do not mix French section names with English item names unless intentionally localizing the whole product.

## Error states

Never render raw API errors alone. Use:

```svelte
<ErrorNotice message={error} onretry={load} />
```

The page shell, header, metrics skeleton, filters, and empty-state guidance should remain visible.

## Specialized cockpit pages

Dispatch, Dashboard, Workbench, Agents, Agent Actions, and Integrations can use richer layouts, but they still must answer the three questions:

- Dashboard: what needs attention today?
- Dispatch: what freight can be planned/executed now?
- Workbench: what exception should be triaged next?
- Agent Actions: what action is waiting for human approval, with evidence/risk?
- Agents: which AI employees are healthy, paused, or blocked?
- Integrations: which systems are connected and what operational flow is missing?
