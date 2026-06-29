
export enum EmailThreadStatus {
  UNLINKED = 'UNLINKED',
  LINKED = 'LINKED',
  ARCHIVED = 'ARCHIVED',
}

export enum EmailDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

/** Strip repeated Re:/Fwd:/Fw: prefixes, trim, lowercase — for subject-based grouping. */
export function normalizeSubject(subject: string): string {
  let s = (subject ?? '').trim();
  // Strip leading reply/forward markers, possibly stacked (Re: Fwd: ...).
  // Matches: re, fw, fwd, optionally followed by [n] / (n), then ':'.
  const prefix = /^(re|fw|fwd)(\[\d+\]|\(\d+\))?\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, '');
  return s.trim().toLowerCase();
}

export interface ThreadDecisionInput {
  inReplyTo?: string | null;
  references?: string[];
  /** threadId of any already-stored message whose messageId is referenced, else null. */
  knownMessageThreadId: string | null;
  /** Contact matched on the sender address (tenant-scoped), else null. */
  matchedContact: { id: string; companyId: string | null } | null;
}

export type ThreadDecision =
  | { kind: 'existing'; threadId: string }
  | { kind: 'new-linked'; contactId: string; companyId: string | null }
  | { kind: 'new-unlinked' };

/**
 * Pure threading decision. The caller resolves DB lookups
 * (known message thread, contact match) and feeds them here.
 */
export function resolveThreadDecision(input: ThreadDecisionInput): ThreadDecision {
  if (input.knownMessageThreadId) {
    return { kind: 'existing', threadId: input.knownMessageThreadId };
  }
  if (input.matchedContact) {
    return {
      kind: 'new-linked',
      contactId: input.matchedContact.id,
      companyId: input.matchedContact.companyId,
    };
  }
  return { kind: 'new-unlinked' };
}
