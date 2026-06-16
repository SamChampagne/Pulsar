<script lang="ts">
  import { MODULE_KEYS, type ModuleKey } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import {
    Bot,
    Boxes,
    Cable,
    CircleDollarSign,
    Container,
    Cuboid,
    Database,
    Factory,
    PackageOpen,
    Settings,
    ShieldCheck,
    Truck,
    Users,
    Warehouse,
    Workflow,
    Wrench,
  } from 'lucide-svelte';
  import type { ComponentType } from 'svelte';

  interface DeskApp {
    key: string;
    label: string;
    subtitle?: string;
    href: string;
    moduleKey?: ModuleKey;
    status: 'core' | 'enabled' | 'disabled' | 'soon';
    icon: ComponentType;
    accent: string;
    meta?: string;
  }

  const moduleEnabled = (key: ModuleKey): boolean => $auth?.tenant.enabledModules.includes(key) ?? false;
  const universe = (key: string) => MODULE_UNIVERSES[key]?.accent ?? '#0ea5e9';

  const frameworkApps: DeskApp[] = [
    {
      key: 'framework',
      label: 'Framework',
      subtitle: 'Core système, agents, réglages et futur développement Pulsar.',
      href: '/framework',
      status: 'core',
      icon: Cuboid,
      accent: '#737985',
      meta: '9 workspaces',
    },
  ];

  const businessApps = $derived<DeskApp[]>([
    {
      key: 'transport',
      label: 'Transport',
      subtitle: 'Dispatch, loads, shipments, lanes and rates.',
      href: '/dispatch',
      moduleKey: MODULE_KEYS.TRANSPORTATION,
      status: moduleEnabled(MODULE_KEYS.TRANSPORTATION) ? 'enabled' : 'disabled',
      icon: Truck,
      accent: universe('transport'),
    },
    {
      key: 'finance',
      label: 'Comptabilité',
      subtitle: 'Finance, audit, invoices, margins and cash readiness.',
      href: '/finance',
      moduleKey: MODULE_KEYS.BILLING,
      status: moduleEnabled(MODULE_KEYS.BILLING) ? 'enabled' : 'disabled',
      icon: CircleDollarSign,
      accent: universe('billing'),
    },
    {
      key: 'assets',
      label: 'Actifs - Fleet',
      subtitle: 'Vehicles, trailers, drivers, maintenance and compliance.',
      href: '/assets',
      moduleKey: MODULE_KEYS.FLEET,
      status: moduleEnabled(MODULE_KEYS.FLEET) ? 'enabled' : 'disabled',
      icon: Boxes,
      accent: universe('fleet'),
    },
    {
      key: 'warehouse',
      label: 'Stock',
      subtitle: 'Warehouse, inventory, receiving, picking and fulfillment.',
      href: '/wms',
      moduleKey: MODULE_KEYS.WMS,
      status: moduleEnabled(MODULE_KEYS.WMS) ? 'enabled' : 'disabled',
      icon: Warehouse,
      accent: universe('wms'),
    },
    {
      key: 'yard',
      label: 'Cour / Dock',
      subtitle: 'Gate, appointments, spots and dwell state.',
      href: '/yard',
      moduleKey: MODULE_KEYS.YARD,
      status: moduleEnabled(MODULE_KEYS.YARD) ? 'enabled' : 'disabled',
      icon: Container,
      accent: universe('yard'),
    },
    {
      key: 'agents',
      label: 'Agents IA',
      subtitle: 'Employés Hermes, approvals, workbench and evidence.',
      href: '/agents',
      status: 'core',
      icon: Bot,
      accent: universe('agents'),
    },
    {
      key: 'connect',
      label: 'Connect',
      subtitle: 'Integrations, API keys, webhooks and MCP tools.',
      href: '/connect',
      status: 'core',
      icon: Cable,
      accent: universe('connect'),
    },
    {
      key: 'production',
      label: 'Production',
      subtitle: 'Manufacturing and work orders — future module.',
      href: '/settings/modules',
      status: 'soon',
      icon: Factory,
      accent: '#0ea5e9',
    },
    {
      key: 'quality',
      label: 'Qualité',
      subtitle: 'Inspections, non-conformance and quality gates — future module.',
      href: '/settings/modules',
      status: 'soon',
      icon: ShieldCheck,
      accent: '#0ea5e9',
    },
    {
      key: 'purchase',
      label: 'Achat',
      subtitle: 'Procurement, vendors and purchase orders — future module.',
      href: '/settings/modules',
      status: 'soon',
      icon: PackageOpen,
      accent: '#0ea5e9',
    },
    {
      key: 'projects',
      label: 'Projets',
      subtitle: 'Project delivery and customer work — future module.',
      href: '/settings/modules',
      status: 'soon',
      icon: Workflow,
      accent: '#0ea5e9',
    },
  ]);

  const systemShortcuts: DeskApp[] = [
    { key: 'settings', label: 'Réglages', href: '/settings/users', status: 'core', icon: Settings, accent: '#737985' },
    { key: 'data', label: 'Données', href: '/framework', status: 'core', icon: Database, accent: '#737985' },
    { key: 'users', label: 'Utilisateurs', href: '/settings/users', status: 'core', icon: Users, accent: '#737985' },
    { key: 'automation', label: 'Automation', href: '/framework', status: 'core', icon: Wrench, accent: '#737985' },
  ];

  const allApps = $derived([...frameworkApps, ...businessApps]);
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

