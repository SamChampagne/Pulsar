import { describe, it, expect } from 'vitest';
import {
  moduleOfEventType,
  moduleOfSubjectType,
  buildFlowChains,
  buildFlowMap,
  buildEntityTrace,
  deriveReactionKpis,
  moduleOfReaction,
  type FlowEvent,
  type FlowTask,
  type FlowAction,
  type FlowReaction,
} from './flow';

describe('moduleOfEventType', () => {
  it('maps prefixes to modules', () => {
    expect(moduleOfEventType('wms.pick.completed')).toBe('WMS');
    expect(moduleOfEventType('yard.visit.detention')).toBe('YARD');
    expect(moduleOfEventType('fleet.asset.maintenance')).toBe('FLEET');
    expect(moduleOfEventType('tender.declined')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('stop.delayed')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('driver.exception')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('carrier-invoice.received')).toBe('BILLING');
    expect(moduleOfEventType('portal.change-request')).toBe('CUSTOMER_PORTAL');
    // TMS lifecycle events attribute to TRANSPORTATION (not CORE).
    expect(moduleOfEventType('load.completed')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('load.dispatched')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('transport-order.planned')).toBe('TRANSPORTATION');
    expect(moduleOfEventType('invoice.approved')).toBe('BILLING');
    expect(moduleOfEventType('something.unknown')).toBe('CORE');
  });
});

describe('moduleOfSubjectType', () => {
  it('maps subject types to modules', () => {
    expect(moduleOfSubjectType('load')).toBe('TRANSPORTATION');
    expect(moduleOfSubjectType('shipment')).toBe('TRANSPORTATION');
    expect(moduleOfSubjectType('stop')).toBe('TRANSPORTATION');
    expect(moduleOfSubjectType('yard-visit')).toBe('YARD');
    expect(moduleOfSubjectType('dock-appointment')).toBe('YARD');
    expect(moduleOfSubjectType('vehicle')).toBe('FLEET');
    expect(moduleOfSubjectType('trailer')).toBe('FLEET');
    expect(moduleOfSubjectType('invoice')).toBe('BILLING');
    expect(moduleOfSubjectType(null)).toBe('CORE');
    expect(moduleOfSubjectType('nope')).toBe('CORE');
  });
});

