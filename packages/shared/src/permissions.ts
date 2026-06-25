import { MODULE_KEYS, type ModuleKey } from './modules';

/**
 * Global permission catalog. Permission keys follow `<module>.<resource>.<action>`.
 * Roles are tenant-scoped and reference these keys; the catalog itself is platform-wide
 * and seeded into the database (see packages/database/prisma/seed.ts).
 */
export const PERMISSIONS = {
  CORE: {
    TENANT_READ: 'core.tenant.read',
    TENANT_MANAGE: 'core.tenant.manage',
    USERS_READ: 'core.users.read',
    USERS_MANAGE: 'core.users.manage',
    ROLES_READ: 'core.roles.read',
    ROLES_MANAGE: 'core.roles.manage',
    AUDIT_READ: 'core.audit.read',
    DOCUMENTS_READ: 'core.documents.read',
    DOCUMENTS_MANAGE: 'core.documents.manage',
    INTEGRATIONS_READ: 'core.integrations.read',
    INTEGRATIONS_MANAGE: 'core.integrations.manage',
    MODULES_READ: 'core.modules.read',
    MODULES_MANAGE: 'core.modules.manage',
    API_KEYS_READ: 'core.api-keys.read',
    API_KEYS_MANAGE: 'core.api-keys.manage',
    AGENTS_READ: 'core.agents.read',
    AGENTS_MANAGE: 'core.agents.manage',
    AGENTS_ACTIONS_READ: 'core.agents.actions.read',
    AGENTS_ACTIONS_APPROVE: 'core.agents.actions.approve',
    AGENTS_CHAT: 'core.agents.chat',
    OPERATING_TASKS_READ: 'core.operating.tasks.read',
    OPERATING_TASKS_MANAGE: 'core.operating.tasks.manage',
    CONNECT_READ: 'core.connect.read',
    CONNECT_MANAGE: 'core.connect.manage',
    AUTOMATION_RULES_READ: 'core.automation.rules.read',
    AUTOMATION_RULES_MANAGE: 'core.automation.rules.manage',
    EMAIL_READ: 'core.email.read',
    EMAIL_SEND: 'core.email.send',
    EMAIL_MANAGE: 'core.email.manage',
  },
  TRANSPORTATION: {
    MASTER_DATA_READ: 'transportation.master-data.read',
    MASTER_DATA_MANAGE: 'transportation.master-data.manage',
    ORDERS_READ: 'transportation.orders.read',
    ORDERS_MANAGE: 'transportation.orders.manage',
    PLANNING_READ: 'transportation.planning.read',
    PLANNING_MANAGE: 'transportation.planning.manage',
    EXECUTION_MANAGE: 'transportation.execution.manage',
    RATES_READ: 'transportation.rates.read',
    RATES_MANAGE: 'transportation.rates.manage',
    ACCESSORIALS_READ: 'transportation.accessorials.read',
    ACCESSORIALS_MANAGE: 'transportation.accessorials.manage',
    FUEL_TABLES_READ: 'transportation.fuel-tables.read',
    FUEL_TABLES_MANAGE: 'transportation.fuel-tables.manage',
    TRACKING_READ: 'transportation.tracking.read',
    TRACKING_WRITE: 'transportation.tracking.write',
    ANALYTICS_READ: 'transportation.analytics.read',
  },
  CUSTOMER_PORTAL: {
    LINKS_MANAGE: 'customer-portal.links.manage',
  },
  CARRIER_PORTAL: {
    LINKS_MANAGE: 'carrier-portal.links.manage',
    READ: 'carrier-portal.read',
  },
  BILLING: {
    INVOICES_READ: 'billing.invoices.read',
    INVOICES_MANAGE: 'billing.invoices.manage',
    INVOICES_PAY: 'billing.invoices.pay',
    FREIGHT_AUDIT_READ: 'billing.freight-audit.read',
    FREIGHT_AUDIT_MANAGE: 'billing.freight-audit.manage',
    CUSTOMER_INVOICES_READ: 'billing.customer-invoices.read',
    CUSTOMER_INVOICES_MANAGE: 'billing.customer-invoices.manage',
    CUSTOMER_INVOICES_SEND: 'billing.customer-invoices.send',
    CUSTOMER_INVOICES_PAY: 'billing.customer-invoices.pay',
    LEDGER_READ: 'billing.ledger.read',
    LEDGER_MANAGE: 'billing.ledger.manage',
    PAYMENTS_READ: 'billing.payments.read',
    PAYMENTS_MANAGE: 'billing.payments.manage',
    SUBSCRIPTIONS_READ: 'billing.subscriptions.read',
    SUBSCRIPTIONS_MANAGE: 'billing.subscriptions.manage',
    TAXES_READ: 'billing.taxes.read',
    TAXES_MANAGE: 'billing.taxes.manage',
    ASSETS_READ: 'billing.assets.read',
    ASSETS_MANAGE: 'billing.assets.manage',
  },
  FLEET: {
    READ: 'fleet.read',
    MANAGE: 'fleet.manage',
  },
  WMS: {
    READ: 'wms.read',
    MANAGE: 'wms.manage',
  },
  YARD: {
    READ: 'yard.read',
    MANAGE: 'yard.manage',
  },
  ANALYTICS: {
    READ: 'analytics.read',
  },
  PROCUREMENT: {
    READ: 'procurement.read',
    MANAGE: 'procurement.manage',
  },
  CRM: {
    READ: 'crm.read',
    MANAGE: 'crm.manage',
  },
  SITES: {
    READ: 'sites.read',
    MANAGE: 'sites.manage',
  },
  EMAIL: {
    READ: 'core.email.read',
    SEND: 'core.email.send',
    MANAGE: 'core.email.manage',
  },
} as const;

