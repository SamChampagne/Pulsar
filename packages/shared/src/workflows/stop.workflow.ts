import { StopStatus } from '../enums/transportation';
const transitions: Record<StopStatus, StopStatus[]> = {
  PENDING: [StopStatus.ARRIVED, StopStatus.SKIPPED],
  ARRIVED: [StopStatus.DEPARTED, StopStatus.COMPLETED],
  DEPARTED: [StopStatus.COMPLETED],
  COMPLETED: [],
  SKIPPED: [],
};
export function canTransitionStop(from: StopStatus, to: StopStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}
