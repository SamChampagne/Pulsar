export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/** Single source of truth: workflow status → visual tone. Keys are the enum
 *  values from @pulsar/shared (TransportOrderStatus, ShipmentStatus, LoadStatus,
 *  TenderStatus, InvoiceStatus, CustomerInvoiceStatus, StopStatus). */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  CONFIRMED: 'info',
  PLANNED: 'warn',
  OPEN: 'neutral',
  DISPATCHED: 'ok',
  IN_TRANSIT: 'info',
  PICKED_UP: 'info',
  DELIVERED: 'ok',
  COMPLETED: 'ok',
  PAID: 'ok',
  APPROVED: 'ok',
  ACCEPTED: 'ok',
  SENT: 'info',
  PENDING: 'warn',
  ARRIVED: 'info',
  DEPARTED: 'info',
  CANCELLED: 'neutral',
  DECLINED: 'danger',
  EXPIRED: 'danger',
  FAILED: 'danger',
  DISPUTED: 'danger',
  DELAYED: 'danger',
  IN_EXECUTION: 'info',
  CLOSED: 'neutral',
  ACKNOWLEDGED: 'info',
  RESOLVED: 'ok',
  REJECTED: 'danger',
};

/**
 * Status → French label. Keyed by the raw enum value, so one entry serves every
 * enum that shares it (`COMPLETED` is a load, a stop, a pick order and a dock
 * appointment at once). The UI is French: `labelFor` is the only place a status
 * becomes text, and an unmapped value degrades to the humanised English form
 * rather than disappearing.
 *
 * Covers: TransportOrderStatus, ShipmentStatus, LoadStatus, StopStatus,
 * TenderStatus, ReceiptStatus, PickOrderStatus, CycleCountStatus,
 * YardVisitStatus, DockAppointmentStatus, CustomerInvoiceStatus, InvoiceStatus
 * (incoming carrier invoice), PaymentStatus, PortalUserStatus, TenantStatus,
 * ReleaseNoteKind/ReleaseNoteStatus and the portal change-request lifecycle
 * (spec §B: OPEN | ACKNOWLEDGED | RESOLVED | REJECTED).
 *
 * Gender note: a single key is shared by masculine ("un lot") and feminine
 * ("une facture") subjects. Where both occur the feminine form is used for keys
 * that belong mostly to documents (invoices, receipts, pick orders) and the
 * masculine one elsewhere — a per-enum map would be a much larger change for
 * little gain.
 */
export const STATUS_LABELS_FR: Record<string, string> = {
  // Transport orders / shipments / loads
  DRAFT: 'Brouillon',
  CONFIRMED: 'Confirmée',
  PLANNED: 'Planifié',
  IN_EXECUTION: 'En exécution',
  COMPLETED: 'Terminé',
  CLOSED: 'Clôturé',
  CANCELLED: 'Annulé',
  PENDING: 'En attente',
  DISPATCHED: 'Réparti',
  IN_TRANSIT: 'En transit',
  PICKED_UP: 'Ramassé',
  DELIVERED: 'Livré',
  OPEN: 'Ouverte',
  TENDERED: 'Offert',
  DELAYED: 'En retard',
  FAILED: 'Échec',
  // Stops
  ARRIVED: 'Arrivé',
  DEPARTED: 'Parti',
  SKIPPED: 'Ignoré',
  // Tenders
  ACCEPTED: 'Accepté',
  DECLINED: 'Refusé',
  EXPIRED: 'Expiré',
  // WMS — receipts, pick orders, cycle counts
  POSTED: 'Enregistrée',
  PICKED: 'Prélevée',
  COUNTED: 'Comptée',
  RECONCILED: 'Rapprochée',
  // Yard — visits and dock appointments
  CHECKED_IN: 'Arrivé',
  ASSIGNED: 'Affecté',
  SCHEDULED: 'Planifié',
  NO_SHOW: 'Absence',
  // Billing — customer statements, carrier invoices, payments
  APPROVED: 'Approuvée',
  SENT: 'Envoyée',
  PAID: 'Payée',
  DISPUTED: 'En litige',
  SUBMITTED: 'Soumis',
  // Platform, portal accounts, tenants
  INVITED: 'Invité',
  ACTIVE: 'Actif',
  INACTIVE: 'Inactif',
  DISABLED: 'Désactivé',
  ENABLED: 'Activé',
  TRIAL: 'Essai',
  SUSPENDED: 'Suspendu',
  // Release notes ("Quoi de neuf")
  FEATURE: 'Nouveauté',
  IMPROVEMENT: 'Amélioration',
  FIX: 'Correction',
  PUBLISHED: 'Publiée',
  // Portal change requests (spec §B)
  ACKNOWLEDGED: 'Prise en compte',
  RESOLVED: 'Résolue',
  REJECTED: 'Rejetée',
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function labelFor(status: string): string {
  return (
    STATUS_LABELS_FR[status] ??
    status
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase())
  );
}
