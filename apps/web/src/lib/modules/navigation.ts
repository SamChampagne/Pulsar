/**
 * Single source-of-truth for the Pulsar sidebar navigation catalogue.
 *
 * Consumed today by +layout.svelte (sidebar) and in the future by /apps and
 * the command palette. Use `visibleDomains(caps)` to get the filtered list for
 * a given user session.
 *
 * Icon imports are kept here so the layout doesn't import lucide icons that
 * already live in this module.
 */
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import {
  LayoutDashboard,
  Truck,
  Warehouse,
  Container,
  Boxes,
  CircleDollarSign,
  Bot,
  Settings,
  Cable,
  BarChart3,
  ClipboardList,
  FileText,
  Palette,
  Handshake,
  Mail,
  Globe,
  Factory,
} from 'lucide-svelte';
import type { ComponentType } from 'svelte';

export interface NavLink {
  href: string;
  label: string;
  /** Single permission key required to show this link. Omit = always shown when domain is visible. */
  perm?: string;
  /** Runtime-injected badge count; not set by the catalogue itself. */
  badge?: number;
}

export interface NavSection {
  label?: string;
  links: NavLink[];
}

export interface NavDomain {
  key: string;
  label: string;
  icon: ComponentType;
  /** Where clicking the domain icon / card lands. */
  home: string;
  /** Route prefixes that belong to this domain (for active-domain detection). */
  prefixes: string[];
  /** Single module key required to show this domain. Omit = always shown (subject to perms). */
  module?: string;
  /**
   * Any-of permission gate for the domain itself: domain is visible if the user holds
   * AT LEAST ONE of these permissions. When omitted (or empty), the domain is visible
   * to all users (subject to `module`). Used for domains that require at least one of
   * several permissions (e.g. agents: read OR workbench-read OR actions-read).
   */
  anyPerms?: string[];
  sections: NavSection[];
}

