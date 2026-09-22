/** Separate domain lifecycles. Never reuse transport or manufacturing statuses here. */
export enum CatalogItemKind {
  GOODS = 'GOODS',
  SERVICE = 'SERVICE',
}
export enum ServiceProjectStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
export enum ServiceJobStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
export enum SupplierOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}
export enum ServiceTimeStatus {
  RECORDED = 'RECORDED',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  VOIDED = 'VOIDED',
}
export enum ServiceTimeReviewAction {
  SUBMIT = 'SUBMIT',
  WITHDRAW = 'WITHDRAW',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REOPEN = 'REOPEN',
  VOID = 'VOID',
  CORRECT = 'CORRECT',
}
const timeTransitions: Record<ServiceTimeStatus, ServiceTimeStatus[]> = {
  RECORDED: [ServiceTimeStatus.SUBMITTED, ServiceTimeStatus.VOIDED],
  SUBMITTED: [ServiceTimeStatus.RECORDED, ServiceTimeStatus.APPROVED, ServiceTimeStatus.REJECTED],
  APPROVED: [ServiceTimeStatus.RECORDED],
  REJECTED: [ServiceTimeStatus.SUBMITTED, ServiceTimeStatus.VOIDED],
  VOIDED: [],
};
export const canTransitionServiceTime = (from: ServiceTimeStatus, to: ServiceTimeStatus) =>
  timeTransitions[from]?.includes(to) ?? false;
export const SERVICE_TIME_STATUS_LABELS: Record<ServiceTimeStatus, string> = {
  RECORDED: 'À soumettre',
  SUBMITTED: 'À approuver',
  APPROVED: 'Approuvé',
  REJECTED: 'À corriger',
  VOIDED: 'Annulé',
};
export const SERVICE_TIME_ACTION_LABELS: Record<ServiceTimeReviewAction, string> = {
  SUBMIT: 'Soumettre',
  WITHDRAW: 'Retirer la soumission',
  APPROVE: 'Approuver',
  REJECT: 'Demander une correction',
  REOPEN: 'Rouvrir pour correction',
  VOID: 'Annuler le temps',
  CORRECT: 'Corriger',
};

/** Durations are integral minutes, never decimal hours or financial amounts. */
export function formatServiceMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const projectTransitions: Record<ServiceProjectStatus, ServiceProjectStatus[]> = {
  DRAFT: [ServiceProjectStatus.ACTIVE, ServiceProjectStatus.CANCELLED],
  ACTIVE: [ServiceProjectStatus.COMPLETED, ServiceProjectStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};
const jobTransitions: Record<ServiceJobStatus, ServiceJobStatus[]> = {
  PLANNED: [ServiceJobStatus.IN_PROGRESS, ServiceJobStatus.CANCELLED],
  IN_PROGRESS: [ServiceJobStatus.COMPLETED, ServiceJobStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};
const orderTransitions: Record<SupplierOrderStatus, SupplierOrderStatus[]> = {
  DRAFT: [SupplierOrderStatus.CONFIRMED, SupplierOrderStatus.CANCELLED],
  CONFIRMED: [SupplierOrderStatus.CLOSED, SupplierOrderStatus.CANCELLED],
  CLOSED: [],
  CANCELLED: [],
};
export const canTransitionServiceProject = (from: ServiceProjectStatus, to: ServiceProjectStatus) =>
  projectTransitions[from]?.includes(to) ?? false;
export const canTransitionServiceJob = (from: ServiceJobStatus, to: ServiceJobStatus) =>
  jobTransitions[from]?.includes(to) ?? false;
export const canTransitionSupplierOrder = (from: SupplierOrderStatus, to: SupplierOrderStatus) =>
  orderTransitions[from]?.includes(to) ?? false;
export enum SupportCaseStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}
const supportTransitions: Record<SupportCaseStatus, SupportCaseStatus[]> = {
  OPEN: [SupportCaseStatus.IN_PROGRESS],
  IN_PROGRESS: [SupportCaseStatus.RESOLVED],
  RESOLVED: [SupportCaseStatus.IN_PROGRESS, SupportCaseStatus.CLOSED],
  CLOSED: [],
};
export const canTransitionSupportCase = (from: SupportCaseStatus, to: SupportCaseStatus) =>
  supportTransitions[from]?.includes(to) ?? false;
export const SUPPORT_STATUS_LABELS: Record<SupportCaseStatus, string> = {
  OPEN: 'À qualifier',
  IN_PROGRESS: 'En traitement',
  RESOLVED: 'Résolu',
  CLOSED: 'Clôturé',
};
export const BUSINESS_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'En cours',
  PLANNED: 'Planifiée',
  IN_PROGRESS: 'En intervention',
  CONFIRMED: 'Confirmée',
  COMPLETED: 'Terminé',
  CLOSED: 'Clôturée',
  CANCELLED: 'Annulé',
};
