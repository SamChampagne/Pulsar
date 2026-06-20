import { TransportMode } from '../enums/transportation';

/** v1 thresholds — constants, parameterizable later (spec: assumed gap vs audit §4). */
export const PARCEL_MAX_KG = 30;
export const LTL_MAX_KG = 4000;

/** Non-binding mode hint from the total weight. Null when the weight is unknown. */
export function suggestMode(
  totalWeightKg: number | null | undefined,
  parcelMaxKg = PARCEL_MAX_KG,
  ltlMaxKg = LTL_MAX_KG,
): TransportMode | null {
  if (totalWeightKg == null) return null;
  if (totalWeightKg <= parcelMaxKg) return TransportMode.PARCEL;
  if (totalWeightKg <= ltlMaxKg) return TransportMode.LTL;
  return TransportMode.FTL;
}
