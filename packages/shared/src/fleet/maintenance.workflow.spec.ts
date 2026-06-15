import { describe, it, expect } from 'vitest';
import { MaintenanceOrderStatus, canTransitionMaintenanceOrder, canTransitionAsset } from './maintenance.workflow';

describe('canTransitionMaintenanceOrder', () => {
  it('allows the WO lifecycle', () => {
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.COMPLETED)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.IN_PROGRESS, MaintenanceOrderStatus.COMPLETED)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.CANCELLED)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.IN_PROGRESS, MaintenanceOrderStatus.CANCELLED)).toBe(true);
  });
  it('rejects invalid', () => {
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.COMPLETED, MaintenanceOrderStatus.OPEN)).toBe(false);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.CANCELLED, MaintenanceOrderStatus.COMPLETED)).toBe(false);
  });
});

describe('canTransitionAsset', () => {
  it('AVAILABLE/IN_SERVICE → MAINTENANCE, MAINTENANCE → AVAILABLE', () => {
    expect(canTransitionAsset('AVAILABLE', 'MAINTENANCE')).toBe(true);
    expect(canTransitionAsset('IN_SERVICE', 'MAINTENANCE')).toBe(true);
    expect(canTransitionAsset('MAINTENANCE', 'AVAILABLE')).toBe(true);
  });
  it('never disturbs RETIRED', () => {
    expect(canTransitionAsset('RETIRED', 'MAINTENANCE')).toBe(false);
    expect(canTransitionAsset('RETIRED', 'AVAILABLE')).toBe(false);
  });
});
