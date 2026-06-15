import { OperationalTaskStatus } from '../enums/operating';

export const OPERATIONAL_TASK_TRANSITIONS: Record<OperationalTaskStatus, OperationalTaskStatus[]> = {
  [OperationalTaskStatus.OPEN]: [
    OperationalTaskStatus.IN_PROGRESS,
    OperationalTaskStatus.RESOLVED,
    OperationalTaskStatus.DISMISSED,
  ],
  [OperationalTaskStatus.IN_PROGRESS]: [
    OperationalTaskStatus.RESOLVED,
    OperationalTaskStatus.DISMISSED,
    OperationalTaskStatus.OPEN,
  ],
  [OperationalTaskStatus.RESOLVED]: [],
  [OperationalTaskStatus.DISMISSED]: [],
};

export function canTransitionOperationalTask(
  from: OperationalTaskStatus,
  to: OperationalTaskStatus,
): boolean {
  return OPERATIONAL_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}
