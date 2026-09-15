/** Fleet workspace projections. Browser-safe, never a dispatch reservation. */
export type FleetAssetKind = 'vehicle' | 'trailer';
export const FLEET_ASSET_LABELS: Record<string, string> = {
  AVAILABLE: 'Disponible',
  IN_SERVICE: 'En service',
  MAINTENANCE: 'En maintenance',
  RETIRED: 'Retiré',
};
export const FLEET_ORDER_LABELS: Record<string, string> = {
  OPEN: 'À démarrer',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};
export const FLEET_TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: 'Préventif',
  REPAIR: 'Réparation',
  INSPECTION: 'Inspection',
};
export interface FleetAssetRow {
  id: string;
  kind: FleetAssetKind;
  unitNumber: string;
  type: string;
  plate: string | null;
  status: string;
  internal: boolean;
  openOrders: number;
  expiredDocuments: number;
  expiringDocuments: number;
}
export interface FleetOrderRow {
  id: string;
  description: string;
  status: string;
  type: string;
  dueDate: string | null;
  vendor: string | null;
  updatedAt: string;
  openedAt: string;
  completedAt: string | null;
  costAmount: string | null;
  costCurrency: string;
  odometerKm: number | null;
  asset: { id: string; kind: FleetAssetKind; unitNumber: string; status: string } | null;
}
export interface FleetWorkspace {
  generatedAt: string;
  summary: {
    total: number;
    available: number;
    inService: number;
    maintenance: number;
    retired: number;
  };
  items: FleetAssetRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface FleetAgenda {
  generatedAt: string;
  from: string;
  until: string;
  counts: { dated: number; overdue: number; undated: number; history: number };
  days: { date: string; count: number }[];
  items: FleetOrderRow[];
  total: number;
  page: number;
  pageSize: number;
}
export function fleetAttention(
  asset: Pick<FleetAssetRow, 'status' | 'openOrders' | 'expiredDocuments'>,
) {
  if (asset.status === 'RETIRED') return 'Retiré du parc';
  if (asset.openOrders > 0) return `${asset.openOrders} intervention(s) active(s)`;
  if (asset.status === 'MAINTENANCE') return 'Immobilisation sans ordre actif';
  if (asset.expiredDocuments > 0) return 'Documents expirés à vérifier';
  return FLEET_ASSET_LABELS[asset.status] ?? asset.status;
}
/** Calendar is explicitly UTC; date-only input is not shifted by the workstation timezone. */
export function fleetDateKey(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}
export function fleetDateWindow(from: string, days = 7) {
  const start = new Date(`${from}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !Number.isFinite(start.getTime()) ||
    fleetDateKey(start) !== from
  )
    throw new Error('Date de début invalide.');
  return {
    from: start.toISOString(),
    until: new Date(start.getTime() + days * 86400000).toISOString(),
  };
}
