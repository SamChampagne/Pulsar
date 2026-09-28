/** Shared, provider-independent outbound SMS contract. Acceptance is not delivery. */
export enum SmsStatus {
  SENDING = 'SENDING',
  SIMULATED = 'SIMULATED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  UNKNOWN = 'UNKNOWN',
}
export const SMS_STATUS_LABELS: Record<SmsStatus, string> = {
  SENDING: 'Envoi engagé — ne pas renvoyer',
  SIMULATED: 'Simulation',
  ACCEPTED: 'Accepté par Telnyx',
  REJECTED: 'Refusé par Telnyx',
  UNKNOWN: 'Résultat incertain — vérifier Telnyx',
};
export function canTransitionSms(from: SmsStatus, to: SmsStatus): boolean {
  return (
    from === SmsStatus.SENDING && to !== SmsStatus.SENDING && Object.values(SmsStatus).includes(to)
  );
}
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
/** Delivery evidence is independent of the outcome of the HTTP send request. */
export enum SmsDeliveryStatus {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  UNCONFIRMED = 'UNCONFIRMED',
}
export const SMS_DELIVERY_LABELS: Record<SmsDeliveryStatus, string> = {
  PENDING: 'Livraison non confirmée',
  DELIVERED: 'Livré selon Telnyx',
  FAILED: 'Échec de livraison',
  UNCONFIRMED: 'Livraison sans confirmation finale',
};
export function canTransitionSmsDelivery(from: SmsDeliveryStatus, to: SmsDeliveryStatus): boolean {
  return (
    from === SmsDeliveryStatus.PENDING &&
    to !== SmsDeliveryStatus.PENDING &&
    Object.values(SmsDeliveryStatus).includes(to)
  );
}
/** Whole-message keywords only. START never silently reinstates permission in Pulsar. */
export function isSmsStop(text: string): boolean {
  return [
    'STOP',
    'STOPALL',
    'UNSUBSCRIBE',
    'CANCEL',
    'END',
    'QUIT',
    'ARRET',
    'ARRÊT',
    'DESABONNER',
    'DÉSABONNER',
  ].includes(text.trim().toUpperCase());
}
/** Settings shortcuts only: these are SMTP connections, not native OAuth/API adapters. */
export const SMTP_PRESETS = [
  {
    key: 'custom',
    name: 'SMTP personnalisé',
    host: '',
    port: 587,
    secure: false,
    hint: 'Utilisez les paramètres fournis par votre hébergeur.',
  },
  {
    key: 'brevo',
    name: 'Brevo',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    hint: 'Identifiant SMTP et clé SMTP Brevo (pas la clé API).',
  },
  {
    key: 'ovh-ca',
    name: 'OVHcloud Canada',
    host: 'smtp.mail.ovh.ca',
    port: 465,
    secure: true,
    hint: 'Boîte MX Plan canadienne : adresse complète et mot de passe de la boîte.',
  },
  {
    key: 'ovh-eu',
    name: 'OVHcloud Europe',
    host: 'smtp.mail.ovh.net',
    port: 465,
    secure: true,
    hint: 'Boîte MX Plan européenne : adresse complète et mot de passe de la boîte.',
  },
] as const;
