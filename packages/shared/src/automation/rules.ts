import { OperationalTaskType } from '../enums/operating';
import {
  DOMAIN_EVENT_TYPES,
  type DomainEventInput,
  type TaskSpec,
  type Severity,
  type AssignHint,
} from '../operating/policies';

/**
 * Tenant-configurable automation rules ("Quand <event> [Si <conditions>] Alors créer une tâche").
 * Purely additive layer on top of the hard-coded policies: this module is **pure** and
 * browser-safe (no Node imports). The API consults rules at the single integration point
 * (DomainEventsService.processPending) after resolvePolicies.
 */

export type RuleOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'exists'
  | 'not_exists';

export type RuleMatch = 'ALL' | 'ANY';

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: string | number | boolean;
}

export interface CreateTaskAction {
  kind: 'CREATE_TASK';
  /** OperationalTask category (reuse the existing ones or a custom string). */
  category: string;
  severity: Severity;
  /** Title with `{path.to.field}` interpolation against the event payload. */
  titleTemplate: string;
  assignHint: AssignHint;
  /** Dot-path of the subjectId in the payload (default: subjectId|id). */
  subjectField?: string;
  /** Defaults to the eventType. */
  subjectType?: string;
}

export interface RunActionAction {
  kind: 'RUN_ACTION';
  /** A REACTION_CATALOG key. */
  action: string;
  /** Arg templates interpolated from the event payload, e.g. { orderId: '{orderId}' }. */
  args: Record<string, string>;
}

export type RuleAction = CreateTaskAction | RunActionAction;

export interface ReactionCommand {
  ruleId: string;
  action: string;
  args: Record<string, string>;
}

export interface AutomationRuleLike {
  id: string;
  eventType: string;
  match: RuleMatch;
  conditions: RuleCondition[];
  action: RuleAction;
}

/**
 * Reads a nested value from `obj` following a dot-path (e.g. `subject.id`).
 * Returns undefined if any segment is missing or the target is not an object.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const segment of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

function compareNumbers(a: unknown, b: unknown, cmp: (x: number, y: number) => boolean): boolean {
  const x = typeof a === 'number' ? a : Number(a);
  const y = typeof b === 'number' ? b : Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return cmp(x, y);
}

/** Evaluates a single condition against the payload. */
function evaluateCondition(condition: RuleCondition, payload: Record<string, unknown>): boolean {
  const actual = getByPath(payload, condition.field);
  const expected = condition.value;
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'eq':
      // eslint-disable-next-line eqeqeq -- loose equality bridges "5" vs 5 from form inputs
      return actual == expected;
    case 'neq':
      // eslint-disable-next-line eqeqeq
      return actual != expected;
    case 'gt':
      return compareNumbers(actual, expected, (x, y) => x > y);
    case 'gte':
      return compareNumbers(actual, expected, (x, y) => x >= y);
    case 'lt':
      return compareNumbers(actual, expected, (x, y) => x < y);
    case 'lte':
      return compareNumbers(actual, expected, (x, y) => x <= y);
    case 'contains':
      return String(actual ?? '').includes(String(expected ?? ''));
    default:
      return false;
  }
}

/**
 * Evaluates a set of conditions with ALL (every) or ANY (some) semantics.
 * Empty conditions ⇒ true (the rule always fires for its event).
 */
export function evaluateRuleConditions(
  conditions: RuleCondition[],
  match: RuleMatch,
  payload: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  if (match === 'ANY') return conditions.some((c) => evaluateCondition(c, payload));
  return conditions.every((c) => evaluateCondition(c, payload));
}

/**
 * Replaces `{path.to.field}` tokens with the payload value (empty string if missing).
 */
