/** Acceptance concerns completed work/report, not quantities, prices or a legal signature. */
export enum ServiceAcceptanceStatus {
  PENDING = 'PENDING',
  RESERVATIONS = 'RESERVATIONS',
  ACCEPTED = 'ACCEPTED',
}

export const SERVICE_ACCEPTANCE_LABELS: Record<ServiceAcceptanceStatus, string> = {
  PENDING: 'À recueillir',
  RESERVATIONS: 'Réserves à traiter',
  ACCEPTED: 'Travaux acceptés',
};

export function canTransitionServiceAcceptance(from: string, to: string): boolean {
  return (
    (from === ServiceAcceptanceStatus.PENDING || from === ServiceAcceptanceStatus.RESERVATIONS) &&
    (to === ServiceAcceptanceStatus.RESERVATIONS || to === ServiceAcceptanceStatus.ACCEPTED)
  );
}

export function serviceAcceptanceBlock(
  required: boolean,
  job: { status: string; acceptanceStatus: string },
): string | null {
  if (!required) return null;
  if (job.status !== 'COMPLETED') return 'Terminer l’intervention et son compte rendu.';
  if (job.acceptanceStatus !== ServiceAcceptanceStatus.ACCEPTED)
    return 'Consigner l’acceptation des travaux dans l’intervention.';
  return null;
}
