export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/** Single source of truth: workflow status → visual tone. Keys are the enum
 *  values from @pulsar/shared (TransportOrderStatus, ShipmentStatus, LoadStatus,
 *  TenderStatus, InvoiceStatus, CustomerInvoiceStatus, StopStatus). */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral', CONFIRMED: 'info', PLANNED: 'warn', OPEN: 'neutral',
  DISPATCHED: 'ok', IN_TRANSIT: 'info', PICKED_UP: 'info',
  DELIVERED: 'ok', COMPLETED: 'ok', PAID: 'ok', APPROVED: 'ok', ACCEPTED: 'ok',
  SENT: 'info', PENDING: 'warn', ARRIVED: 'info', DEPARTED: 'info',
  CANCELLED: 'neutral', DECLINED: 'danger', EXPIRED: 'danger', FAILED: 'danger',
  DISPUTED: 'danger', DELAYED: 'danger',
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function labelFor(status: string): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
