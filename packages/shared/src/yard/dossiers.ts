export type YardDossierSource = 'visit' | 'appointment';
export type YardDossierKind = 'load' | 'receipt' | 'pick-order';
export const YARD_DOSSIER_KINDS: YardDossierKind[] = ['load', 'receipt', 'pick-order'];
export const YARD_DOSSIER_LABELS: Record<YardDossierKind, string> = {
  load: 'Chargements',
  receipt: 'Réceptions',
  'pick-order': 'Préparations',
};
export interface YardDossierItem {
  id: string;
  number: string;
  status: string;
  href: string;
  linkId?: string;
  warning?: string;
}
export interface YardDossierContext {
  source: {
    type: YardDossierSource;
    id: string;
    number: string;
    locationId: string;
    sharedWithAppointment: boolean;
  };
  editable: boolean;
  groups: {
    kind: YardDossierKind;
    available: boolean;
    items: YardDossierItem[];
    truncated: boolean;
  }[];
}
export interface YardRelatedDossiers {
  items: {
    id: string;
    number: string;
    kind: YardDossierSource;
    status: string;
    site: string;
    href: string;
  }[];
  truncated: boolean;
}
export function yardDossierStatus(status: string): string {
  return (
    (
      {
        OPEN: 'Ouvert',
        PLANNED: 'Planifié',
        TENDERED: 'Proposé au transporteur',
        DISPATCHED: 'Réparti',
        IN_TRANSIT: 'En transit',
        COMPLETED: 'Terminé',
        CANCELLED: 'Annulé',
        DRAFT: 'Brouillon',
        POSTED: 'Réception validée',
        PICKED: 'Prélevé',
      } as Record<string, string>
    )[status] ?? status
  );
}
