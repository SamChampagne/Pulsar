/** Read-only lot trace contracts. Quantities are per recorded movement, never allocated per piece. */
export type LotTraceDirection = 'downstream' | 'upstream';
export interface LotTraceNode {
  id: string;
  itemId: string;
  code: string;
  sku: string;
  name: string;
  unit: string;
  disposition: string;
  depth: number;
}
export interface LotTraceEdge {
  id: string;
  fromLotId: string;
  toLotId: string;
  declarationId: string;
  order: { id: string; number: string };
  createdAt: string;
  input: { movementId: string; quantity: string; unit: string; binCode: string };
  output: { movementId: string; quantity: string; unit: string; binCode: string };
}
export interface LotTraceResult {
  generatedAt: string;
  direction: LotTraceDirection;
  depth: number;
  rootId: string;
  scopes: { manufacturing: boolean; services: boolean; transportation: boolean };
  nodes: LotTraceNode[];
  edges: LotTraceEdge[];
  notices: {
    code: string;
    message: string;
    declarationId?: string;
    order?: { id: string; number: string };
  }[];
  bounded: boolean;
  limits: { nodes: number; declarations: number; edges: number; states: number };
}
export interface LotTraceDossier {
  id: string;
  number: string;
  title: string;
  href: string;
  status: string;
  createdAt: string;
  quantity: string;
  unit: string | null;
  unitCaptured: boolean;
  returnedQuantity?: string;
  retainedQuantity?: string;
  context?: { label: string; href: string };
  client?: string;
}
export interface LotTraceJournalMovement {
  id: string;
  type: string;
  itemId: string;
  lotId: string | null;
  lotCode: string | null;
  fromBinId: string | null;
  toBinId: string | null;
  quantity: string;
  unit: string | null;
  createdAt: string;
}
export interface VerifiedLotTraceMovement extends LotTraceJournalMovement {
  binCode: string;
}
/** Validate persisted v2 evidence against the append-only journal, without inventing legacy provenance. */
export function verifyLotTraceProof(
  raw: unknown,
  locationId: string | null,
  journal: LotTraceJournalMovement[],
): VerifiedLotTraceMovement[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const proof = raw as Record<string, unknown>;
  if (
    proof.version !== 2 ||
    !locationId ||
    proof.locationId !== locationId ||
    !Array.isArray(proof.movements) ||
    proof.movements.length !== journal.length ||
    !journal.length ||
    journal.length > 201 ||
    new Set(journal.map((m) => m.id)).size !== journal.length
  )
    return null;
  const captured = proof.movements as Record<string, any>[];
  if (
    captured.some((c) => !c || typeof c.id !== 'string') ||
    new Set(captured.map((c) => c.id)).size !== journal.length
  )
    return null;
  const result: VerifiedLotTraceMovement[] = [];
  for (const m of journal) {
    const c = captured.find((c) => c.id === m.id);
    const outgoing = m.type === 'CONSUMPTION',
      bin = outgoing ? m.fromBinId : m.toBinId;
    if (
      !['CONSUMPTION', 'PRODUCTION'].includes(m.type) ||
      !bin ||
      (outgoing ? m.toBinId : m.fromBinId) !== null ||
      !m.unit ||
      !c ||
      c.itemId !== m.itemId ||
      c.type !== m.type ||
      c.quantity !== m.quantity ||
      c.unit !== m.unit ||
      c.binId !== bin ||
      typeof c.binCode !== 'string' ||
      !c.binCode ||
      (c.lot?.id ?? null) !== m.lotId ||
      (c.lot?.code ?? null) !== m.lotCode ||
      !/^\d+(?:\.\d+)?$/.test(m.quantity) ||
      /^0(?:\.0+)?$/.test(m.quantity) ||
      !Number.isFinite(Date.parse(m.createdAt))
    )
      return null;
    result.push({ ...m, binCode: c.binCode });
  }
  if (result.filter((m) => m.type === 'PRODUCTION').length > 1) return null;
  return result;
}
/** Boundary follows physical journal time, not order creation time. Equality is valid within a transaction. */
export function lotTraceChronology(
  direction: LotTraceDirection,
  boundary: number,
  inputAt: string,
  outputAt: string,
): boolean {
  const input = Date.parse(inputAt),
    output = Date.parse(outputAt);
  return (
    Number.isFinite(input) &&
    Number.isFinite(output) &&
    input <= output &&
    (direction === 'downstream' ? input >= boundary : output <= boundary)
  );
}
