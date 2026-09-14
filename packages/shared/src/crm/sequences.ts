/** CRM communications: pure contracts and transitions, shared by API and UI. */
export enum CrmSequenceMode {
  SIMULATION = 'SIMULATION',
  GOVERNED = 'GOVERNED',
}
export enum CrmSequenceTrigger {
  MANUAL = 'MANUAL',
  CONTACT_CREATED = 'CONTACT_CREATED',
}
export enum CrmSequenceRunStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
export enum CrmSequenceStepStatus {
  PENDING = 'PENDING',
  PROPOSED = 'PROPOSED',
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  SIMULATED = 'SIMULATED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}
export enum CommunicationConsent {
  UNKNOWN = 'UNKNOWN',
  GRANTED = 'GRANTED',
  REVOKED = 'REVOKED',
}
export interface CrmSequenceStep {
  delayMinutes: number;
  subject: string;
  body: string;
}

const runTransitions: Record<CrmSequenceRunStatus, readonly CrmSequenceRunStatus[]> = {
  ACTIVE: [
    CrmSequenceRunStatus.PAUSED,
    CrmSequenceRunStatus.STOPPED,
    CrmSequenceRunStatus.COMPLETED,
    CrmSequenceRunStatus.FAILED,
  ],
  PAUSED: [CrmSequenceRunStatus.ACTIVE, CrmSequenceRunStatus.STOPPED],
  STOPPED: [],
  COMPLETED: [],
  FAILED: [],
};
export function canTransitionCrmSequenceRun(from: string, to: string): boolean {
  return (runTransitions[from as CrmSequenceRunStatus] ?? []).includes(to as CrmSequenceRunStatus);
}
const stepTransitions: Record<CrmSequenceStepStatus, readonly CrmSequenceStepStatus[]> = {
  PENDING: [
    CrmSequenceStepStatus.PROPOSED,
    CrmSequenceStepStatus.QUEUED,
    CrmSequenceStepStatus.SIMULATED,
    CrmSequenceStepStatus.CANCELLED,
    CrmSequenceStepStatus.FAILED,
  ],
  PROPOSED: [
    CrmSequenceStepStatus.QUEUED,
    CrmSequenceStepStatus.CANCELLED,
    CrmSequenceStepStatus.FAILED,
  ],
  QUEUED: [
    CrmSequenceStepStatus.SENT,
    CrmSequenceStepStatus.CANCELLED,
    CrmSequenceStepStatus.FAILED,
  ],
  SENT: [],
  SIMULATED: [],
  CANCELLED: [],
  FAILED: [],
};
export function canTransitionCrmSequenceStep(from: string, to: string): boolean {
  return (stepTransitions[from as CrmSequenceStepStatus] ?? []).includes(
    to as CrmSequenceStepStatus,
  );
}
export function sequenceStepDue(base: Date, delayMinutes: number): Date {
  return new Date(base.getTime() + delayMinutes * 60_000);
}
export const CRM_SEQUENCE_VARIABLES = ['name', 'company'] as const;
/** Templates are plain text. Unknown placeholders fail closed, HTML is escaped at send time. */
export function renderSequenceText(
  template: string,
  values: { name: string; company: string },
): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (!CRM_SEQUENCE_VARIABLES.includes(key as 'name' | 'company'))
      throw new Error(`Variable inconnue : ${key}`);
    return values[key as 'name' | 'company'];
  });
}
export function sequenceEmailHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}
export const CRM_SEQUENCE_PRESETS = [
  {
    name: 'Premier contact et relance',
    steps: [
      {
        delayMinutes: 0,
        subject: 'Votre demande',
        body: 'Bonjour {{name}},\nMerci pour votre demande. Comment pouvons-nous vous aider ?',
      },
      {
        delayMinutes: 2880,
        subject: 'Suivi de votre demande',
        body: 'Bonjour {{name}},\nJe reviens vers vous concernant votre demande. Vous pouvez répondre à ce courriel pour poursuivre notre échange.',
      },
    ],
  },
] satisfies { name: string; steps: CrmSequenceStep[] }[];
