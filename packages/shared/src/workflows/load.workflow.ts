import { LoadStatus } from '../enums/transportation';

export const LOAD_TRANSITIONS: Record<LoadStatus, LoadStatus[]> = {
  [LoadStatus.OPEN]: [LoadStatus.PLANNED, LoadStatus.CANCELLED],
  [LoadStatus.PLANNED]: [LoadStatus.DISPATCHED, LoadStatus.OPEN, LoadStatus.CANCELLED],
  [LoadStatus.DISPATCHED]: [LoadStatus.IN_TRANSIT, LoadStatus.CANCELLED],
  [LoadStatus.IN_TRANSIT]: [LoadStatus.COMPLETED],
  [LoadStatus.COMPLETED]: [],
  [LoadStatus.CANCELLED]: [],
};

export function canTransitionLoad(from: LoadStatus, to: LoadStatus): boolean {
  return LOAD_TRANSITIONS[from]?.includes(to) ?? false;
}
