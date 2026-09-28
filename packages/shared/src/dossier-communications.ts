import { MODULE_KEYS } from './modules';
import { PERMISSIONS } from './permissions';
import { PARTY_ACCESS } from './party-profile';
import { E164_PATTERN } from './communications';

export enum CommunicationChannel {
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}
export enum DossierEmailStatus {
  SENDING = 'SENDING',
  SIMULATED = 'SIMULATED',
  ACCEPTED = 'ACCEPTED',
  UNKNOWN = 'UNKNOWN',
}
export function canTransitionDossierEmail(from: DossierEmailStatus, to: DossierEmailStatus) {
  return (
    from === DossierEmailStatus.SENDING &&
    to !== from &&
    Object.values(DossierEmailStatus).includes(to)
  );
}
/** Only explicit sources. A facade grants access to the same identity, not its other dossiers. */
export const COMMUNICATION_ACCESS = [
  ...PARTY_ACCESS,
  {
    path: 'services/jobs',
    kind: 'job',
    module: MODULE_KEYS.SERVICES,
    read: PERMISSIONS.SERVICES.READ,
    manage: PERMISSIONS.SERVICES.MANAGE,
  },
  {
    path: 'crm/deals',
    kind: 'deal',
    module: MODULE_KEYS.CRM,
    read: PERMISSIONS.CRM.READ,
    manage: PERMISSIONS.CRM.MANAGE,
  },
  {
    path: 'transportation/shipments',
    kind: 'shipment',
    module: MODULE_KEYS.TRANSPORTATION,
    read: PERMISSIONS.TRANSPORTATION.PLANNING_READ,
    manage: PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE,
  },
] as const;
export function normalizeCommunicationRecipient(
  channel: CommunicationChannel,
  value: string,
): string | null {
  const normalized = value.trim();
  if (channel === CommunicationChannel.SMS)
    return E164_PATTERN.test(normalized) ? normalized : null;
  // Deliberately one mailbox only, no display names, address lists or header injection.
  return normalized.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(normalized)
    ? normalized.toLowerCase()
    : null;
}
export const COMMUNICATION_VARIABLES = ['dossier', 'client', 'destinataire'] as const;
export function renderCommunicationTemplate(text: string, values: Record<string, string>) {
  const missing = new Set<string>();
  const value = text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (!(COMMUNICATION_VARIABLES as readonly string[]).includes(key) || !values[key]) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return values[key];
  });
  return { value, missing: [...missing] };
}
export function communicationHtml(text: string): string {
  const escaped = text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
  return `<div style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.6">${escaped}</div>`;
}
