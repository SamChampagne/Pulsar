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
    TRACKING_READ: 'transportation.tracking.read',
    TRACKING_WRITE: 'transportation.tracking.write',
  },
} as const;

export type PermissionKey =
  | (typeof PERMISSIONS.CORE)[keyof typeof PERMISSIONS.CORE]
  | (typeof PERMISSIONS.TRANSPORTATION)[keyof typeof PERMISSIONS.TRANSPORTATION];

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
  tms(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ, 'View customers, locations, carriers, fleet'),
  tms(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE, 'Manage customers, locations, carriers, fleet'),
  tms(PERMISSIONS.TRANSPORTATION.ORDERS_READ, 'View transport orders'),
  tms(PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE, 'Create, confirm and cancel transport orders'),
  tms(PERMISSIONS.TRANSPORTATION.PLANNING_READ, 'View shipments, loads and routes'),
  tms(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE, 'Plan shipments, build loads and routes'),
  tms(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE, 'Dispatch loads and record execution events'),
  tms(PERMISSIONS.TRANSPORTATION.RATES_READ, 'View rates'),
  tms(PERMISSIONS.TRANSPORTATION.RATES_MANAGE, 'Manage rates'),
  tms(PERMISSIONS.TRANSPORTATION.TRACKING_READ, 'View tracking events and PODs'),
  tms(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE, 'Record tracking events and PODs'),
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);