export function interpolateTemplate(tpl: string, payload: Record<string, unknown>): string {
  if (!tpl) return '';
  return tpl.replace(/\{([^}]+)\}/g, (_match, rawPath: string) => {
    const value = getByPath(payload, rawPath.trim());
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Resolves the subjectId following the fallback chain:
 * action.subjectField → payload.subjectId → payload.id → event-level subjectId.
 */
function resolveSubjectId(action: CreateTaskAction, rule: AutomationRuleLike, event: DomainEventInput): string | null {
  const payload = event.payload ?? {};
  const candidates: unknown[] = [];
  if (action.subjectField) candidates.push(getByPath(payload, action.subjectField));
  candidates.push(payload.subjectId);
  candidates.push(payload.id);
  candidates.push((event as { subjectId?: unknown }).subjectId);
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
    if (typeof c === 'number') return String(c);
  }
  return null;
}

/**
 * Produces a TaskSpec for a custom rule against an event, or null if no subjectId can be resolved.
 * dedupKey is always `rule:${rule.id}:${subjectId}` — cannot collide with hard-coded policy keys.
 * This does NOT evaluate conditions — call evaluateRuleConditions first.
 */
export function produceRuleTaskSpec(
  rule: AutomationRuleLike,
  event: DomainEventInput,
): TaskSpec | null {
  if (rule.action.kind !== 'CREATE_TASK') return null;
  const action = rule.action;
  const subjectId = resolveSubjectId(action, rule, event);
  if (!subjectId) return null;
  const payload = event.payload ?? {};
  return {
    type: OperationalTaskType.EXCEPTION,
    category: action.category,
    severity: action.severity,
    title: interpolateTemplate(action.titleTemplate, payload),
    subjectType: action.subjectType || event.type,
    subjectId,
    dedupKey: `rule:${rule.id}:${subjectId}`,
    details: { ...payload },
    assignHint: action.assignHint,
  };
}

/** Produces a ReactionCommand for a RUN_ACTION rule (args interpolated), or null otherwise. */
export function produceRuleReaction(
  rule: AutomationRuleLike,
  event: DomainEventInput,
): ReactionCommand | null {
  if (rule.action.kind !== 'RUN_ACTION') return null;
  const payload = event.payload ?? {};
  const args: Record<string, string> = {};
  for (const [k, tpl] of Object.entries(rule.action.args)) {
    args[k] = interpolateTemplate(tpl, payload);
  }
  return { ruleId: rule.id, action: rule.action.action, args };
}

export interface AutomationEventField {
  path: string;
  label: string;
  kind: 'string' | 'number' | 'boolean';
}

export interface AutomationEventDescriptor {
  type: string;
  label: string;
  description: string;
  fields: AutomationEventField[];
  defaultSubjectField: string;
}

const f = (
  path: string,
  label: string,
  kind: 'string' | 'number' | 'boolean' = 'string',
): AutomationEventField => ({ path, label, kind });

/**
 * One descriptor per DOMAIN_EVENT_TYPES value. Fields are derived from the real payloads
 * emitted by the hard-coded policies (and their emit sites). Drives the builder dropdowns.
 */
export const AUTOMATION_EVENT_CATALOG: AutomationEventDescriptor[] = [
  {
    type: DOMAIN_EVENT_TYPES.STOP_DELAYED,
    label: 'Stop en retard',
    description: "Un arrêt a dépassé sa fenêtre — la tâche escalade selon les minutes de retard.",
    fields: [
      f('stopId', 'ID arrêt'),
      f('loadId', 'ID load'),
      f('deadline', 'Échéance'),
      f('minutesLate', 'Minutes de retard', 'number'),
    ],
    defaultSubjectField: 'stopId',
  },
  {
    type: DOMAIN_EVENT_TYPES.TENDER_DECLINED,
    label: 'Soumission refusée',
    description: "Un transporteur a refusé une soumission (tender) sur un load.",
    fields: [
      f('tenderId', 'ID tender'),
      f('loadId', 'ID load'),
      f('loadNumber', 'N° load'),
      f('carrierId', 'ID transporteur'),
    ],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.TENDER_EXPIRED,
    label: 'Soumission expirée',
    description: "Une soumission (tender) a expiré sans réponse du transporteur.",
    fields: [
      f('tenderId', 'ID tender'),
      f('loadId', 'ID load'),
      f('loadNumber', 'N° load'),
      f('carrierId', 'ID transporteur'),
    ],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED,
    label: 'Facture transporteur reçue',
    description: "Une facture transporteur entrante est arrivée — audit requis.",
    fields: [f('invoiceId', 'ID facture'), f('carrierId', 'ID transporteur')],
    defaultSubjectField: 'invoiceId',
  },
  {
    type: DOMAIN_EVENT_TYPES.FLEET_ASSET_MAINTENANCE,
    label: 'Asset en maintenance',
    description: "Un véhicule/remorque entre en atelier et quitte le pool dispatchable.",
    fields: [
      f('assetKind', "Type d'asset"),
      f('assetId', 'ID asset'),
      f('unitNumber', 'N° unité'),
      f('woId', "ID ordre de travail"),
    ],
    defaultSubjectField: 'assetId',
  },
  {
    type: DOMAIN_EVENT_TYPES.FLEET_MAINTENANCE_DUE,
    label: 'Entretien préventif dû',
    description: "Un calendrier d'entretien préventif a atteint son point dû/en retard.",
    fields: [
      f('scheduleId', 'ID calendrier'),
      f('cycle', 'Cycle'),
      f('assetLabel', 'Libellé asset'),
      f('assetId', 'ID asset'),
      f('name', "Nom de l'entretien"),
      f('status', 'Statut'),
    ],
    defaultSubjectField: 'scheduleId',
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_PICK_COMPLETED,
    label: 'Préparation terminée',
    description: "Un pick order lié à un shipment est complété — fret prêt à expédier.",
    fields: [
      f('shipmentId', 'ID shipment'),
      f('shipmentNumber', 'N° shipment'),
      f('pickOrderId', 'ID pick order'),
    ],
    defaultSubjectField: 'shipmentId',
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_ITEM_BELOW_MIN,
    label: 'Article sous le minimum',
    description: "Un article est tombé au/sous son point de commande — réappro nécessaire.",
    fields: [
      f('itemId', 'ID article'),
      f('sku', 'SKU'),
      f('onHand', 'Stock disponible', 'number'),
      f('suggestedQty', 'Quantité suggérée', 'number'),
    ],
    defaultSubjectField: 'itemId',
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_CYCLE_COUNT_VARIANCE,
    label: "Écart de comptage cyclique",
    description: "Un comptage cyclique réconcilié a trouvé des écarts de stock.",
    fields: [
      f('cycleCountId', 'ID comptage'),
      f('number', 'N° comptage'),
      f('variances', 'Lignes en écart', 'number'),
    ],
    defaultSubjectField: 'cycleCountId',
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_IN,
    label: 'Arrivée en cour',
    description: "Un transporteur/remorque s'est enregistré à la guérite.",
    fields: [
      f('visitId', 'ID visite'),
      f('visitNumber', 'N° visite'),
      f('trailerLabel', 'Libellé remorque'),
    ],
    defaultSubjectField: 'visitId',
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_DETENTION,
    label: 'Détention en cour',
    description: "Une remorque a dépassé sa fenêtre libre — la détention s'accumule.",
    fields: [
      f('visitId', 'ID visite'),
      f('visitNumber', 'N° visite'),
      f('trailerLabel', 'Libellé remorque'),
      f('detentionMinutes', 'Minutes de détention', 'number'),
    ],
    defaultSubjectField: 'visitId',
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_APPOINTMENT_LATE,
    label: 'Rendez-vous quai en retard',
    description: "Un rendez-vous de quai planifié est passé et non honoré.",
    fields: [
      f('appointmentId', 'ID rendez-vous'),
      f('number', 'N° rendez-vous'),
      f('minutesLate', 'Minutes de retard', 'number'),
    ],
    defaultSubjectField: 'appointmentId',
  },
  {
    type: DOMAIN_EVENT_TYPES.DRIVER_EXCEPTION,
    label: 'Exception conducteur',
    description: "Un conducteur a signalé un incident (dommage, retard, refus, autre).",
    fields: [
      f('loadId', 'ID load'),
      f('loadNumber', 'N° load'),
      f('kind', "Type d'exception"),
      f('note', 'Note'),
      f('bucket', 'Tranche temporelle'),
    ],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST,
    label: 'Demande de changement client',
    description: "Un client a soumis une demande de changement via le portail.",
    fields: [
      f('subject.type', 'Type de sujet'),
      f('subject.id', 'ID sujet'),
      f('kind', 'Type de demande'),
      f('customerName', 'Nom du client'),
      f('note', 'Note'),
      f('bucket', 'Tranche temporelle'),
    ],
    defaultSubjectField: 'subject.id',
  },
  {
    type: DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_PLANNED,
    label: 'Commande planifiée',
    description: 'Une commande a été planifiée (ses shipments existent).',
    fields: [f('orderId', 'ID commande'), f('orderNumber', 'N° commande'), f('shipmentCount', 'Nb shipments', 'number')],
    defaultSubjectField: 'orderId',
  },
  {
    type: DOMAIN_EVENT_TYPES.LOAD_DISPATCHED,
    label: 'Load dispatché',
    description: 'Un load est passé en dispatché.',
    fields: [f('loadId', 'ID load'), f('loadNumber', 'N° load'), f('carrierId', 'ID transporteur')],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.LOAD_COMPLETED,
    label: 'Load livré',
    description: 'Un load est livré/complété.',
    fields: [f('loadId', 'ID load'), f('loadNumber', 'N° load')],
    defaultSubjectField: 'loadId',
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_OUT,
    label: 'Départ de cour',
    description: 'Une visite de cour a été clôturée (check-out).',
    fields: [f('visitId', 'ID visite'), f('visitNumber', 'N° visite')],
    defaultSubjectField: 'visitId',
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_RECEIPT_POSTED,
    label: 'Réception postée',
    description: 'Une réception entrepôt a été postée (stock disponible).',
    fields: [f('receiptId', 'ID réception'), f('number', 'N° réception')],
    defaultSubjectField: 'receiptId',
  },
];

export interface RuleOperatorDescriptor {
  operator: RuleOperator;
  label: string;
}

export const RULE_OPERATORS: RuleOperatorDescriptor[] = [
  { operator: 'eq', label: 'égal à' },
  { operator: 'neq', label: 'différent de' },
  { operator: 'gt', label: 'supérieur à' },
  { operator: 'gte', label: 'supérieur ou égal à' },
  { operator: 'lt', label: 'inférieur à' },
  { operator: 'lte', label: 'inférieur ou égal à' },
  { operator: 'contains', label: 'contient' },
  { operator: 'exists', label: 'existe' },
  { operator: 'not_exists', label: "n'existe pas" },
];

/** The hard-coded OperationalTask categories produced by the existing policies. */
export const SUGGESTED_TASK_CATEGORIES: string[] = [
  'DELAY',
  'TENDER_FAILURE',
  'FREIGHT_AUDIT',
  'FLEET_MAINTENANCE',
  'FLEET_PM_DUE',
  'FULFILLMENT_READY',
  'WMS_REPLENISH',
  'WMS_COUNT_VARIANCE',
  'YARD_ARRIVAL',
  'YARD_DETENTION',
  'YARD_APPOINTMENT_LATE',
];
