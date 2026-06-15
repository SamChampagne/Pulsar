// Pure. Mirrored in packages/database schema.prisma (fleet module).

export enum MaintenanceType { PREVENTIVE = 'PREVENTIVE', REPAIR = 'REPAIR', INSPECTION = 'INSPECTION' }

export enum MaintenanceOrderStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

const WO: Record<MaintenanceOrderStatus, MaintenanceOrderStatus[]> = {
  [MaintenanceOrderStatus.OPEN]: [MaintenanceOrderStatus.IN_PROGRESS, MaintenanceOrderStatus.COMPLETED, MaintenanceOrderStatus.CANCELLED],
  [MaintenanceOrderStatus.IN_PROGRESS]: [MaintenanceOrderStatus.COMPLETED, MaintenanceOrderStatus.CANCELLED],
  [MaintenanceOrderStatus.COMPLETED]: [],
  [MaintenanceOrderStatus.CANCELLED]: [],
};

export function canTransitionMaintenanceOrder(from: MaintenanceOrderStatus, to: MaintenanceOrderStatus): boolean {
  if (from === to) return true;
  return (WO[from] ?? []).includes(to);
}

/**
 * AssetStatus transitions driven by the maintenance workflow (string values mirror the Prisma
 * AssetStatus enum). RETIRED is terminal — never disturbed by maintenance.
 */
const ASSET: Record<string, string[]> = {
  AVAILABLE: ['MAINTENANCE', 'IN_SERVICE', 'RETIRED'],
  IN_SERVICE: ['MAINTENANCE', 'AVAILABLE', 'RETIRED'],
  MAINTENANCE: ['AVAILABLE', 'IN_SERVICE', 'RETIRED'],
  RETIRED: [],
};

export function canTransitionAsset(from: string, to: string): boolean {
  if (from === to) return true;
  return (ASSET[from] ?? []).includes(to);
}
