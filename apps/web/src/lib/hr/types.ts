import type { HrLeaveKind, HrLeaveStatus } from '@pulsar/shared';
export type Team = { id: string; code: string; name: string; active: boolean; updatedAt: string };
export type Employee = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  active: boolean;
  teamId: string | null;
  team: Team | null;
  userId: string | null;
  user: { firstName: string; lastName: string } | null;
  updatedAt: string;
};
export type Leave = {
  id: string;
  number: string;
  employeeId: string;
  employee: {
    id: string;
    code: string;
    firstName: string;
    lastName: string;
    userId: string | null;
    active: boolean;
  };
  createdById: string;
  kind: HrLeaveKind;
  startDate: string;
  endDate: string;
  note: string;
  status: HrLeaveStatus;
  updatedAt: string;
};
