import { CarrierStatus } from '../enums/transportation';

/** Reference activation is reversible and never cancels an existing transport. */
export function canTransitionCarrier(from: CarrierStatus, to: CarrierStatus): boolean {
  return (
    (from === CarrierStatus.ACTIVE && to === CarrierStatus.INACTIVE) ||
    (from === CarrierStatus.INACTIVE && to === CarrierStatus.ACTIVE)
  );
}
