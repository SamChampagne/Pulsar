import { OperationalTaskType } from '../enums/operating';

/** Domain-event type catalog (phase 12). Free strings, like webhook event names. */
export const DOMAIN_EVENT_TYPES = {
  STOP_DELAYED: 'stop.delayed',
  TENDER_DECLINED: 'tender.declined',
  TENDER_EXPIRED: 'tender.expired',
} as const;

export interface DomainEventInput {
  type: string;
  payload: Record<string, unknown>;
}

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AssignHint = 'AUTO' | 'UNASSIGNED';

export interface TaskSpec {
  type: OperationalTaskType;
  category: string;
  severity: Severity;
  title: string;
  subjectType: string;
  subjectId: string;
  /** Stable per logical exception — used for idempotent dedup (tenantId, dedupKey). */
  dedupKey: string;
  details: Record<string, unknown>;
  /** AUTO = route to a handling always-on agent if one exists; else fall back to UNASSIGNED. */
  assignHint: AssignHint;
}

interface Policy {
  eventType: string;
  produce(event: DomainEventInput): TaskSpec[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** A delayed stop escalates to CRITICAL severity beyond this many minutes late. */
const DELAY_CRITICAL_MINUTES = 60;

const POLICIES: Policy[] = [
  {
    eventType: DOMAIN_EVENT_TYPES.STOP_DELAYED,
    produce: (e) => {
      const stopId = str(e.payload.stopId);
      const deadline = str(e.payload.deadline);
      const minutesLate = num(e.payload.minutesLate);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'DELAY',
          severity: minutesLate > DELAY_CRITICAL_MINUTES ? 'CRITICAL' : 'WARNING',
          title: `Stop ${minutesLate} min late`,
          subjectType: 'stop',
          subjectId: stopId,
          dedupKey: `DELAY:${stopId}:${deadline}`,
          details: { ...e.payload },
          assignHint: 'AUTO',
        },
      ];
    },
  },
  ...[DOMAIN_EVENT_TYPES.TENDER_DECLINED, DOMAIN_EVENT_TYPES.TENDER_EXPIRED].map(
    (eventType): Policy => ({
      eventType,
      produce: (e) => {
        const tenderId = str(e.payload.tenderId);
        const loadId = str(e.payload.loadId);
        const reason = e.type === DOMAIN_EVENT_TYPES.TENDER_EXPIRED ? 'expired' : 'declined';
        return [
          {
            type: OperationalTaskType.EXCEPTION,
            category: 'TENDER_FAILURE',
            severity: 'WARNING',
            title: `Tender ${reason} on load ${str(e.payload.loadNumber) || loadId}`,
            subjectType: 'load',
            subjectId: loadId,
            dedupKey: `TENDER_FAILURE:${tenderId}`,
            details: { ...e.payload, reason },
            assignHint: 'AUTO',
          },
        ];
      },
    }),
  ),
];

const POLICIES_BY_EVENT = new Map<string, Policy[]>();
for (const p of POLICIES) {
  const arr = POLICIES_BY_EVENT.get(p.eventType) ?? [];
  arr.push(p);
  POLICIES_BY_EVENT.set(p.eventType, arr);
}

export function resolvePolicies(event: DomainEventInput): TaskSpec[] {
  return (POLICIES_BY_EVENT.get(event.type) ?? []).flatMap((p) => p.produce(event));
}