export type PermissionKey =
  | (typeof PERMISSIONS.CORE)[keyof typeof PERMISSIONS.CORE]
  | (typeof PERMISSIONS.TRANSPORTATION)[keyof typeof PERMISSIONS.TRANSPORTATION]
  | (typeof PERMISSIONS.CUSTOMER_PORTAL)[keyof typeof PERMISSIONS.CUSTOMER_PORTAL]
  | (typeof PERMISSIONS.BILLING)[keyof typeof PERMISSIONS.BILLING]
  | (typeof PERMISSIONS.FLEET)[keyof typeof PERMISSIONS.FLEET]
  | (typeof PERMISSIONS.WMS)[keyof typeof PERMISSIONS.WMS]
  | (typeof PERMISSIONS.YARD)[keyof typeof PERMISSIONS.YARD]
  | (typeof PERMISSIONS.ANALYTICS)[keyof typeof PERMISSIONS.ANALYTICS]
  | (typeof PERMISSIONS.PROCUREMENT)[keyof typeof PERMISSIONS.PROCUREMENT]
  | (typeof PERMISSIONS.CARRIER_PORTAL)[keyof typeof PERMISSIONS.CARRIER_PORTAL]
  | (typeof PERMISSIONS.CRM)[keyof typeof PERMISSIONS.CRM]
  | (typeof PERMISSIONS.SITES)[keyof typeof PERMISSIONS.SITES]
  | (typeof PERMISSIONS.EMAIL)[keyof typeof PERMISSIONS.EMAIL];

export interface PermissionDescriptor {
  key: PermissionKey;
  module: ModuleKey;
  description: string;
}

const core = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.CORE,
  description,
});
const tms = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.TRANSPORTATION,
  description,
});
const portal = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.CUSTOMER_PORTAL,
  description,
});
const billing = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.BILLING,
  description,
});
const fleet = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.FLEET,
  description,
});
const wms = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.WMS,
  description,
});
const yard = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.YARD,
  description,
});
const analytics = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.ANALYTICS,
  description,
});
const procurement = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.PROCUREMENT,
  description,
});
const carrierPortal = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.CARRIER_PORTAL,
  description,
});
const crm = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.CRM,
  description,
});
const sites = (key: PermissionKey, description: string): PermissionDescriptor => ({
  key,
  module: MODULE_KEYS.SITES,
  description,
});

