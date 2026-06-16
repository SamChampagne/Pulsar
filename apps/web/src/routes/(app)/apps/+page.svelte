<script lang="ts">
  import { MODULE_KEYS, type ModuleKey } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { Badge, Card, PageHeader } from '$lib/components/ui';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';

  interface AppTile {
    key: string;
    title: string;
    subtitle: string;
    href: string;
    moduleKey?: ModuleKey;
    status: 'core' | 'enabled' | 'disabled';
    kpi: string;
    next: string;
    agent: string;
  }

  const moduleEnabled = (key: ModuleKey): boolean => $auth?.tenant.enabledModules.includes(key) ?? false;

  const apps = $derived<AppTile[]>([
    {
      key: 'transport',
      title: 'Transport / Operations',
      subtitle: 'TMS, dispatch, loads, routing, tracking and POD.',
      href: '/dispatch',
      moduleKey: MODULE_KEYS.TRANSPORTATION,
      status: moduleEnabled(MODULE_KEYS.TRANSPORTATION) ? 'enabled' : 'disabled',
      kpi: 'Live execution',
      next: 'Planifier, tender, suivre et fermer les mouvements.',
      agent: 'Dispatcher / Exception agent',
    },
    {
      key: 'finance',
      title: 'Finance / Ledger',
      subtitle: 'Receivables, payables, invoice audit, margin and payment readiness.',
      href: '/finance',
      moduleKey: MODULE_KEYS.BILLING,
      status: moduleEnabled(MODULE_KEYS.BILLING) ? 'enabled' : 'disabled',
      kpi: 'Money movement',
      next: 'Transformer les opérations en cash, marge et litiges contrôlés.',
      agent: 'Invoice auditor / margin analyst',
    },
    {
      key: 'assets',
      title: 'Assets / Fleet',
      subtitle: 'Vehicles, trailers, equipment, maintenance, compliance and lifecycle cost.',
      href: '/assets',
      moduleKey: MODULE_KEYS.FLEET,
      status: moduleEnabled(MODULE_KEYS.FLEET) ? 'enabled' : 'disabled',
      kpi: 'Readiness',
      next: 'Savoir ce qui est disponible, assigné, expiré ou en maintenance.',
      agent: 'Maintenance / compliance agent',
    },
    {
      key: 'warehouse',
      title: 'Warehouse / Inventory',
      subtitle: 'Items, bins, receiving, inventory movement, picking and fulfillment.',
      href: '/wms',
      moduleKey: MODULE_KEYS.WMS,
      status: moduleEnabled(MODULE_KEYS.WMS) ? 'enabled' : 'disabled',
      kpi: 'Inventory flow',
      next: 'Réceptionner, déplacer, préparer et relier l’entrepôt aux commandes.',
      agent: 'Warehouse prep agent',
    },
    {
      key: 'yard',
      title: 'Yard / Dock',
      subtitle: 'Gate, dock appointments, yard spots, dwell and trailer movement.',
      href: '/yard',
      moduleKey: MODULE_KEYS.YARD,
      status: moduleEnabled(MODULE_KEYS.YARD) ? 'enabled' : 'disabled',
      kpi: 'Yard state',
      next: 'Voir la cour comme un outil visuel, pas comme une table.',
      agent: 'Dock scheduler agent',
    },
    {
      key: 'agents',
      title: 'AI Workforce',
      subtitle: 'Governed Hermes employees, tasks, proposed actions and evidence.',
      href: '/agents',
      status: 'core',
      kpi: 'Governed autonomy',
      next: 'Assigner des employés IA aux modules avec caps, audit et kill switch.',
      agent: 'Manager / specialist roster',
    },
    {
      key: 'connect',
      title: 'Connect / Developer Platform',
      subtitle: 'Integrations, API keys, webhooks, MCP tools and external system readiness.',
      href: '/connect',
      status: 'core',
      kpi: 'Connectivity',
      next: 'Brancher ERP, EDI, accounting, télématique et outils agents.',
      agent: 'Integration operator agent',
    },
  ]);
