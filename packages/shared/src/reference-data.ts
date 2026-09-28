import { MODULE_KEYS, type ModuleKey } from './modules';
import { PERMISSIONS as P, type PermissionKey } from './permissions';

/** Explicit consumer grants. No module activation or role is inferred from a URL. */
export type ReferenceKind =
  | 'customer'
  | 'carrier'
  | 'driver'
  | 'vehicle'
  | 'trailer'
  | 'client'
  | 'supplier'
  | 'item';
export interface ReferenceAccess {
  module: ModuleKey;
  path: string;
  kind: ReferenceKind;
  label: string;
  read: PermissionKey;
  manage: PermissionKey;
}
const resources = (
  module: ModuleKey,
  prefix: string,
  read: PermissionKey,
  manage: PermissionKey,
  entries: [string, ReferenceKind, string][],
): ReferenceAccess[] =>
  entries.map(([resource, kind, label]) => ({
    module,
    path: `${prefix}/data/${resource}`,
    kind,
    label,
    read,
    manage,
  }));

export const REFERENCE_ACCESS: readonly ReferenceAccess[] = [
  ...resources(
    MODULE_KEYS.BILLING,
    'billing',
    P.BILLING.SUPPLIER_INVOICES_READ,
    P.BILLING.SUPPLIER_INVOICES_MANAGE,
    [['suppliers', 'supplier', 'Fournisseurs']],
  ),
  ...resources(MODULE_KEYS.WMS, 'wms', P.WMS.READ, P.WMS.MANAGE, [
    ['suppliers', 'supplier', 'Fournisseurs de retour'],
  ]),
  ...resources(MODULE_KEYS.CLIENTS, 'clients', P.CLIENTS.READ, P.CLIENTS.MANAGE, [
    ['customers', 'customer', 'Transport et facturation'],
    ['partners', 'client', 'Services et SAV'],
  ]),
  ...resources(
    MODULE_KEYS.CUSTOMER_PORTAL,
    'customer-portal/links',
    P.CUSTOMER_PORTAL.LINKS_MANAGE,
    P.CUSTOMER_PORTAL.USERS_MANAGE,
    [['customers', 'customer', 'Clients']],
  ),
  ...resources(MODULE_KEYS.FLEET, 'fleet', P.FLEET.READ, P.FLEET.MANAGE, [
    ['vehicles', 'vehicle', 'Véhicules'],
    ['trailers', 'trailer', 'Remorques'],
    ['drivers', 'driver', 'Chauffeurs'],
    ['carriers', 'carrier', 'Transporteurs'],
  ]),
  ...resources(MODULE_KEYS.YARD, 'yard', P.YARD.READ, P.YARD.MANAGE, [
    ['carriers', 'carrier', 'Transporteurs'],
    ['trailers', 'trailer', 'Remorques'],
    ['drivers', 'driver', 'Chauffeurs'],
  ]),
  ...resources(MODULE_KEYS.PROCUREMENT, 'procurement', P.PROCUREMENT.READ, P.PROCUREMENT.MANAGE, [
    ['carriers', 'carrier', 'Transporteurs'],
  ]),
  ...resources(
    MODULE_KEYS.BILLING,
    'billing',
    P.BILLING.CUSTOMER_INVOICES_READ,
    P.BILLING.CUSTOMER_INVOICES_MANAGE,
    [['customers', 'customer', 'Clients']],
  ),
  ...resources(MODULE_KEYS.BILLING, 'billing', P.BILLING.INVOICES_READ, P.BILLING.INVOICES_MANAGE, [
    ['carriers', 'carrier', 'Transporteurs'],
  ]),
  ...resources(
    MODULE_KEYS.BILLING,
    'billing/payments',
    P.BILLING.PAYMENTS_READ,
    P.BILLING.PAYMENTS_MANAGE,
    [
      ['customers', 'customer', 'Clients'],
      ['carriers', 'carrier', 'Transporteurs'],
    ],
  ),
  ...resources(
    MODULE_KEYS.BILLING,
    'billing/subscriptions',
    P.BILLING.SUBSCRIPTIONS_READ,
    P.BILLING.SUBSCRIPTIONS_MANAGE,
    [['customers', 'customer', 'Clients']],
  ),
  ...resources(
    MODULE_KEYS.BILLING,
    'billing/freight-audit',
    P.BILLING.FREIGHT_AUDIT_READ,
    P.BILLING.FREIGHT_AUDIT_MANAGE,
    [['carriers', 'carrier', 'Transporteurs']],
  ),
  ...resources(
    MODULE_KEYS.CUSTOMER_PORTAL,
    'customer-portal',
    P.CUSTOMER_PORTAL.USERS_READ,
    P.CUSTOMER_PORTAL.USERS_MANAGE,
    [['customers', 'customer', 'Clients']],
  ),
  ...resources(MODULE_KEYS.SERVICES, 'services', P.SERVICES.READ, P.SERVICES.MANAGE, [
    ['customers', 'client', 'Clients'],
    ['items', 'item', 'Articles et prestations'],
  ]),
  ...resources(MODULE_KEYS.SUPPORT, 'support', P.SUPPORT.READ, P.SUPPORT.MANAGE, [
    ['customers', 'client', 'Clients'],
  ]),
  ...resources(MODULE_KEYS.PURCHASING, 'purchasing', P.PURCHASING.READ, P.PURCHASING.MANAGE, [
    ['suppliers', 'supplier', 'Fournisseurs'],
    ['items', 'item', 'Articles et prestations'],
  ]),
];

export function referenceAccess(path: string): ReferenceAccess | undefined {
  return REFERENCE_ACCESS.find((entry) => `/${entry.path}` === path);
}
