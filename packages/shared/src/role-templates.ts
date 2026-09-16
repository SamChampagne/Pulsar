import { MODULE_KEYS, type ModuleKey } from './modules';
import { PERMISSIONS, PERMISSION_CATALOG, type PermissionKey } from './permissions';

/**
 * Human role templates: a curated starting set of permissions for a named job function
 * (dispatcher, billing clerk, warehouse operator, ...). Purely descriptive data — assigning
 * a template to a role just copies its resolved `permissionKeys` at that instant; there is
 * no live link afterwards. Pure data (browser-safe, no Node imports).
 */
export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  /** Module this template requires to be enabled for the tenant; `null` = always available (core). */
  module: ModuleKey | null;
  permissionKeys: PermissionKey[];
  /**
   * When true, `resolveRoleTemplates` computes `permissionKeys` dynamically as every
   * `.read` permission of core + the tenant's enabled modules, ignoring `permissionKeys`.
   */
  readOnlyOfEnabledModules?: true;
}

export interface ResolvedRoleTemplate {
  key: string;
  name: string;
  description: string;
  module: ModuleKey | null;
  permissionKeys: PermissionKey[];
}

const P = PERMISSIONS;

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: 'viewer',
    name: 'Lecture seule',
    description: 'Consulte tout ce qui est activé, ne modifie rien.',
    module: null,
    permissionKeys: [],
    readOnlyOfEnabledModules: true,
  },
  {
    key: 'dispatcher',
    name: 'Répartiteur',
    description: 'Planifie et exécute le transport.',
    module: MODULE_KEYS.TRANSPORTATION,
    permissionKeys: [
      P.TRANSPORTATION.MASTER_DATA_READ,
      P.TRANSPORTATION.ORDERS_READ,
      P.TRANSPORTATION.ORDERS_MANAGE,
      P.TRANSPORTATION.PLANNING_READ,
      P.TRANSPORTATION.PLANNING_MANAGE,
      P.TRANSPORTATION.EXECUTION_MANAGE,
      P.TRANSPORTATION.TRACKING_READ,
      P.TRANSPORTATION.TRACKING_WRITE,
      P.TRANSPORTATION.RATES_READ,
      P.TRANSPORTATION.ACCESSORIALS_READ,
      P.TRANSPORTATION.FUEL_TABLES_READ,
      P.TRANSPORTATION.ANALYTICS_READ,
      P.CORE.LOCATIONS_READ,
      P.CORE.LOCATIONS_MANAGE,
      P.CORE.DOCUMENTS_READ,
      P.CORE.OPERATING_TASKS_READ,
      P.CORE.OPERATING_TASKS_MANAGE,
      P.CORE.AGENTS_CHAT,
    ],
  },
  {
    key: 'billing-clerk',
    name: 'Commis à la facturation',
    description: 'Traite les factures transporteur et les relevés clients au quotidien.',
    module: MODULE_KEYS.BILLING,
    permissionKeys: [
      P.BILLING.INVOICES_READ,
      P.BILLING.INVOICES_MANAGE,
      P.BILLING.INVOICES_PAY,
      P.BILLING.FREIGHT_AUDIT_READ,
      P.BILLING.FREIGHT_AUDIT_MANAGE,
      P.BILLING.CUSTOMER_INVOICES_READ,
      P.BILLING.CUSTOMER_INVOICES_MANAGE,
      P.BILLING.CUSTOMER_INVOICES_SEND,
      P.BILLING.CUSTOMER_INVOICES_PAY,
      P.BILLING.PAYMENTS_READ,
      P.BILLING.PAYMENTS_MANAGE,
      P.BILLING.TAXES_READ,
      P.BILLING.SUBSCRIPTIONS_READ,
      P.BILLING.LEDGER_READ,
      P.CORE.DOCUMENTS_READ,
    ],
  },
  {
    key: 'accountant',
    name: 'Comptable',
    description: 'Tient le grand livre, la taxe, les actifs et les abonnements.',
    module: MODULE_KEYS.BILLING,
    permissionKeys: [
      P.BILLING.LEDGER_READ,
      P.BILLING.LEDGER_MANAGE,
      P.BILLING.TAXES_READ,
      P.BILLING.TAXES_MANAGE,
      P.BILLING.ASSETS_READ,
      P.BILLING.ASSETS_MANAGE,
      P.BILLING.PAYMENTS_READ,
      P.BILLING.INVOICES_READ,
      P.BILLING.CUSTOMER_INVOICES_READ,
      P.BILLING.SUBSCRIPTIONS_READ,
      P.BILLING.SUBSCRIPTIONS_MANAGE,
    ],
  },
  {
    key: 'warehouse-operator',
    name: "Opérateur d'entrepôt",
    description: 'Reçoit, range et prépare les commandes en entrepôt.',
    module: MODULE_KEYS.WMS,
    permissionKeys: [P.WMS.READ, P.WMS.MANAGE, P.CORE.LOCATIONS_READ, P.CORE.DOCUMENTS_READ],
  },
  {
    key: 'warehouse-manager',
    name: "Gestionnaire d'entrepôt",
    description: "Supervise l'entrepôt, les emplacements et les tâches opérationnelles.",
    module: MODULE_KEYS.WMS,
    permissionKeys: [
      P.WMS.READ,
      P.WMS.MANAGE,
      P.CORE.LOCATIONS_READ,
      P.CORE.LOCATIONS_MANAGE,
      P.CORE.DOCUMENTS_READ,
      P.CORE.DOCUMENTS_MANAGE,
      P.CORE.OPERATING_TASKS_READ,
      P.CORE.OPERATING_TASKS_MANAGE,
    ],
  },
  {
    key: 'yard-operator',
    name: 'Opérateur de cour',
    description: 'Gère les visites de cour et les rendez-vous de quai.',
    module: MODULE_KEYS.YARD,
    permissionKeys: [
      P.YARD.READ,
      P.YARD.MANAGE,
      P.CORE.LOCATIONS_READ,
      P.TRANSPORTATION.MASTER_DATA_READ,
    ],
  },
  {
    key: 'fleet-manager',
    name: 'Gestionnaire de flotte',
    description: 'Gère les actifs, la maintenance et la conformité de la flotte.',
    module: MODULE_KEYS.FLEET,
    permissionKeys: [
      P.FLEET.READ,
      P.FLEET.MANAGE,
      P.TRANSPORTATION.MASTER_DATA_READ,
      P.TRANSPORTATION.MASTER_DATA_MANAGE,
      P.CORE.DOCUMENTS_READ,
      P.CORE.DOCUMENTS_MANAGE,
    ],
  },
  {
    key: 'sales-rep',
    name: 'Représentant des ventes',
    description: 'Gère les contacts, les opportunités et les pages publiques.',
    module: MODULE_KEYS.CRM,
    permissionKeys: [
      P.CRM.READ,
      P.CRM.MANAGE,
      P.SITES.READ,
      P.CORE.EMAIL_READ,
      P.CORE.EMAIL_SEND,
      P.CORE.DOCUMENTS_READ,
    ],
  },
  {
    key: 'buyer',
    name: 'Acheteur',
    description: "Gère les appels d'offres, les invitations et le guide de routage.",
    module: MODULE_KEYS.PROCUREMENT,
    permissionKeys: [
      P.PROCUREMENT.READ,
      P.PROCUREMENT.MANAGE,
      P.TRANSPORTATION.RATES_READ,
      P.CORE.DOCUMENTS_READ,
    ],
  },
  {
    key: 'production-planner',
    name: 'Planificateur de production',
    description: 'Planifie les ordres de fabrication et les nomenclatures.',
    module: MODULE_KEYS.MANUFACTURING,
    permissionKeys: [
      P.MANUFACTURING.READ,
      P.MANUFACTURING.MANAGE,
      P.WMS.READ,
      P.CORE.APS_READ,
      P.CORE.DOCUMENTS_READ,
    ],
  },
];

/**
 * Resolves the role templates applicable to a tenant given its enabled modules:
 * - drops templates whose `module` is not enabled (`null` = always available);
 * - for `readOnlyOfEnabledModules`, computes every `.read` catalog key whose module is
 *   core or one of the enabled modules;
 * - defensively filters out any key not present in `PERMISSION_CATALOG`.
 */
export function resolveRoleTemplates(enabledModules: ModuleKey[]): ResolvedRoleTemplate[] {
  const allowed = new Set<ModuleKey>([MODULE_KEYS.CORE, ...enabledModules]);
  const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
  return ROLE_TEMPLATES.filter((t) => t.module === null || allowed.has(t.module)).map((t) => {
    const keys = t.readOnlyOfEnabledModules
      ? PERMISSION_CATALOG.filter((p) => allowed.has(p.module) && p.key.endsWith('.read')).map(
          (p) => p.key,
        )
      : t.permissionKeys.filter((k) => catalog.has(k));
    return {
      key: t.key,
      name: t.name,
      description: t.description,
      module: t.module,
      permissionKeys: [...new Set(keys)],
    };
  });
}
