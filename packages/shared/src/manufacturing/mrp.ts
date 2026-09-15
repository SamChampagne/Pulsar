/** Decimal quantities are strings, never summed across different items or units. */
export enum MrpSourcingMethod {
  BUY = 'BUY',
  MAKE = 'MAKE',
}
export enum MrpEntryKind {
  DEMAND = 'DEMAND',
  SUPPLY = 'SUPPLY',
  FORECAST = 'FORECAST',
}
export interface MrpFlow {
  id: string;
  item_id: string;
  quantity: string;
  date: string;
  reference: string;
}
export interface MrpSnapshot {
  version: 'pulsar.mrp.v1';
  as_of: string;
  horizon_end: string;
  items: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    method: MrpSourcingMethod;
    on_hand: string;
    safety_stock: string;
    minimum_order: string;
    order_multiple: string;
    lead_days: number;
    components: { item_id: string; quantity: string }[];
  }[];
  demands: MrpFlow[];
  supplies: MrpFlow[];
}
export interface MrpProposal {
  id: string;
  item_id: string;
  method: MrpSourcingMethod;
  quantity: string;
  net_requirement: string;
  receipt_date: string;
  release_date: string;
  expedite: boolean;
  level: number;
  safety_stock: string;
  reasons: { source: string; reference: string; date: string; quantity: string }[];
}
export interface MrpResult {
  tenant_id: string;
  version: 'pulsar.mrp.v1';
  engine_revision: string;
  as_of: string;
  horizon_end: string;
  proposals: MrpProposal[];
  items: {
    item_id: string;
    sku: string;
    name: string;
    unit: string;
    method: MrpSourcingMethod;
    level: number;
    on_hand: string;
    gross_requirement: string;
    planned_receipts: string;
    projected_end: string;
    timeline: {
      date: string;
      gross: string;
      scheduled_receipts: string;
      planned_receipts: string;
      projected: string;
      sources: { id: string; reference: string; quantity: string }[];
    }[];
  }[];
  exceptions: { code: string; item_id: string; source: string; date: string; quantity: string }[];
  assumptions: string[];
}