export interface NavCaps {
  enabledModules: string[];
  can: (perm: string) => boolean;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function navCatalogue(): NavDomain[] {
  return [
    // ── Plateforme (desk / home) ────────────────────────────────────────────
    {
      key: 'dashboard',
      label: 'Plateforme',
      icon: LayoutDashboard,
      home: '/apps',
      prefixes: ['/apps', '/framework', '/dashboard', '/onboarding'],
      // Always visible; no module or perm gate.
      sections: [
        {
          links: [
            { href: '/dashboard', label: 'Tableau de bord' },
            { href: '/apps', label: 'Pulsar Desk' },
            { href: '/onboarding', label: 'Onboarding' },
          ],
        },
      ],
    },

    // ── Transport ──────────────────────────────────────────────────────────
    {
      key: 'transport',
      label: 'Transport',
      icon: Truck,
      home: '/dispatch',
      module: MODULE_KEYS.TRANSPORTATION,
      prefixes: [
        '/transportation',
        '/dispatch',
        '/planning',
        '/transport-orders',
        '/shipments',
        '/loads',
        '/rate-studio',
        '/lanes',
        '/rates',
        '/accessorials',
        '/fuel-tables',
        '/customers',
        '/carriers',
        '/locations',
      ],
      sections: [
        {
          label: 'Exécution',
          links: [
            { href: '/dispatch', label: 'Dispatch' },
            {
              href: '/planning',
              label: 'Planification',
              perm: PERMISSIONS.TRANSPORTATION.PLANNING_READ,
            },
            { href: '/transport-orders', label: 'Ordres de transport' },
            { href: '/shipments', label: 'Expéditions' },
            { href: '/loads', label: 'Chargements' },
          ],
        },
        {
          label: 'Tarification',
          links: [
            {
              href: '/rate-studio',
              label: 'Comparateur de tarifs',
              perm: PERMISSIONS.TRANSPORTATION.RATES_READ,
            },
            { href: '/lanes', label: 'Liaisons' },
            { href: '/rates', label: 'Tarifs' },
            { href: '/accessorials', label: 'Frais accessoires' },
            { href: '/fuel-tables', label: 'Carburant' },
          ],
        },
        {
          label: 'Partenaires',
          links: [
            { href: '/customers', label: 'Clients' },
            { href: '/carriers', label: 'Transporteurs' },
            { href: '/locations', label: 'Lieux' },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/transportation/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Entrepôt (WMS) ─────────────────────────────────────────────────────
    {
      key: 'wms',
      label: 'Entrepôt',
      icon: Warehouse,
      home: '/wms',
      module: MODULE_KEYS.WMS,
      prefixes: ['/wms'],
      sections: [
        {
          links: [
            { href: '/wms', label: "Vue d'ensemble" },
            { href: '/wms/inventory', label: 'Inventaire' },
            { href: '/wms/movements', label: 'Journal des mouvements' },
          ],
        },
        {
          label: 'Flux',
          links: [
            { href: '/wms/receiving', label: 'Réception' },
            { href: '/wms/putaway', label: 'Rangement' },
            { href: '/wms/fulfillment', label: 'Préparation' },
            { href: '/wms/picking', label: 'Prélèvement' },
            { href: '/wms/cycle-counts', label: 'Comptages' },
          ],
        },
        {
          label: 'Données',
          links: [
            { href: '/wms/items', label: 'Articles' },
            { href: '/wms/bins', label: 'Emplacements' },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/wms/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Fabrication (Manufacturing / APS) ───────────────────────────────────
    {
      key: 'manufacturing',
      label: 'Fabrication',
      icon: Factory,
      home: '/manufacturing',
      module: MODULE_KEYS.MANUFACTURING,
      prefixes: ['/manufacturing'],
      sections: [
        {
          links: [
            { href: '/manufacturing', label: "Vue d'ensemble" },
            { href: '/manufacturing/scheduling', label: 'Planification (Gantt)' },
            { href: '/manufacturing/orders', label: 'Ordres de fabrication' },
          ],
        },
        {
          label: 'Données',
          links: [
            { href: '/manufacturing/work-centers', label: 'Postes de charge' },
            { href: '/manufacturing/calendars', label: 'Calendriers' },
            { href: '/manufacturing/routings', label: 'Gammes' },
            { href: '/manufacturing/boms', label: 'Nomenclatures' },
          ],
        },
      ],
    },

    // ── Cour (Yard) ────────────────────────────────────────────────────────
    {
      key: 'yard',
      label: 'Cour',
      icon: Container,
      home: '/yard',
      module: MODULE_KEYS.YARD,
      prefixes: ['/yard'],
      sections: [
        {
          links: [
            { href: '/yard', label: 'Plan de cour' },
            { href: '/yard/gate', label: 'Gate' },
            { href: '/yard/appointments', label: 'Rendez-vous' },
            { href: '/yard/spots', label: 'Emplacements' },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/yard/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Assets / Fleet ─────────────────────────────────────────────────────
    {
      key: 'fleet',
      label: 'Flotte',
      icon: Boxes,
      home: '/assets',
      module: MODULE_KEYS.FLEET,
      prefixes: ['/assets', '/fleet'],
      sections: [
        {
          links: [
            { href: '/assets', label: 'Vue d’ensemble' },
            { href: '/fleet', label: 'Véhicules et remorques' },
            { href: '/fleet/maintenance', label: 'Maintenance', perm: PERMISSIONS.FLEET.READ },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/fleet/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Finance / Billing ──────────────────────────────────────────────────
    {
      key: 'billing',
      label: 'Finance',
      icon: CircleDollarSign,
      home: '/finance',
      module: MODULE_KEYS.BILLING,
      prefixes: ['/finance', '/invoices', '/billing'],
      sections: [
        {
          links: [
            { href: '/finance', label: 'Vue d’ensemble' },
            { href: '/invoices', label: 'Factures clients et fournisseurs' },
            { href: '/billing/freight-audit', label: 'Audit transporteur' },
            {
              href: '/billing/ledger',
              label: 'Grand livre',
              perm: PERMISSIONS.BILLING.LEDGER_READ,
            },
            {
              href: '/billing/reports',
              label: 'Rapports financiers',
              perm: PERMISSIONS.BILLING.LEDGER_READ,
            },
            { href: '/billing/banking', label: 'Banque', perm: PERMISSIONS.BILLING.LEDGER_READ },
            { href: '/billing/budgets', label: 'Budgets', perm: PERMISSIONS.BILLING.LEDGER_READ },
            {
              href: '/billing/fixed-assets',
              label: 'Immobilisations',
              perm: PERMISSIONS.BILLING.ASSETS_READ,
            },
            {
              href: '/billing/subscriptions',
              label: 'Abonnements',
              perm: PERMISSIONS.BILLING.SUBSCRIPTIONS_READ,
            },
            {
              href: '/billing/payments',
              label: 'Paiements',
              perm: PERMISSIONS.BILLING.PAYMENTS_READ,
            },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/billing/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Agents / AI Workforce ──────────────────────────────────────────────
    // Visible if the user holds ANY of these three permissions.
    {
      key: 'agents',
      label: 'Agents',
      icon: Bot,
      home: '/agents',
      prefixes: [
        '/agents',
        '/agent-actions',
        '/workbench',
        '/automation',
        '/control-tower',
        '/settings/agent-runtime',
      ],
      anyPerms: [
        PERMISSIONS.CORE.AGENTS_READ,
        PERMISSIONS.CORE.OPERATING_TASKS_READ,
        PERMISSIONS.CORE.AGENTS_ACTIONS_READ,
      ],
      sections: [
        {
          links: [
            // perm-gated links — filtered out when the user lacks the permission
            { href: '/agents', label: 'Employés', perm: PERMISSIONS.CORE.AGENTS_READ },
            {
              href: '/control-tower',
              label: 'Supervision',
              perm: PERMISSIONS.CORE.AGENTS_READ,
            },
            {
              href: '/agent-actions',
              label: 'Actions à approuver',
              perm: PERMISSIONS.CORE.AGENTS_ACTIONS_READ,
              // badge is dynamic (pendingActions) — injected by the layout at runtime
            },
            {
              href: '/workbench',
              label: 'Mon travail',
              perm: PERMISSIONS.CORE.OPERATING_TASKS_READ,
            },
            {
              href: '/automation',
              label: "Règles d'automatisation",
              perm: PERMISSIONS.CORE.AUTOMATION_RULES_READ,
            },
            // Always visible when the domain is visible (no perm override needed —
            // the domain-level anyPerms gate already ensures the user can see agents)
            { href: '/settings/agent-runtime', label: 'Connexion du modèle' },
          ],
        },
      ],
    },

    // ── Analytics / Control Tower ─────────────────────────────────────────
    {
      key: 'analytics',
      label: 'Analyses',
      icon: BarChart3,
      home: '/analytics',
      module: MODULE_KEYS.ANALYTICS,
      anyPerms: ['analytics.read'],
      prefixes: ['/analytics', '/workflows'],
      sections: [
        {
          links: [
            { href: '/analytics', label: "Vue d'ensemble", perm: 'analytics.read' },
            { href: '/analytics/control-tower', label: 'Supervision', perm: 'analytics.read' },
            { href: '/analytics/scorecards', label: 'Indicateurs', perm: 'analytics.read' },
            { href: '/analytics/flow', label: 'Flux', perm: PERMISSIONS.ANALYTICS.READ },
            { href: '/workflows', label: 'Dossiers connectés', perm: PERMISSIONS.ANALYTICS.READ },
            {
              href: '/analytics/carriers',
              label: 'Performance transporteurs',
              perm: 'transportation.analytics.read',
            },
          ],
        },
      ],
    },

    // ── CRM ───────────────────────────────────────────────────────────────
    {
      key: 'crm',
      label: 'CRM',
      icon: Handshake,
      home: '/crm',
      module: MODULE_KEYS.CRM,
      prefixes: ['/crm'],
      anyPerms: [PERMISSIONS.CRM.READ],
      sections: [
        {
          links: [
            { href: '/crm', label: 'Tableau de bord', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/pipeline', label: 'Pipeline', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/deals', label: 'Opportunités', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/companies', label: 'Sociétés', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/contacts', label: 'Contacts', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/activities', label: 'Activités', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/inbox', label: 'Boîte de réception', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/coach', label: 'Coach', perm: PERMISSIONS.CORE.AGENTS_CHAT },
          ],
        },
        {
          label: 'Marketing',
          links: [
            { href: '/crm/lists', label: 'Listes', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/campaigns', label: 'Campagnes', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/sequences', label: 'Séquences de contacts', perm: PERMISSIONS.CRM.READ },
          ],
        },
        {
          label: 'Catalogue',
          links: [
            { href: '/crm/products', label: 'Produits', perm: PERMISSIONS.CRM.READ },
            { href: '/crm/sales-orders', label: 'Commandes', perm: PERMISSIONS.CRM.READ },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/crm/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Sites & Pages ─────────────────────────────────────────────────────
    {
      key: 'sites',
      label: 'Sites',
      icon: Globe,
      home: '/sites',
      module: MODULE_KEYS.SITES,
      prefixes: ['/sites'],
      anyPerms: [PERMISSIONS.SITES.READ],
      sections: [
        {
          links: [{ href: '/sites', label: 'Pages', perm: PERMISSIONS.SITES.READ }],
        },
      ],
    },

    // ── Procurement / Bid Board ────────────────────────────────────────────
    {
      key: 'procurement',
      label: 'Achats',
      icon: ClipboardList,
      home: '/procurement/rfps',
      module: MODULE_KEYS.PROCUREMENT,
      anyPerms: ['procurement.read'],
      prefixes: ['/procurement'],
      sections: [
        {
          links: [
            { href: '/procurement/rfps', label: "Appels d'offres", perm: 'procurement.read' },
            {
              href: '/procurement/routing-guide',
              label: 'Guide de routage',
              perm: 'procurement.read',
            },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/procurement/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Documents / Document Center ────────────────────────────────────────
    // Core domain (no module gate); visible when the user can read documents.
    {
      key: 'documents',
      label: 'Documents',
      icon: FileText,
      home: '/documents',
      prefixes: ['/documents'],
      anyPerms: [PERMISSIONS.CORE.DOCUMENTS_READ],
      sections: [
        {
          links: [{ href: '/documents', label: 'Document Center' }],
        },
      ],
    },

    // ── Connect / Developer Platform ───────────────────────────────────────
    {
      key: 'connect',
      label: 'Connexions',
      icon: Cable,
      home: '/connect',
      prefixes: ['/connect', '/integrations'],
      anyPerms: [PERMISSIONS.CORE.INTEGRATIONS_READ],
      sections: [
        {
          links: [
            { href: '/connect', label: 'Toutes les connexions' },
            { href: '/connect/inbox', label: 'Inbox', perm: PERMISSIONS.CORE.CONNECT_READ },
            { href: '/connect/imports', label: 'Imports', perm: PERMISSIONS.CORE.CONNECT_READ },
            { href: '/integrations', label: 'Studio avancé' },
            {
              href: '/connect/email',
              label: 'Courriel SMTP / IMAP',
              perm: PERMISSIONS.EMAIL.MANAGE,
            },
            { href: '/settings/api-keys', label: 'Clés API' },
            { href: '/agents', label: 'MCP / agents', perm: PERMISSIONS.CORE.AGENTS_READ },
          ],
        },
        {
          label: 'Administration',
          links: [
            {
              href: '/connect/config',
              label: 'Configuration',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
      ],
    },

    // ── Personnalisation (bureau) ──────────────────────────────────────────
    // Core domain, always visible — own page to theme/colour/background the desk.
    {
      key: 'personalize',
      label: 'Personnaliser',
      icon: Palette,
      home: '/personalize',
      prefixes: ['/personalize'],
      sections: [
        {
          links: [{ href: '/personalize', label: 'Apparence du bureau' }],
        },
      ],
    },

    // ── Courriels ──────────────────────────────────────────────────────────
    // Core domain (no module gate); visible when the user can read emails.
    {
      key: 'emails',
      label: 'Courriels',
      icon: Mail,
      home: '/emails',
      prefixes: ['/emails'],
      anyPerms: [PERMISSIONS.EMAIL.READ],
      sections: [
        {
          links: [
            { href: '/emails', label: 'Historique', perm: PERMISSIONS.EMAIL.READ },
            { href: '/emails/templates', label: 'Gabarits', perm: PERMISSIONS.EMAIL.MANAGE },
            { href: '/emails/config', label: 'Configuration', perm: PERMISSIONS.EMAIL.MANAGE },
          ],
        },
      ],
    },

    // ── Réglages ───────────────────────────────────────────────────────────
    {
      key: 'settings',
      label: 'Réglages',
      icon: Settings,
      home: '/settings/users',
      prefixes: ['/settings'],
      // Always visible; no module or anyPerms gate.
      sections: [
        {
          label: 'Plateforme',
          links: [
            { href: '/settings/users', label: 'Utilisateurs' },
            { href: '/settings/api-keys', label: 'Clés API' },
            { href: '/settings/modules', label: 'Modules' },
            { href: '/settings/sso', label: 'SSO' },
            {
              href: '/settings/audit',
              label: "Journal d'audit",
              perm: PERMISSIONS.CORE.AUDIT_READ,
            },
          ],
        },
        {
          label: 'Configuration modules',
          links: [
            {
              href: '/settings/modules/carrier-portal',
              label: 'Portail transporteur',
              perm: PERMISSIONS.CORE.MODULES_MANAGE,
            },
          ],
        },
        { label: 'Préférences', links: [{ href: '/settings/appearance', label: 'Apparence' }] },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Filter function
// ---------------------------------------------------------------------------

/**
 * Returns the subset of `navCatalogue()` that is visible for a given user session:
 * - Domain-level: `module` present in `caps.enabledModules`, and (if `anyPerms` set)
 *   at least one perm held.
 * - Link-level: `perm` absent, or the user holds that perm.
 * - Sections with no remaining links are dropped; domains with no remaining sections are
 *   dropped UNLESS they are the `dashboard` domain.
 */
export function visibleDomains(caps: NavCaps): NavDomain[] {
  return navCatalogue()
    .filter((d) => {
      // Module gate
      if (d.module && !caps.enabledModules.includes(d.module)) return false;
      // Any-of permission gate
      if (d.anyPerms && d.anyPerms.length > 0) {
        return d.anyPerms.some((p) => caps.can(p));
      }
      return true;
    })
    .map((d) => ({
      ...d,
      sections: d.sections
        .map((s) => ({
          ...s,
          // Spread each link so runtime badge injection by one consumer
          // never aliases the shared catalogue objects (e.g. /apps + palette).
          links: s.links.filter((l) => !l.perm || caps.can(l.perm)).map((l) => ({ ...l })),
        }))
        .filter((s) => s.links.length > 0),
    }))
    .filter((d) => d.key === 'dashboard' || d.sections.length > 0);
}
