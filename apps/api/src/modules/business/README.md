# Business foundations

Catalogue owns shared identities for the new applications. Services, Purchasing and Support own
distinct domain tables and workflows. Existing CRM/TMS/WMS identities are not migrated
or silently deduplicated. The explicit Catalogue ↔ WMS link and Services parts workflow now
post stock. Supplier arrivals now post existing WMS receipts atomically; time, order confirmation
and SAV transitions have no stock/accounting/outbound email effect.

All mutations share a per-tenant transaction lock; edits/actions require a version.
References are tenant-checked and master-data activity is rechecked inside the lock.
Consumer reference reads use each module's own read permission and only expose the
minimal active catalogue choices, never catalogue contact details.

Services assignment references active human tenant users; legacy assignee text remains a
coordination note. Time entries own their table and share the same business tenant lock.
Creation is idempotent by operation key + actor-bound payload fingerprint; replay precedes
workflow revalidation. Corrections/voids require versions; closed projects are read-only.
`services.read` grants team-register reads. Writers need `services.manage`, or
`services.time.write` for their own time (new entries also require current assignment).
Time remains manual. Submission freezes fields; independent approval/rejection/reopening
requires `services.time.approve`. Decisions and corrections write an immutable review journal
with snapshots in the same transaction. No self/author/latest-corrector approval. Projects
cannot close with unresolved time. No invoice, payroll or stock effect.
Detailed contract: `docs/plans/services-assignment-time.md`.
Approval contract: `docs/plans/services-time-approval.md`.

Parts use the business mutex followed by the WMS tenant lock. One-to-one goods mappings require
identical units; WMS item unit changes are blocked while mapped or historically consumed.
Issues/full returns call InventoryService.postMovement inside the same transaction as the
usage. Snapshots survive remapping, replay precedes current version/stock validation, and no
project closure or job cancellation can silently dispose of issued parts. New stock actions
require both Services management and WMS management/read. Historical usage reads stay in Services.
Contract: `docs/plans/services-parts-and-connected-documentation.md`.

Supplier arrivals use the business mutex then the WMS tenant lock, with actor-bound exact replay
before current order/version validation. The same transaction creates the Receipt, receipt lines,
SupplierReceipt allocations and stock through ReceivingService.postInTransaction. Required WMS
custom fields apply. Remaining quantities are Decimal reads from linked receipt lines, not new
stock counters. No overreceipt, implicit closing, cancellation after arrival, or supplier return.
Short closing needs a reason. Unit history stays protected after catalogue unlinking.

Support has separate SupportCase/SupportCaseEvent tables, a shared state machine, versioned
qualification and motivated decisions with atomic history. Creation is idempotent; other uncertain
responses require inspecting the current case. An optional ServiceJob must have the same client;
changing its parent project's client is blocked while linked. Linking causes no workflow execution.
Only support.read/manage gates the case; Services data and link changes additionally require
Services activation/read. No SLA, client portal, mail or new agent tool in this first version.
Contract and sector roadmap: `docs/plans/supplier-receipts-and-support.md`.
