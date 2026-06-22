// Pure, browser-safe. No Node imports.
import { reactionByKey } from '../automation/reactions';

export type FlowModule =
  | 'TRANSPORTATION' | 'WMS' | 'YARD' | 'FLEET' | 'BILLING' | 'CUSTOMER_PORTAL' | 'CORE';

export interface FlowEvent { id: string; type: string; module: FlowModule; subjectType: string | null; subjectId: string | null; at: string; }
export interface FlowTask { id: string; category: string; status: string; severity: string; subjectType: string | null; subjectId: string | null; sourceEventId: string | null; assigneeAgentId: string | null; at: string; }
export interface FlowAction { id: string; tool: string; status: string; agentId: string; triggeredByRef: string | null; autoApproved: boolean; at: string; }
export interface FlowReaction { id: string; action: string; status: string; module: FlowModule; eventId: string; at: string; }

export interface FlowChain {
  event: FlowEvent | null;
  tasks: FlowTask[];
  actions: FlowAction[];
  reactions: FlowReaction[];
  modules: FlowModule[];
  crossModule: boolean;
  startedAt: string;
  lastAt: string;
}

export interface FlowMapNode { module: FlowModule; eventCount: number; }
export interface FlowMapEdge { from: FlowModule; to: FlowModule; count: number; kind: 'event' | 'reaction'; }
export interface FlowMap { nodes: FlowMapNode[]; edges: FlowMapEdge[]; }

export type EntityStageStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'BLOCKED';
export interface EntityTraceStage { stage: string; module: FlowModule; status: EntityStageStatus; at: string | null; refs: string[]; }
export interface EntityTrace { rootType: string; rootId: string; stages: EntityTraceStage[]; }

export interface EntityTraceInput {
  rootType: 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD';
  rootId: string;
  createdAt: string | null;
  pickedAt: string | null;
  pickBlocked: boolean;
  dispatchedAt: string | null;
  yardAt: string | null;
  deliveredAt: string | null;
  billedAt: string | null;
  refs: { shipments: string[]; loads: string[]; pickOrders: string[]; yardVisits: string[]; invoices: string[]; };
}

const EVENT_PREFIX_MODULE: Record<string, FlowModule> = {
  wms: 'WMS', yard: 'YARD', fleet: 'FLEET',
  tender: 'TRANSPORTATION', stop: 'TRANSPORTATION', driver: 'TRANSPORTATION',
  // TMS lifecycle events (load.completed, load.dispatched, transport-order.planned, shipment.*)
  // — previously fell through to CORE, so flow chains/edges mis-attributed them.
  load: 'TRANSPORTATION', shipment: 'TRANSPORTATION', 'transport-order': 'TRANSPORTATION',
  'carrier-invoice': 'BILLING', invoice: 'BILLING', portal: 'CUSTOMER_PORTAL',
};

export function moduleOfEventType(type: string): FlowModule {
  const prefix = type.split('.')[0];
  return EVENT_PREFIX_MODULE[prefix] ?? 'CORE';
}

const SUBJECT_MODULE: Record<string, FlowModule> = {
  load: 'TRANSPORTATION', shipment: 'TRANSPORTATION', stop: 'TRANSPORTATION', 'transport-order': 'TRANSPORTATION',
  'yard-visit': 'YARD', 'dock-appointment': 'YARD',
  vehicle: 'FLEET', trailer: 'FLEET',
  'pick-order': 'WMS', 'wms-item': 'WMS', bin: 'WMS', 'cycle-count': 'WMS',
  invoice: 'BILLING', 'carrier-invoice': 'BILLING',
};

export function moduleOfSubjectType(subjectType: string | null): FlowModule {
  if (!subjectType) return 'CORE';
  return SUBJECT_MODULE[subjectType] ?? 'CORE';
}

const MODULE_KEY_TO_FLOW: Record<string, FlowModule> = {
  transportation: 'TRANSPORTATION', wms: 'WMS', yard: 'YARD', fleet: 'FLEET',
  billing: 'BILLING', 'customer-portal': 'CUSTOMER_PORTAL',
};

export function moduleOfReaction(action: string): FlowModule {
  const m = reactionByKey(action)?.module;
  return (m ? MODULE_KEY_TO_FLOW[m] : undefined) ?? 'CORE';
}

function uniq<T>(xs: T[]): T[] { return [...new Set(xs)]; }
function minIso(xs: string[]): string { return xs.reduce((a, b) => (a < b ? a : b)); }
function maxIso(xs: string[]): string { return xs.reduce((a, b) => (a > b ? a : b)); }

