export enum DeliveryExceptionStatus {
  OPEN = 'OPEN',
  RETRY_PLANNED = 'RETRY_PLANNED',
  RETURN_AUTHORIZED = 'RETURN_AUTHORIZED',
  RETURN_RECEIVED = 'RETURN_RECEIVED',
  RESOLVED = 'RESOLVED',
}
export const DELIVERY_EXCEPTION_KINDS = [
  'DAMAGE',
  'REFUSED',
  'MISSING',
  'ABSENT',
  'OTHER',
] as const;
export const ACTIVE_DELIVERY_EXCEPTIONS = ['OPEN', 'RETRY_PLANNED', 'RETURN_AUTHORIZED'] as const;
const transitions: Record<DeliveryExceptionStatus, readonly DeliveryExceptionStatus[]> = {
  OPEN: [
    DeliveryExceptionStatus.RETRY_PLANNED,
    DeliveryExceptionStatus.RETURN_AUTHORIZED,
    DeliveryExceptionStatus.RESOLVED,
  ],
  RETRY_PLANNED: [
    DeliveryExceptionStatus.OPEN,
    DeliveryExceptionStatus.RETURN_AUTHORIZED,
    DeliveryExceptionStatus.RESOLVED,
  ],
  RETURN_AUTHORIZED: [DeliveryExceptionStatus.OPEN, DeliveryExceptionStatus.RETURN_RECEIVED],
  RETURN_RECEIVED: [],
  RESOLVED: [],
};
export function canTransitionDeliveryException(
  from: DeliveryExceptionStatus,
  to: DeliveryExceptionStatus,
) {
  return Object.prototype.hasOwnProperty.call(transitions, from) && transitions[from].includes(to);
}
export function deliveryExceptionNextAction(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'Décider : nouvelle tentative, retour ou résolution motivée';
    case 'RETRY_PLANNED':
      return 'Effectuer la tentative puis confirmer la remise ou signaler un nouvel échec';
    case 'RETURN_AUTHORIZED':
      return 'Ramener le colis au site autorisé; confirmer seulement à sa réception physique';
    case 'RETURN_RECEIVED':
      return 'Contrôler le colis reçu; stock, remplacement et traitement financier restent distincts';
    case 'RESOLVED':
      return 'Décision conservée dans l’historique';
    default:
      return 'État inconnu : relire le dossier';
  }
}
