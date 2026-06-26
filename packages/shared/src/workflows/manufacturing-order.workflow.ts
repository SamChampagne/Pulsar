import { ManufacturingOrderStatus } from '../enums/manufacturing';

/**
 * Manufacturing order lifecycle (rule 2). DRAFT is the editable staging state;
 * RELEASED makes the order eligible for scheduling; IN_PROGRESS means work has
 * started on the shop floor; COMPLETED and CANCELLED are terminal.
 */
export const MANUFACTURING_ORDER_TRANSITIONS: Record<
  ManufacturingOrderStatus,
  ManufacturingOrderStatus[]
> = {
  [ManufacturingOrderStatus.DRAFT]: [
    ManufacturingOrderStatus.RELEASED,
    ManufacturingOrderStatus.CANCELLED,
  ],
  [ManufacturingOrderStatus.RELEASED]: [
    ManufacturingOrderStatus.IN_PROGRESS,
    ManufacturingOrderStatus.DRAFT,
    ManufacturingOrderStatus.CANCELLED,
  ],
  [ManufacturingOrderStatus.IN_PROGRESS]: [
    ManufacturingOrderStatus.COMPLETED,
    ManufacturingOrderStatus.CANCELLED,
  ],
  [ManufacturingOrderStatus.COMPLETED]: [],
  [ManufacturingOrderStatus.CANCELLED]: [],
};

export function canTransitionManufacturingOrder(
  from: ManufacturingOrderStatus,
  to: ManufacturingOrderStatus,
): boolean {
  return MANUFACTURING_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
