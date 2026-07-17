import { drainInBatches } from '@pulsar/shared';
import type { DomainEventsService } from '../../src/core/operating/domain-events.service';

/**
 * Test isolation helper (E2E only). The domain-event outbox is a single global,
 * oldest-first, batch-limited queue. Across a --runInBand run, a suite that emits
 * events without draining leaves a growing PENDING backlog; a later suite that
 * does `emit → processPending(N) → assert my effect` can then have its freshly-
 * emitted (newest) event starved out of the batch window — an order-dependent
 * flake.
 *
 * Call this once per suite right after obtaining DomainEventsService: it drains
 * the inherited backlog so the suite starts from an empty queue. The events it
 * processes belong to already-completed suites, so it is harmless — and it does
 * NOT swallow their errors (processPending logs failures and marks them FAILED;
 * this only advances the queue). Bounded via drainInBatches so it can never loop
 * forever. Use ONLY against an isolated test database (never a shared one).
 */
export function drainInheritedDomainEvents(svc: DomainEventsService): Promise<unknown> {
  return drainInBatches(() => svc.processPending(200), { maxBatches: 500 });
}