export function buildFlowChains(events: FlowEvent[], tasks: FlowTask[], actions: FlowAction[], reactions: FlowReaction[] = []): FlowChain[] {
  const actionsByTask = new Map<string, FlowAction[]>();
  for (const a of actions) {
    const ref = a.triggeredByRef && a.triggeredByRef.startsWith('task:') ? a.triggeredByRef.slice('task:'.length) : null;
    if (!ref) continue;
    const list = actionsByTask.get(ref) ?? [];
    list.push(a);
    actionsByTask.set(ref, list);
  }

  const tasksByEvent = new Map<string, FlowTask[]>();
  const orphanTasks: FlowTask[] = [];
  const eventIds = new Set(events.map((e) => e.id));
  for (const t of tasks) {
    if (t.sourceEventId && eventIds.has(t.sourceEventId)) {
      const list = tasksByEvent.get(t.sourceEventId) ?? [];
      list.push(t);
      tasksByEvent.set(t.sourceEventId, list);
    } else {
      orphanTasks.push(t);
    }
  }

  const reactionsByEvent = new Map<string, FlowReaction[]>();
  for (const r of reactions) {
    const list = reactionsByEvent.get(r.eventId) ?? [];
    list.push(r);
    reactionsByEvent.set(r.eventId, list);
  }

  const chainFrom = (event: FlowEvent | null, chainTasks: FlowTask[]): FlowChain => {
    const chainActions = chainTasks.flatMap((t) => actionsByTask.get(t.id) ?? []);
    const chainReactions = event ? (reactionsByEvent.get(event.id) ?? []) : [];
    const modules = uniq<FlowModule>([
      ...(event ? [event.module] : []),
      ...chainTasks.map((t) => moduleOfSubjectType(t.subjectType)),
      ...chainReactions.map((r) => r.module),
    ]);
    const times = [
      ...(event ? [event.at] : []),
      ...chainTasks.map((t) => t.at),
      ...chainActions.map((a) => a.at),
      ...chainReactions.map((r) => r.at),
    ];
    return {
      event,
      tasks: chainTasks,
      actions: chainActions,
      reactions: chainReactions,
      modules,
      crossModule: modules.length > 1,
      startedAt: times.length ? minIso(times) : (event?.at ?? ''),
      lastAt: times.length ? maxIso(times) : (event?.at ?? ''),
    };
  };

  const chains: FlowChain[] = [];
  for (const e of events) chains.push(chainFrom(e, tasksByEvent.get(e.id) ?? []));
  for (const t of orphanTasks) chains.push(chainFrom(null, [t]));
  return chains.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

export function buildFlowMap(chains: FlowChain[]): FlowMap {
  const nodeCounts = new Map<FlowModule, number>();
  const edgeCounts = new Map<string, FlowMapEdge>();
  for (const c of chains) {
    if (c.event) nodeCounts.set(c.event.module, (nodeCounts.get(c.event.module) ?? 0) + 1);
    const from = c.event?.module ?? 'CORE';
    for (const t of c.tasks) {
      const to = moduleOfSubjectType(t.subjectType);
      if (to === from) continue; // self/intra → not an edge
      const key = `${from}->${to}:event`;
      const e = edgeCounts.get(key) ?? { from, to, count: 0, kind: 'event' as const };
      e.count += 1;
      edgeCounts.set(key, e);
    }
    for (const r of c.reactions) {
      const to = r.module;
      if (to === from) continue;
      const key = `${from}->${to}:reaction`;
      const e = edgeCounts.get(key) ?? { from, to, count: 0, kind: 'reaction' as const };
      e.count += 1;
      edgeCounts.set(key, e);
    }
  }
  return {
    nodes: [...nodeCounts.entries()].map(([module, eventCount]) => ({ module, eventCount })),
    edges: [...edgeCounts.values()],
  };
}

export interface ReactionKpis { executed: number; failed: number; byAction: { action: string; executed: number; failed: number }[]; }

export function deriveReactionKpis(reactions: FlowReaction[]): ReactionKpis {
  let executed = 0, failed = 0;
  const by = new Map<string, { executed: number; failed: number }>();
  for (const r of reactions) {
    const ok = r.status === 'EXECUTED';
    if (ok) executed++; else failed++;
    const e = by.get(r.action) ?? { executed: 0, failed: 0 };
    if (ok) e.executed++; else e.failed++;
    by.set(r.action, e);
  }
  const byAction = [...by.entries()]
    .map(([action, c]) => ({ action, ...c }))
    .sort((a, b) => (b.executed + b.failed) - (a.executed + a.failed));
  return { executed, failed, byAction };
}

export function buildEntityTrace(input: EntityTraceInput): EntityTrace {
  const stage = (
    name: string, module: FlowModule, at: string | null, blocked: boolean, refs: string[],
  ): EntityTraceStage => ({
    stage: name, module, status: blocked ? 'BLOCKED' : at ? 'DONE' : 'PENDING', at, refs,
  });
  const stages: EntityTraceStage[] = [
    stage('Créée', 'TRANSPORTATION', input.createdAt, false, [input.rootId]),
    stage('Préparée', 'WMS', input.pickedAt, input.pickBlocked, input.refs.pickOrders),
    stage('Dispatchée', 'TRANSPORTATION', input.dispatchedAt, false, input.refs.loads),
    stage('Cour', 'YARD', input.yardAt, false, input.refs.yardVisits),
    stage('Livrée', 'TRANSPORTATION', input.deliveredAt, false, input.refs.shipments),
    stage('Facturée', 'BILLING', input.billedAt, false, input.refs.invoices),
  ];
  return { rootType: input.rootType, rootId: input.rootId, stages };
}
