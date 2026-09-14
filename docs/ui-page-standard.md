# Pulsar UI page standard

Every Pulsar app page must answer three questions without delaying access to its working surface.
The iPhone-style app desktop remains the entry point. The shared workspace owns navigation,
app switching, search and user preferences; pages must not duplicate those controls.

## The three questions

1. **Where am I?**
   - Use one concrete page title. Add a short business subtitle only when it clarifies the task.
   - Avoid internal implementation language, inspiration notes, or generic SaaS copy.
   - Example: `Shipments` + `Plan confirmed freight into loads and keep unplanned work visible.`

2. **What matters here right now?**
   - Surface only actionable signals: open work, overdue/risk states, pending approvals or active objects.
     There is no minimum number of metric cards. A count beside the title may be enough.
   - These are not decorative counters. They should help the operator decide where to look first.
   - Distinguish loading, unavailable data and genuinely empty data. Never represent a failed request as zero.

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

<!-- Optional compact signals, only when they help decide the next action. -->

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

CRUD pages are operational pages. A clear header, useful filters and a table can be sufficient.

Each CRUD page needs:

- A clear object title and optional subtitle explaining its place in the business workflow.
- Only useful signals, explicitly scoped to loaded rows if they are not totals.
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

The page shell, header and safe navigation remain visible. Do not show a successful empty state
or healthy metric counters while their data is unavailable.

## Forms, panels and motion

- Use a `Modal` for a short creation or confirmation; a `Drawer` for contextual details/configuration;
  a dedicated page for a full multi-section workflow; inline editing only for small changes.
- Never insert a long configuration form above a Kanban or expand the global navigation height.
- Guard dismissal of dirty long forms and disable dismissal while saving. Display errors inside the active form.
- Use opacity/transform transitions (120–200 ms); respect reduced motion. Do not animate layout dimensions.
- Keep keyboard focus inside the top overlay and return it to its trigger. Use shared scroll locks, not
  direct writes to `document.body.style.overflow` from feature components.
- Shared tokens and components are the default. Keep the desktop's colored icons; work surfaces stay sober.
- Financial totals must have a currency, scope and period; do not sum unlike currencies into one KPI.

## Specialized cockpit pages

Dispatch, Dashboard, Workbench, Agents, Agent Actions, and Integrations can use richer layouts, but they still must answer the three questions:

- Dashboard: what needs attention today?
- Dispatch: what freight can be planned/executed now?
- Workbench: what exception should be triaged next?
- Agent Actions: what action is waiting for human approval, with evidence/risk?
- Agents: which AI employees are healthy, paused, or blocked?
- Integrations: which systems are connected and what operational flow is missing?
