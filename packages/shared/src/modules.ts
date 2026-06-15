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
    name: 'Transportation Management',
    description: 'Transport orders, shipments, loads, routing, carrier execution, tracking, POD.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.FLEET,
    name: 'Fleet Management',
    description: 'Asset lifecycle, maintenance, compliance for owned fleets.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.YARD,
    name: 'Yard Management',
    description: 'Gate check-in/out, dock scheduling, yard moves.',
    isCore: false,
    available: true,
  },
  {
    key: MODULE_KEYS.WMS,
    name: 'Light WMS',
    description: 'Receiving, putaway, picking for light warehouse operations.',
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
    available: false,
  },
  {
    key: MODULE_KEYS.BILLING,
    name: 'Billing',
    description: 'Freight billing, invoicing, carrier settlement.',
    isCore: false,
    available: true,
  },
];
