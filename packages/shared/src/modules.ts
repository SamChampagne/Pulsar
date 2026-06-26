/**
 * Canonical module keys for the platform module registry.
 * A module can be enabled/disabled per tenant (see TenantModule in the database).
 * `core` is always implicitly enabled and cannot be disabled.
 */
export const MODULE_KEYS = {
  CORE: 'core',
  TRANSPORTATION: 'transportation',
  // Planned modules — declared here so keys are reserved from day one.
  FLEET: 'fleet',
  YARD: 'yard',
  WMS: 'wms',
  CUSTOMER_PORTAL: 'customer-portal',
  ANALYTICS: 'analytics',
  BILLING: 'billing',
  PROCUREMENT: 'procurement',
  CARRIER_PORTAL: 'carrier-portal',
  CRM: 'crm',
  MANUFACTURING: 'manufacturing',
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

export interface ModuleDescriptor {
  key: ModuleKey;
  name: string;
  description: string;
  isCore: boolean;
  /** Modules not yet implemented are registered but cannot be enabled. */
  available: boolean;
}

export const MODULE_CATALOG: ModuleDescriptor[] = [
  {
    key: MODULE_KEYS.CORE,
    name: 'Platform Core',
    description: 'Tenants, users, roles, permissions, audit, documents, notifications.',
    isCore: true,
    available: true,
  },
  {
    key: MODULE_KEYS.TRANSPORTATION,
    name: 'Transport / Operations',
    description: 'TMS, dispatch, loads, routing, carrier execution, tracking, POD.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.FLEET,
    name: 'Assets / Fleet',
    description: 'Physical assets, fleet, equipment, maintenance, compliance, assignments.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.YARD,
    name: 'Yard / Dock',
    description: 'Gate check-in/out, dock scheduling, yard moves, dwell and detention.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.WMS,
    name: 'Warehouse / Inventory',
    description: 'Inventory, receiving, putaway, picking and fulfillment.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.CUSTOMER_PORTAL,
    name: 'Customer Portal',
    description: 'Self-service order entry and shipment visibility for customers.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.ANALYTICS,
    name: 'Analytics',
    description: 'Operational KPIs, carrier scorecards, cost analysis.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.BILLING,
    name: 'Finance / Ledger',
    description: 'Receivables, payables, invoicing, payments, margin and invoice audit.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.PROCUREMENT,
    name: 'Procurement / Bid Board',
    description: 'RFP on lanes, carrier invitations, competitive bids, award and routing guide.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.CARRIER_PORTAL,
    name: 'Carrier Portal',
    description: 'Carrier-facing portal: tenders, loads, POD/invoice upload, payment status.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.CRM,
    name: 'CRM',
    description: 'Commercial relationships: companies, contacts, deals pipeline and activity timeline, worked by an AI commercial agent.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.MANUFACTURING,
    name: 'Manufacturing / APS',
    description:
      'Production master-data (work centers, calendars, routings, BOM) and manufacturing orders, scheduled by the PlaniAdvance APS engine.',
    isCore: false,
    available: true,
  },
];