export const PERMISSION_CATALOG: PermissionDescriptor[] = [
  core(PERMISSIONS.CORE.TENANT_READ, 'View tenant profile and settings'),
  core(PERMISSIONS.CORE.TENANT_MANAGE, 'Update tenant settings'),
  core(PERMISSIONS.CORE.USERS_READ, 'View users'),
  core(PERMISSIONS.CORE.USERS_MANAGE, 'Create, update and deactivate users'),
  core(PERMISSIONS.CORE.ROLES_READ, 'View roles and permissions'),
  core(PERMISSIONS.CORE.ROLES_MANAGE, 'Manage roles and permission assignments'),
  core(PERMISSIONS.CORE.AUDIT_READ, 'View audit logs'),
  core(PERMISSIONS.CORE.DOCUMENTS_READ, 'View documents'),
  core(PERMISSIONS.CORE.DOCUMENTS_MANAGE, 'Upload and delete documents'),
  core(PERMISSIONS.CORE.INTEGRATIONS_READ, 'View integrations'),
  core(PERMISSIONS.CORE.INTEGRATIONS_MANAGE, 'Configure integrations'),
  core(PERMISSIONS.CORE.MODULES_READ, 'View enabled modules'),
  core(PERMISSIONS.CORE.MODULES_MANAGE, 'Enable or disable modules for the tenant'),
  core(PERMISSIONS.CORE.API_KEYS_READ, 'View API keys'),
  core(PERMISSIONS.CORE.API_KEYS_MANAGE, 'Create and revoke API keys'),
  core(PERMISSIONS.CORE.AGENTS_READ, 'View AI agents and their configuration'),
  core(PERMISSIONS.CORE.AGENTS_MANAGE, 'Register, configure and revoke AI agents'),
  core(PERMISSIONS.CORE.AGENTS_ACTIONS_READ, 'View agent-proposed actions'),
  core(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE, 'Approve or reject agent-proposed actions'),
  core(PERMISSIONS.CORE.AGENTS_CHAT, 'Converse with AI agents (⌘K assistant)'),
  core(PERMISSIONS.CORE.OPERATING_TASKS_READ, 'View the operating workbench (tasks & exceptions)'),
  core(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE, 'Assign, resolve and dismiss operating tasks'),
  core(PERMISSIONS.CORE.CONNECT_READ, 'View the Connect inbox and imports'),
  core(PERMISSIONS.CORE.CONNECT_MANAGE, 'Run imports and manage inbound messages'),
  core(PERMISSIONS.CORE.AUTOMATION_RULES_READ, 'View tenant automation rules'),
  core(PERMISSIONS.CORE.AUTOMATION_RULES_MANAGE, 'Create, update and delete automation rules'),
  core(PERMISSIONS.CORE.EMAIL_READ, 'View sent emails and templates'),
  core(PERMISSIONS.CORE.EMAIL_SEND, 'Compose and send emails'),
  core(PERMISSIONS.CORE.EMAIL_MANAGE, 'Manage email templates and tenant email configuration'),
  tms(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ, 'View customers, locations, carriers, fleet'),
  tms(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE, 'Manage customers, locations, carriers, fleet'),
  tms(PERMISSIONS.TRANSPORTATION.ORDERS_READ, 'View transport orders'),
  tms(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE, 'Create, confirm and cancel transport orders'),
  tms(PERMISSIONS.TRANSPORTATION.PLANNING_READ, 'View shipments, loads and routes'),
  tms(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE, 'Plan shipments, build loads and routes'),
  tms(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE, 'Dispatch loads and record execution events'),
  tms(PERMISSIONS.TRANSPORTATION.RATES_READ, 'View rates'),
  tms(PERMISSIONS.TRANSPORTATION.RATES_MANAGE, 'Manage rates'),
  tms(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_READ, 'View accessorial catalog'),
  tms(PERMISSIONS.TRANSPORTATION.ACCESSORIALS_MANAGE, 'Manage accessorial catalog'),
  tms(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_READ, 'View fuel surcharge tables'),
  tms(PERMISSIONS.TRANSPORTATION.FUEL_TABLES_MANAGE, 'Manage fuel surcharge tables'),
  tms(PERMISSIONS.TRANSPORTATION.TRACKING_READ, 'View tracking events and PODs'),
  tms(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE, 'Record tracking events and PODs'),
  tms(PERMISSIONS.TRANSPORTATION.ANALYTICS_READ, 'View carrier scorecards and KPIs'),
  portal(PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE, 'Generate and revoke customer portal links'),
  billing(PERMISSIONS.BILLING.INVOICES_READ, 'View carrier invoices'),
  billing(PERMISSIONS.BILLING.INVOICES_MANAGE, 'Draft and approve carrier invoices'),
  billing(PERMISSIONS.BILLING.INVOICES_PAY, 'Mark carrier invoices as paid'),
  billing(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ, 'View incoming carrier invoices and audit results'),
  billing(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE, 'Audit, dispute and resolve incoming carrier invoices'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ, 'View customer billing statements'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE, 'Draft, approve and delete customer billing statements'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_SEND, 'Send customer billing statements'),
  billing(PERMISSIONS.BILLING.CUSTOMER_INVOICES_PAY, 'Mark customer billing statements as paid'),
  billing(PERMISSIONS.BILLING.LEDGER_READ, 'View the general ledger'),
  billing(PERMISSIONS.BILLING.LEDGER_MANAGE, 'Manage the general ledger (manual journal entries, chart of accounts)'),
  billing(PERMISSIONS.BILLING.PAYMENTS_READ, 'View payments'),
  billing(PERMISSIONS.BILLING.PAYMENTS_MANAGE, 'Record and submit payments'),
  billing(PERMISSIONS.BILLING.SUBSCRIPTIONS_READ, 'View subscriptions'),
  billing(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE, 'Manage subscriptions and recurring billing'),
  billing(PERMISSIONS.BILLING.TAXES_READ, 'View tax templates'),
  billing(PERMISSIONS.BILLING.TAXES_MANAGE, 'Manage tax templates'),
  billing(PERMISSIONS.BILLING.ASSETS_READ, 'View fixed assets'),
  billing(PERMISSIONS.BILLING.ASSETS_MANAGE, 'Manage fixed assets and depreciation'),
  fleet(PERMISSIONS.FLEET.READ, 'View fleet assets, maintenance and compliance'),
  fleet(PERMISSIONS.FLEET.MANAGE, 'Manage maintenance orders and compliance documents'),
  wms(PERMISSIONS.WMS.READ, 'View warehouse inventory, receipts and pick orders'),
  wms(PERMISSIONS.WMS.MANAGE, 'Manage warehouse items, bins, receipts and pick orders'),
  yard(PERMISSIONS.YARD.READ, 'View yard spots, visits and dock appointments'),
  yard(PERMISSIONS.YARD.MANAGE, 'Manage yard spots, gate check-in/out, moves and appointments'),
  analytics(PERMISSIONS.ANALYTICS.READ, 'View the operational Control Tower and analytics'),
  procurement(PERMISSIONS.PROCUREMENT.READ, 'View RFPs, bids, invites and routing guide'),
  procurement(PERMISSIONS.PROCUREMENT.MANAGE, 'Manage RFPs, invite carriers, evaluate bids and award lanes'),
  carrierPortal(PERMISSIONS.CARRIER_PORTAL.LINKS_MANAGE, 'Generate and revoke carrier portal links'),
  carrierPortal(PERMISSIONS.CARRIER_PORTAL.READ, 'View carrier portal configuration and access links'),
  // CRM
  crm(PERMISSIONS.CRM.READ, 'View CRM companies, contacts, deals and activities'),
  crm(PERMISSIONS.CRM.MANAGE, 'Create and manage CRM records, advance and convert deals'),
  // Sites
  sites(PERMISSIONS.SITES.READ, 'View sites & landing pages'),
  sites(PERMISSIONS.SITES.MANAGE, 'Create and manage sites & landing pages'),
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);