</script>

<PageHeader
  title="Pulsar Apps"
  subtitle="Une plateforme LSOS composée de gros modules métier. Transport est un module phare — pas toute la plateforme."
/>

<section class="mb-5 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
  <div class="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr] lg:p-6">
    <div>
      <p class="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">Platform operating system</p>
      <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
        Chaque module doit se sentir comme une vraie application, avec ses données, ses workflows et ses agents.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
        Le core garde les tenants, permissions, audit, intégrations et politiques. Les apps métier — Finance,
        Assets, Warehouse, Yard, Transport — deviennent des surfaces profondes branchées à la même gouvernance.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Apps visibles</p>
        <p class="mt-1 text-2xl font-semibold">{apps.length}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Core partagé</p>
        <p class="mt-1 text-2xl font-semibold">1</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Mode</p>
        <p class="mt-1 text-2xl font-semibold">LSOS</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">AI</p>
        <p class="mt-1 text-2xl font-semibold">Workforce</p>
      </div>
    </div>
  </div>
</section>

<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
  {#each apps as app (app.key)}
    <a
      href={app.status === 'disabled' ? '/settings/modules' : app.href}
      class="group block rounded-card border border-edge-soft bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
      style={`--tile-accent: ${MODULE_UNIVERSES[app.key === 'finance' ? 'billing' : app.key === 'warehouse' ? 'wms' : app.key === 'assets' ? 'fleet' : app.key]?.accent ?? 'var(--color-accent)'}; border-top: 3px solid var(--tile-accent);`}
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.2em] uppercase" style="color: var(--tile-accent)">{app.kpi}</p>
          <h2 class="mt-1 text-lg font-bold text-ink">{app.title}</h2>
        </div>
        {#if app.status === 'disabled'}
          <Badge tone="neutral">À activer</Badge>
        {:else if app.status === 'core'}
          <Badge tone="info">Core</Badge>
        {:else}
          <Badge tone="ok">Actif</Badge>
        {/if}
      </div>
      <p class="mt-3 min-h-10 text-sm leading-5 text-ink-muted">{app.subtitle}</p>
      <div class="mt-4 rounded-inner border border-edge-soft bg-surface-muted p-3">
        <p class="text-xs font-semibold text-ink">Prochain travail</p>
        <p class="mt-1 text-xs leading-5 text-ink-muted">{app.next}</p>
      </div>
      <div class="mt-3 flex items-center justify-between text-xs">
        <span class="text-ink-faint">Agent</span>
        <span class="font-medium text-ink-muted">{app.agent}</span>
      </div>
    </a>
  {/each}
</div>

<div class="mt-5">
  <Card>
  <div class="grid gap-4 lg:grid-cols-3">
    <div>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Principe</p>
      <h2 class="mt-1 text-base font-bold text-ink">Pas une navbar de TMS</h2>
      <p class="mt-2 text-sm leading-6 text-ink-muted">
        Chaque app doit avoir une mission, des KPIs, des objets métier, des exceptions et des agents assignés.
      </p>
    </div>
    <div>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Connexion</p>
      <h2 class="mt-1 text-base font-bold text-ink">Le core relie tout</h2>
      <p class="mt-2 text-sm leading-6 text-ink-muted">
        Tenants, permissions, audit, documents, notifications, intégrations et ProposedActions restent communs.
      </p>
    </div>
    <div>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Différence</p>
      <h2 class="mt-1 text-base font-bold text-ink">Fleetbase comme mécanisme</h2>
      <p class="mt-2 text-sm leading-6 text-ink-muted">
        On reprend l’idée de modules profonds — Fleet-Ops, Ledger, Pallet, Extensions — sans copier leur code/UI.
      </p>
    </div>
  </div>
  </Card>
</div>
