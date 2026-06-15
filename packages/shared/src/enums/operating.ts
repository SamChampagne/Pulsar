/** Operating Workbench enums (phase 12). Mirrored verbatim in schema.prisma. */
export enum OperationalTaskType {
  EXCEPTION = 'EXCEPTION',
}

export enum OperationalTaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export enum TaskAssigneeType {
  UNASSIGNED = 'UNASSIGNED',
  HUMAN = 'HUMAN',
  AGENT = 'AGENT',
}

export enum DomainEventStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}
