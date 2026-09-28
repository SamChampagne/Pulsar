import { MODULE_KEYS as M } from './modules';
import { PERMISSIONS as P } from './permissions';

/** Only document access grants authorize a section, never a master-data grant. */
export const PARTY_WORKSPACE_SOURCES = [
  {
    key: 'service-project',
    label: 'Projets',
    module: M.SERVICES,
    permission: P.SERVICES.READ,
    family: 'partner',
  },
  {
    key: 'service-job',
    label: 'Interventions',
    module: M.SERVICES,
    permission: P.SERVICES.READ,
    family: 'partner',
  },
  {
    key: 'service-quote',
    label: 'Devis Services',
    module: M.SERVICES,
    permission: P.SERVICES.READ,
    family: 'partner',
  },
  {
    key: 'support-case',
    label: 'Demandes SAV',
    module: M.SUPPORT,
    permission: P.SUPPORT.READ,
    family: 'partner',
  },
  {
    key: 'customer-invoice',
    label: 'Factures clients',
    module: M.BILLING,
    permission: P.BILLING.CUSTOMER_INVOICES_READ,
    family: 'customer',
  },
  {
    key: 'crm-deal',
    label: 'Opportunités CRM',
    module: M.CRM,
    permission: P.CRM.READ,
    family: 'crm-company',
  },
  {
    key: 'crm-order',
    label: 'Commandes CRM',
    module: M.CRM,
    permission: P.CRM.READ,
    family: 'crm-company',
  },
  {
    key: 'transport-order',
    label: 'Commandes Transport',
    module: M.TRANSPORTATION,
    permission: P.TRANSPORTATION.ORDERS_READ,
    family: 'customer',
  },
] as const;
export type PartyWorkspaceSource = (typeof PARTY_WORKSPACE_SOURCES)[number]['key'];
export interface PartyWorkspaceRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  updatedAt: string;
  href: string;
}
export interface PartyWorkspaceView {
  owner: { id: string; name: string };
  observedAt: string;
  sections: Array<{ key: PartyWorkspaceSource; label: string; total: number; relation: string }>;
  source: PartyWorkspaceSource | null;
  items: PartyWorkspaceRow[];
  total: number;
  page: number;
  pageSize: number;
}
export function partyWorkspaceHref(source: PartyWorkspaceSource, id: string): string {
  const value = encodeURIComponent(id);
  switch (source) {
    case 'service-project':
      return `/services/projects/${value}`;
    case 'service-job':
      return `/services/interventions?jobId=${value}`;
    case 'service-quote':
      return `/services/quotes?quoteId=${value}`;
    case 'support-case':
      return `/support?caseId=${value}`;
    case 'customer-invoice':
      return `/invoices?statement=${value}`;
    case 'crm-deal':
      return `/crm/deals/${value}`;
    case 'crm-order':
      return `/crm/sales-orders/${value}`;
    case 'transport-order':
      return `/transport-orders/${value}`;
  }
}