<section class="min-h-[calc(100vh-3.5rem)] bg-[#f8f8f7] px-4 py-14 text-ink sm:px-8 lg:px-12">
  <div class="mx-auto max-w-5xl">
    <div class="mb-10 text-center">
      <p class="text-xs font-semibold tracking-[0.26em] text-ink-faint uppercase">Pulsar Desk</p>
      <h1 class="mt-2 text-xl font-semibold tracking-tight text-ink">Choisis un univers</h1>
      <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-muted">
        Le bureau sépare maintenant le coeur Framework des modules métier. Framework sert à configurer, gouverner et bientôt développer; les modules restent les univers opérationnels.
      </p>
    </div>

    <div class="mx-auto grid max-w-[760px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
      {#each allApps as app (app.key)}
        {@const Icon = app.icon}
        <a
          href={app.status === 'disabled' ? '/settings/modules' : app.href}
          class="group flex w-24 flex-col items-center text-center outline-none"
          aria-label={`${app.label}${app.status === 'disabled' ? ' à activer' : ''}`}
          title={app.subtitle ?? app.label}
        >
          <span
            class="relative flex size-14 items-center justify-center rounded-2xl text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-accent"
            style={`background: ${app.status === 'disabled' || app.status === 'soon' ? '#9aa1ad' : app.accent}`}
          >
            <Icon class="size-7" strokeWidth={2.15} />
            {#if app.status === 'soon'}
              <span class="absolute -right-1 -top-1 size-3 rounded-full border-2 border-[#f8f8f7] bg-amber-400"></span>
            {:else if app.status === 'disabled'}
              <span class="absolute -right-1 -top-1 size-3 rounded-full border-2 border-[#f8f8f7] bg-slate-300"></span>
            {/if}
          </span>
          <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{app.label}</span>
          {#if app.meta}
            <span class="mt-1 text-xs leading-tight text-ink-faint">{app.meta}</span>
          {:else if app.status === 'soon'}
            <span class="mt-1 text-xs leading-tight text-ink-faint">Plus tard</span>
          {/if}
        </a>
      {/each}
    </div>

    <div class="mx-auto mt-14 max-w-3xl rounded-[28px] border border-edge-soft bg-white/72 p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">Raccourcis Framework</h2>
          <p class="mt-1 text-xs text-ink-muted">Les outils qui appartiennent au coeur Pulsar, pas à un module métier.</p>
        </div>
        <a href="/framework" class="rounded-full bg-[#737985] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#636976]">Ouvrir Framework</a>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each systemShortcuts as shortcut (shortcut.key)}
          {@const Icon = shortcut.icon}
          <a href={shortcut.href} class="flex items-center gap-2 rounded-2xl bg-[#f3f3f2] px-3 py-2 text-sm font-medium text-ink-muted hover:bg-[#ececea] hover:text-ink">
            <span class="flex size-8 items-center justify-center rounded-xl bg-[#737985] text-white"><Icon class="size-4" /></span>
            {shortcut.label}
          </a>
        {/each}
      </div>
    </div>
  </div>
</section>
