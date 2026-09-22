import type {
  QualityCriterion,
  QualityResult,
  QualityInspectionStatus,
  QualityNonconformityStatus,
  QualityOutcome,
} from '@pulsar/shared';
export type Plan = {
  id: string;
  code: string;
  name: string;
  instructions: string;
  criteria: QualityCriterion[];
  revision: number;
  active: boolean;
  updatedAt: string;
};
export type Inspection = {
  id: string;
  number: string;
  title: string;
  planName: string;
  planRevision: number;
  instructions: string;
  criteria: QualityCriterion[];
  results: QualityResult[];
  status: QualityInspectionStatus;
  outcome: QualityOutcome | null;
  updatedAt: string;
  source: { kind: string; available: boolean; id?: string; label?: string; href?: string };
  nonconformity: { id: string; number: string; status: QualityNonconformityStatus } | null;
};
export type Nonconformity = {
  assigneeUserId: string | null;
  assignee: { firstName: string; lastName: string } | null;
  dueDate: string | null;
  id: string;
  number: string;
  title: string;
  inspectionId: string;
  status: QualityNonconformityStatus;
  rootCause: string;
  correctiveAction: string;
  updatedAt: string;
};
export type InspectionIntent = {
  planId: string;
  title: string;
  sourceKind: string;
  sourceId?: string;
  operationKey: string;
};
export function readInspectionIntent(raw: string): InspectionIntent {
  const p = JSON.parse(raw);
  if (
    !p ||
    typeof p !== 'object' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      p.operationKey,
    ) ||
    typeof p.planId !== 'string' ||
    !p.planId ||
    typeof p.title !== 'string' ||
    !p.title.trim() ||
    !['MANUAL', 'RECEIPT', 'MANUFACTURING', 'SUPPORT'].includes(p.sourceKind) ||
    (p.sourceKind !== 'MANUAL' && (typeof p.sourceId !== 'string' || !p.sourceId))
  )
    throw new Error(
      'La demande conservée est invalide. Vérifiez les contrôles avant de la retirer.',
    );
  return {
    planId: p.planId,
    title: p.title,
    sourceKind: p.sourceKind,
    ...(p.sourceKind !== 'MANUAL' ? { sourceId: p.sourceId } : {}),
    operationKey: p.operationKey,
  };
}
