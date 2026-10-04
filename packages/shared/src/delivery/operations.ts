export const DELIVERY_OPERATION_FILTERS = [
  'all',
  'to_prepare',
  'to_load',
  'in_delivery',
  'blocked',
  'retry',
  'returns',
] as const;
export type DeliveryOperationFilter = (typeof DELIVERY_OPERATION_FILTERS)[number];
export interface DeliveryOperationRow {
  id: string;
  loadNumber: string;
  status: string;
  updatedAt: string;
  shipmentCount: number;
  shipmentsWithoutPackages: number;
  packages: {
    total: number;
    prepared: number;
    loaded: number;
    delivered: number;
    returned: number;
    cancelled: number;
  };
  exceptions: { open: number; retry: number; returnAuthorized: number; returnReceived: number };
  nextAction: { label: string; href: string; reason: string };
}
export interface DeliveryOperationsPage {
  items: DeliveryOperationRow[];
  total: number;
  page: number;
  pageSize: number;
  observedAt: string;
}
/** Guidance only: never executes an action or claims an incident's diagnosis. */
export function nextDeliveryOperation(
  row: Omit<DeliveryOperationRow, 'nextAction'>,
): DeliveryOperationRow['nextAction'] {
  const href = `/loads/${encodeURIComponent(row.id)}`;
  if (row.exceptions.open)
    return {
      href,
      label: 'Examiner les incidents',
      reason: 'Un incident ouvert exige une décision de l’exploitation.',
    };
  if (row.exceptions.returnAuthorized)
    return {
      href,
      label: 'Vérifier la réception du retour',
      reason: 'Retour autorisé, garde physique pas encore confirmée. Aucun stock créé.',
    };
  if (row.exceptions.retry)
    return {
      href,
      label: 'Suivre la nouvelle tentative',
      reason: 'La tentative planifiée n’est pas une preuve de livraison.',
    };
  if (row.exceptions.returnReceived)
    return {
      href,
      label: 'Consulter les retours reçus',
      reason: 'Garde physique confirmée; aucun remboursement ni mouvement WMS implicite.',
    };
  if (row.status === 'COMPLETED' || row.status === 'CANCELLED')
    return {
      href,
      label: 'Consulter le dossier',
      reason: 'Dossier clôturé; preuves historiques conservées.',
    };
  if (row.shipmentsWithoutPackages)
    return {
      href,
      label: 'Vérifier le contenu déclaré',
      reason:
        'Une expédition active n’a pas de colis actif déclaré. Le suivi par colis reste facultatif.',
    };
  if (row.packages.prepared)
    return {
      href,
      label: 'Vérifier les colis à charger',
      reason: 'Le scan sélectionne; le chargement physique doit être confirmé.',
    };
  if (row.status === 'IN_TRANSIT')
    return {
      href,
      label: 'Suivre les remises',
      reason: 'Confirmer chaque remise réelle et le POD selon la politique de l’entreprise.',
    };
  return {
    href,
    label: 'Ouvrir la tournée',
    reason: 'Vérifier ressources, arrêts et prochaines étapes dans le dossier.',
  };
}
