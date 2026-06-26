// Pure DVIR / inspection helpers. Mirrored enums in packages/database schema.prisma.

export enum InspectionSubject {
  VEHICLE = 'VEHICLE',
  TRAILER = 'TRAILER',
  DRIVER = 'DRIVER',
  ANY = 'ANY',
}

export enum InspectionStatus {
  DRAFT = 'DRAFT',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
}

export enum InspectionResult {
  PASS = 'PASS',
  FAIL = 'FAIL',
  NA = 'NA',
}

const INSPECTION: Record<InspectionStatus, InspectionStatus[]> = {
  [InspectionStatus.DRAFT]: [InspectionStatus.PASSED, InspectionStatus.FAILED],
  [InspectionStatus.PASSED]: [],
  [InspectionStatus.FAILED]: [],
};

export function canTransitionInspection(from: InspectionStatus, to: InspectionStatus): boolean {
  if (from === to) return true;
  return (INSPECTION[from] ?? []).includes(to);
}

/**
 * Derive the submitted status of an inspection from its item results: any FAIL ⇒ FAILED,
 * otherwise PASSED. NA and PASS never fail an inspection. An inspection with zero items
 * passes vacuously (an empty checklist is a no-op pass).
 */
export function deriveInspectionStatus(
  items: { result: InspectionResult | string }[],
): InspectionStatus.PASSED | InspectionStatus.FAILED {
  const hasFail = items.some((i) => i.result === InspectionResult.FAIL);
  return hasFail ? InspectionStatus.FAILED : InspectionStatus.PASSED;
}
