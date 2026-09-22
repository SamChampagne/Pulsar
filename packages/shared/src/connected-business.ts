/** Current operational signals are derived from their source, never copied HR dossiers. */
export const ATTENTION_KINDS = [
  'support',
  'quality',
  'time',
  'purchasing',
  'qualifications',
] as const;
export type BusinessAttentionKind = (typeof ATTENTION_KINDS)[number];
export const ATTENTION_LABELS: Record<BusinessAttentionKind, string> = {
  support: 'SAV à suivre',
  quality: 'Non-conformités',
  time: 'Heures à approuver',
  purchasing: 'Reliquats fournisseurs',
  qualifications: 'Habilitations à renouveler',
};
export interface ConnectedOperationsSettings {
  timeZone: string;
  qualificationDays: number;
  enabled: Record<BusinessAttentionKind, boolean>;
}
export function connectedOperationsSettings(raw: unknown): ConnectedOperationsSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<ConnectedOperationsSettings>) : {};
  let timeZone = typeof value.timeZone === 'string' ? value.timeZone : 'America/Toronto';
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
  } catch {
    timeZone = 'America/Toronto';
  }
  return {
    timeZone,
    qualificationDays:
      Number.isInteger(value.qualificationDays) &&
      value.qualificationDays! >= 0 &&
      value.qualificationDays! <= 365
        ? value.qualificationDays!
        : 30,
    enabled: Object.fromEntries(
      ATTENTION_KINDS.map((k) => [k, value.enabled?.[k] !== false]),
    ) as Record<BusinessAttentionKind, boolean>,
  };
}
export interface BusinessAttentionItem {
  id: string;
  title: string;
  reason: string;
  action: string;
  href: string;
  dueDate: string | null;
  assignee: string | null;
}
export interface AttentionFeed {
  kind: BusinessAttentionKind | null;
  available: { kind: BusinessAttentionKind; label: string; total: number }[];
  items: BusinessAttentionItem[];
  total: number;
  page: number;
  pageSize: number;
  checkedAt: string;
  settings: ConnectedOperationsSettings;
  settingsVersion: string;
}
