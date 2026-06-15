// Mirrored in packages/database schema.prisma (phase 13).

/** How an always-on agent run was triggered. */
export enum AgentRunTrigger {
  EVENT = 'EVENT',
  CRON = 'CRON',
  MANUAL = 'MANUAL',
}

/** Lifecycle of a single always-on agent run (one wake of the dispatcher). */
export enum AgentRunStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  KILLED = 'KILLED',
}

export type RunErrorClass = 'skip' | 'retry' | 'terminal';

/**
 * Maps a runtime error (by its constructor name) to a run outcome class:
 * - 'skip'     — Hermes not installed / unconfigured (BadRequestException) → run SKIPPED, no retry (rule 24).
 * - 'retry'    — Hermes reachable-but-failing (ServiceUnavailableException) → bounded retry.
 * - 'terminal' — anything else → run FAILED, no retry.
 */
export function classifyRunError(errorName: string): RunErrorClass {
  if (errorName === 'BadRequestException') return 'skip';
  if (errorName === 'ServiceUnavailableException') return 'retry';
  return 'terminal';
}
