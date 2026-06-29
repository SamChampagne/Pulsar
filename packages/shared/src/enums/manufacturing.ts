/**
 * Manufacturing domain enums. Source of truth; mirrored 1:1 in schema.prisma
 * (rule 3). These map onto the vendored APS engine's domain value objects so
 * the SP3 snapshot builder is a thin translation:
 *   ManufacturingOrder      → APS WorkOrder
 *   ManufacturingOperation  → APS Operation
 *   ManufacturingPriority   → APS Priority (low/normal/high/urgent)
 *   ManufacturingFirmness   → APS WorkOrderFirmness (firm/forecast/tentative — Cas 2)
 */

export enum ManufacturingOrderStatus {
  DRAFT = 'DRAFT',
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ManufacturingOperationStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum ManufacturingPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum ManufacturingFirmness {
  FIRM = 'FIRM',
  FORECAST = 'FORECAST',
  TENTATIVE = 'TENTATIVE',
}

/** APS engine wire values (lowercase) for the canonical snapshot — used by SP3. */
export const APS_PRIORITY_WIRE: Record<ManufacturingPriority, string> = {
  [ManufacturingPriority.LOW]: 'low',
  [ManufacturingPriority.NORMAL]: 'normal',
  [ManufacturingPriority.HIGH]: 'high',
  [ManufacturingPriority.URGENT]: 'urgent',
};

export const APS_FIRMNESS_WIRE: Record<ManufacturingFirmness, string> = {
  [ManufacturingFirmness.FIRM]: 'firm',
  [ManufacturingFirmness.FORECAST]: 'forecast',
  [ManufacturingFirmness.TENTATIVE]: 'tentative',
};