describe('buildFlowChains', () => {
  const ev: FlowEvent = { id: 'e1', type: 'wms.pick.completed', module: 'WMS', subjectType: 'shipment', subjectId: 's1', at: '2026-06-21T10:00:00.000Z' };
  const task: FlowTask = { id: 't1', category: 'FULFILLMENT_READY', status: 'RESOLVED', severity: 'INFO', subjectType: 'shipment', subjectId: 's1', sourceEventId: 'e1', assigneeAgentId: 'a1', at: '2026-06-21T10:01:00.000Z' };
  const action: FlowAction = { id: 'p1', tool: 'assign_shipment', status: 'EXECUTED', agentId: 'a1', triggeredByRef: 'task:t1', autoApproved: true, at: '2026-06-21T10:02:00.000Z' };

  it('links event -> task -> action into one chain', () => {
    const chains = buildFlowChains([ev], [task], [action]);
    expect(chains).toHaveLength(1);
    const c = chains[0];
    expect(c.event?.id).toBe('e1');
    expect(c.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(c.actions.map((a) => a.id)).toEqual(['p1']);
    expect(c.modules).toContain('WMS');
    expect(c.modules).toContain('TRANSPORTATION'); // task subject = shipment
    expect(c.crossModule).toBe(true);
    expect(c.startedAt).toBe('2026-06-21T10:00:00.000Z');
    expect(c.lastAt).toBe('2026-06-21T10:02:00.000Z');
  });

  it('emits an event-only chain when no task references it', () => {
    const chains = buildFlowChains([ev], [], []);
    expect(chains).toHaveLength(1);
    expect(chains[0].tasks).toEqual([]);
    expect(chains[0].crossModule).toBe(false);
  });

  it('emits an orphan-task chain (event null) when sourceEventId has no matching event', () => {
    const orphan: FlowTask = { ...task, id: 't2', sourceEventId: 'missing' };
    const chains = buildFlowChains([], [orphan], []);
    expect(chains).toHaveLength(1);
    expect(chains[0].event).toBeNull();
    expect(chains[0].tasks.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('buildFlowMap', () => {
  it('counts module event nodes and cross-module edges from chains', () => {
    const chains = buildFlowChains(
      [{ id: 'e1', type: 'wms.pick.completed', module: 'WMS', subjectType: 'shipment', subjectId: 's1', at: '2026-06-21T10:00:00.000Z' }],
      [{ id: 't1', category: 'FULFILLMENT_READY', status: 'OPEN', severity: 'INFO', subjectType: 'shipment', subjectId: 's1', sourceEventId: 'e1', assigneeAgentId: null, at: '2026-06-21T10:01:00.000Z' }],
      [],
    );
    const map = buildFlowMap(chains);
    expect(map.nodes.find((n) => n.module === 'WMS')?.eventCount).toBe(1);
    expect(map.edges).toContainEqual({ from: 'WMS', to: 'TRANSPORTATION', count: 1, kind: 'event' });
  });
});

const ev = (id: string, type: string): FlowEvent => ({ id, type, module: 'TRANSPORTATION', subjectType: 'load', subjectId: 'L1', at: '2026-06-22T10:00:00.000Z' });
const rx = (id: string, eventId: string, action: string, status = 'EXECUTED'): FlowReaction => ({ id, action, status, module: 'BILLING', eventId, at: '2026-06-22T10:00:01.000Z' });

describe('flow reactions', () => {
  it('attaches reactions to their event chain', () => {
    const chains = buildFlowChains([ev('e1', 'load.completed')], [], [], [rx('r1', 'e1', 'draft_customer_invoice')]);
    expect(chains[0].reactions).toHaveLength(1);
    expect(chains[0].modules).toContain('BILLING');
    expect(chains[0].crossModule).toBe(true);
  });
  it('back-compat: omitting reactions equals the 3-arg behavior', () => {
    const a = buildFlowChains([ev('e1', 'load.completed')], [], []);
    expect(a[0].reactions).toEqual([]);
  });
  it('buildFlowMap emits a reaction edge distinct from event edges', () => {
    const chains = buildFlowChains([ev('e1', 'load.completed')], [], [], [rx('r1', 'e1', 'draft_customer_invoice')]);
    const map = buildFlowMap(chains);
    const redge = map.edges.find((e) => e.kind === 'reaction');
    expect(redge).toMatchObject({ from: 'TRANSPORTATION', to: 'BILLING', kind: 'reaction' });
  });
  it('deriveReactionKpis counts executed/failed and sorts byAction', () => {
    const k = deriveReactionKpis([rx('r1', 'e1', 'a'), rx('r2', 'e1', 'a'), rx('r3', 'e2', 'b', 'FAILED')]);
    expect(k.executed).toBe(2); expect(k.failed).toBe(1);
    expect(k.byAction[0]).toEqual({ action: 'a', executed: 2, failed: 0 });
  });
  it('moduleOfReaction maps a known reaction to its FlowModule', () => {
    expect(moduleOfReaction('draft_customer_invoice')).toBe('BILLING');
    expect(moduleOfReaction('nonexistent')).toBe('CORE');
  });
});

describe('buildEntityTrace', () => {
  it('derives stage statuses with a blocked pick', () => {
    const trace = buildEntityTrace({
      rootType: 'TRANSPORT_ORDER', rootId: 'o1',
      createdAt: '2026-06-21T09:00:00.000Z', pickedAt: null, pickBlocked: true,
      dispatchedAt: null, yardAt: null, deliveredAt: null, billedAt: null,
      refs: { shipments: ['s1'], loads: [], pickOrders: ['pk1'], yardVisits: [], invoices: [] },
    });
    const byStage = Object.fromEntries(trace.stages.map((s) => [s.stage, s.status]));
    expect(byStage['Créée']).toBe('DONE');
    expect(byStage['Préparée']).toBe('BLOCKED');
    expect(byStage['Dispatchée']).toBe('PENDING');
    expect(trace.rootId).toBe('o1');
  });
});
