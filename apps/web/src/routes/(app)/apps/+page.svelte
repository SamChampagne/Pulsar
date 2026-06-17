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
    { key: 'data', label: 'Données', href: '/settings/modules', status: 'core', icon: Database, accent: '#737985' },
    { key: 'users', label: 'Utilisateurs', href: '/settings/users', status: 'core', icon: Users, accent: '#737985' },
    { key: 'automation', label: 'Automation', href: '/settings/agent-runtime', status: 'core', icon: Wrench, accent: '#737985' },
  ];

  const allApps = $derived(businessApps);
  let frameworkOpen = $state(false);
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

<section class="min-h-[calc(100vh-3.5rem)] bg-[#f8f8f7] px-4 py-14 text-ink sm:px-8 lg:px-12">
  <div class="mx-auto max-w-5xl">
    <div class="mb-10 text-center">
      <p class="text-xs font-semibold tracking-[0.26em] text-ink-faint uppercase">Pulsar Desk</p>
      <h1 class="mt-2 text-xl font-semibold tracking-tight text-ink">Choisis un univers</h1>

    </div>

    <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
      <div class="relative flex w-24 flex-col items-center text-center">
        <button
          type="button"
          class="group flex w-24 flex-col items-center text-center outline-none"
          aria-label="Ouvrir le dossier Framework"
          aria-expanded={frameworkOpen}
          onclick={() => (frameworkOpen = !frameworkOpen)}
        >
          <span class="relative grid size-14 place-items-center rounded-[18px] bg-[#737985] text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-accent">
            <span class="absolute inset-1 grid grid-cols-2 gap-1 rounded-[14px] bg-white/10 p-1">
              <span class="rounded-md bg-white/35"></span>
              <span class="rounded-md bg-white/20"></span>
              <span class="rounded-md bg-white/20"></span>
              <span class="rounded-md bg-white/35"></span>
            </span>
            <Cuboid class="relative size-6" strokeWidth={2.2} />
          </span>
          <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">Framework</span>
          <span class="mt-1 text-xs leading-tight text-ink-faint">Dossier</span>
        </button>

        {#if frameworkOpen}
          <div class="absolute left-1/2 top-[5.25rem] z-30 w-[min(430px,calc(100vw-2rem))] -translate-x-1/2 rounded-[30px] border border-edge bg-white/96 p-4 text-left shadow-pop backdrop-blur">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold text-ink">Framework</h2>
                <p class="mt-1 text-xs leading-5 text-ink-muted">Réglages, données, utilisateurs, automation.</p>
              </div>
              <button type="button" class="rounded-full bg-surface-muted px-2 py-1 text-xs font-semibold text-ink-muted hover:text-ink" onclick={() => (frameworkOpen = false)}>Fermer</button>
            </div>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {#each systemShortcuts as shortcut (shortcut.key)}
                {@const Icon = shortcut.icon}
                <a href={shortcut.href} class="group/item flex flex-col items-center rounded-2xl bg-[#f3f3f2] p-3 text-center transition hover:-translate-y-0.5 hover:bg-[#ececea]">
                  <span class="flex size-10 items-center justify-center rounded-2xl bg-[#737985] text-white shadow-sm"><Icon class="size-5" /></span>
                  <span class="mt-2 text-xs font-semibold leading-tight text-ink-muted group-hover/item:text-ink">{shortcut.label}</span>
                </a>
              {/each}
            </div>
          </div>
        {/if}
      </div>

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
  </div>
</section>
