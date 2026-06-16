<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth, clearAuth, getRefreshToken } from '$lib/stores/auth';
  import {
    Bell, LogOut, Search, LayoutDashboard, Truck, Warehouse, Container,
    Boxes, CircleDollarSign, Bot, Settings, Cable,
  } from 'lucide-svelte';
  import type { ComponentType } from 'svelte';
  import CommandPalette from '$lib/components/ui/CommandPalette.svelte';
  import AssistantPanel from '$lib/components/agents/AssistantPanel.svelte';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';

  let { children } = $props();

  interface Notification {
    id: string; level: string; title: string; body: string; readAt: string | null; createdAt: string;
  }
  let notifications = $state<Notification[]>([]);
  let notifOpen = $state(false);
  const unreadCount = $derived(notifications.filter((n) => !n.readAt).length);

  const canReadWorkbench = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_READ) ?? false);
  const canReadAgentActions = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_ACTIONS_READ) ?? false);
  const canReadAgents = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_READ) ?? false);
  const canReadIntegrations = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.INTEGRATIONS_READ) ?? false);
  const canChatAgents = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_CHAT) ?? false);
  let pendingActions = $state(0);
  let assistantOpen = $state(false);

  async function loadNotifications() {
    try { notifications = await api<Notification[]>('/notifications', { query: { unread: 'true' } }); } catch { /* non-critical */ }
  }
  async function loadPendingActions() {
    if (!canReadAgentActions) return;
    try { pendingActions = (await api<unknown[]>('/agent-actions')).length; } catch { /* non-critical */ }
  }
  async function markRead(id: string) {
    try { await api(`/notifications/${id}/read`, { method: 'POST' }); await loadNotifications(); } catch { /* silent */ }
  }

  $effect(() => {
    if ($auth) {
      void loadNotifications();
      void loadPendingActions();
      const interval = setInterval(() => { void loadNotifications(); void loadPendingActions(); }, 60_000);
      return () => clearInterval(interval);
    }
  });
  $effect(() => { if (!$auth) void goto('/login'); });

  const hasTransportation = $derived($auth?.tenant.enabledModules.includes(MODULE_KEYS.TRANSPORTATION) ?? false);
  const hasBilling = $derived($auth?.tenant.enabledModules.includes(MODULE_KEYS.BILLING) ?? false);
  const hasFleet = $derived($auth?.tenant.enabledModules.includes(MODULE_KEYS.FLEET) ?? false);
  const hasWms = $derived($auth?.tenant.enabledModules.includes(MODULE_KEYS.WMS) ?? false);
  const hasYard = $derived($auth?.tenant.enabledModules.includes(MODULE_KEYS.YARD) ?? false);

  // A page link inside a domain. A section groups links inside the contextual rail.
  interface NavLink { href: string; label: string; badge?: number }
  interface NavSection { label?: string; links: NavLink[] }
  interface Domain {
    key: string;
    label: string;
    icon: ComponentType;
    home: string; // where clicking the domain icon lands
    prefixes: string[]; // route prefixes that belong to this domain
    sections: NavSection[]; // contextual rail content
    visible: boolean;
  }

  const domains = $derived<Domain[]>([
    {
      key: 'dashboard', label: 'Plateforme', icon: LayoutDashboard,
      home: '/apps', prefixes: ['/apps', '/dashboard'], visible: true, sections: [],
    },
    {
      key: 'transport', label: 'Transport', icon: Truck, home: '/dispatch',
      prefixes: ['/dispatch', '/transport-orders', '/shipments', '/loads', '/lanes', '/rates', '/accessorials', '/fuel-tables', '/customers', '/carriers', '/analytics'],
      visible: hasTransportation,
      sections: [
        { label: 'Exécution', links: [
          { href: '/dispatch', label: 'Dispatch' },
          { href: '/transport-orders', label: 'Ordres de transport' },
          { href: '/shipments', label: 'Shipments' },
          { href: '/loads', label: 'Loads' },
        ]},
        { label: 'Tarification', links: [
          { href: '/lanes', label: 'Voies (lanes)' },
          { href: '/rates', label: 'Tarifs' },
          { href: '/accessorials', label: 'Accessoriaux' },
          { href: '/fuel-tables', label: 'Carburant' },
        ]},
        { label: 'Partenaires', links: [
          { href: '/customers', label: 'Clients' },
          { href: '/carriers', label: 'Transporteurs' },
        ]},
        { label: 'Analyse', links: [{ href: '/analytics', label: 'Analytics' }] },
      ],
    },
    {
      key: 'wms', label: 'Entrepôt', icon: Warehouse, home: '/wms',
      prefixes: ['/wms'], visible: hasWms,
      sections: [
        { links: [{ href: '/wms', label: 'Vue d’ensemble' }, { href: '/wms/inventory', label: 'Inventaire' }] },
        { label: 'Flux', links: [
          { href: '/wms/receiving', label: 'Réception' },
          { href: '/wms/fulfillment', label: 'Préparation' },
          { href: '/wms/picking', label: 'Prélèvement' },
        ]},
        { label: 'Données', links: [
          { href: '/wms/items', label: 'Articles' },
          { href: '/wms/bins', label: 'Emplacements' },
        ]},
      ],
    },
    {
      key: 'yard', label: 'Cour', icon: Container, home: '/yard',
      prefixes: ['/yard'], visible: hasYard,
      sections: [
        { links: [
          { href: '/yard', label: 'Plan de cour' },
          { href: '/yard/gate', label: 'Gate' },
          { href: '/yard/appointments', label: 'Rendez-vous' },
          { href: '/yard/spots', label: 'Emplacements' },
        ]},
      ],
    },
    {
      key: 'fleet', label: 'Assets', icon: Boxes, home: '/assets',
      prefixes: ['/assets', '/fleet'], visible: hasFleet,
      sections: [{ links: [
        { href: '/assets', label: 'Assets home' },
        { href: '/fleet', label: 'Fleet roster' },
      ] }],
    },
    {
      key: 'billing', label: 'Finance', icon: CircleDollarSign, home: '/finance',
      prefixes: ['/finance', '/invoices', '/billing'], visible: hasBilling,
      sections: [{ links: [
        { href: '/finance', label: 'Finance home' },
        { href: '/invoices', label: 'Receivables / Payables' },
        { href: '/billing/freight-audit', label: 'Freight audit' },
      ]}],
    },
    {
      key: 'agents', label: 'Agents', icon: Bot, home: '/agents',
      prefixes: ['/agents', '/agent-actions', '/workbench', '/settings/agent-runtime'],
      visible: canReadAgents || canReadWorkbench || canReadAgentActions,
      sections: [{ links: [
        ...(canReadAgents ? [{ href: '/agents', label: 'Employés' }] : []),
        ...(canReadAgentActions ? [{ href: '/agent-actions', label: 'Actions à approuver', badge: pendingActions }] : []),
        ...(canReadWorkbench ? [{ href: '/workbench', label: 'Workbench' }] : []),
        { href: '/settings/agent-runtime', label: 'Connexion du modèle' },
      ]}],
    },
    {
      key: 'connect', label: 'Connect', icon: Cable, home: '/connect',
      prefixes: ['/connect', '/integrations'], visible: canReadIntegrations,
      sections: [{ links: [
        { href: '/connect', label: 'Connect home' },
        { href: '/integrations', label: 'Connecteurs' },
        { href: '/settings/api-keys', label: 'Clés API' },
        { href: '/agents', label: 'MCP / agents' },
      ]}],
    },
    {
      key: 'settings', label: 'Réglages', icon: Settings, home: '/settings/users',
      prefixes: ['/settings'], visible: true,
      sections: [
        { label: 'Plateforme', links: [
          { href: '/settings/users', label: 'Utilisateurs' },
          { href: '/settings/api-keys', label: 'Clés API' },
          { href: '/settings/modules', label: 'Modules' },
          { href: '/settings/sso', label: 'SSO' },
        ]},
        { label: 'Préférences', links: [{ href: '/settings/appearance', label: 'Apparence' }] },
      ],
    },
  ]);

  const visibleDomains = $derived(domains.filter((d) => d.visible));

  function pathInDomain(d: Domain): boolean {
    return d.prefixes.some((p) => page.url.pathname === p || page.url.pathname.startsWith(p + '/') || page.url.pathname.startsWith(p));
  }
  // Active domain = most-specific prefix match; fall back to dashboard.
  const activeDomain = $derived(
    visibleDomains
      .filter((d) => d.key !== 'dashboard' && pathInDomain(d))
      .sort((a, b) => Math.max(...b.prefixes.map((p) => p.length)) - Math.max(...a.prefixes.map((p) => p.length)))[0]
      ?? visibleDomains.find((d) => d.key === 'dashboard'),
  );
  const activeUniverse = $derived(MODULE_UNIVERSES[activeDomain?.key ?? 'dashboard'] ?? MODULE_UNIVERSES.dashboard);

  function linkActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
  }

  function logout() {
    const refreshToken = getRefreshToken();
    if (refreshToken) void api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    clearAuth();
    void goto('/login');
  }

  let paletteOpen = $state(false);
  const paletteCommands = $derived([
    ...(canChatAgents ? [{ label: 'Assistant IA', hint: 'chat', run: () => (assistantOpen = true) }] : []),
    ...visibleDomains.flatMap((d) =>
      d.sections.flatMap((s) => s.links.map((l) => ({ label: l.label, hint: d.label, run: () => goto(l.href) }))),
    ),
    { label: 'Pulsar Apps', hint: 'plateforme', run: () => goto('/apps') },
  ]);
</script>

{#if $auth}
  <div
    class="flex min-h-screen"
    style={`--module-accent: ${activeUniverse.accent}; --module-soft: ${activeUniverse.soft}; --module-rgb: ${activeUniverse.rgb};`}
  >
    <!-- Rail 1 — domains -->
    <aside class="flex w-[4.75rem] flex-col items-center gap-1 bg-sidebar py-3">
      <a href="/apps" class="mb-2 text-lg font-bold text-white" aria-label="Pulsar">⬢</a>
      <button
        class="mb-1 flex size-10 flex-col items-center justify-center rounded-lg text-ink-faint hover:bg-sidebar-hover hover:text-white"
        onclick={() => (paletteOpen = true)} aria-label="Rechercher (⌘K)" title="Rechercher  ⌘K"
      >
        <Search class="size-5" />
      </button>

      <nav class="flex flex-1 flex-col items-center gap-1">
        {#each visibleDomains as d (d.key)}
          {@const Icon = d.icon}
          {@const active = activeDomain?.key === d.key}
          <a
            href={d.home}
            class={`group flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 transition-colors ${active ? 'text-white shadow-sm' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}
            style={active ? `background: ${MODULE_UNIVERSES[d.key]?.accent ?? 'var(--color-accent)'}` : ''}
            aria-label={d.label} title={d.label}
          >
            <Icon class="size-5" />
            <span class="text-[9.5px] leading-tight">{d.label.split(' ')[0]}</span>
          </a>
        {/each}
      </nav>

      <button
        class="relative flex size-10 items-center justify-center rounded-lg text-ink-faint hover:bg-sidebar-hover hover:text-white"
        onclick={() => (notifOpen = !notifOpen)} aria-label="Notifications" aria-expanded={notifOpen}
      >
        <Bell class="size-5" />
        {#if unreadCount > 0}<span class="absolute top-1 right-1 size-2 rounded-full bg-danger"></span>{/if}
      </button>
      <button class="flex size-10 items-center justify-center rounded-lg text-ink-faint hover:bg-sidebar-hover hover:text-white" onclick={logout} aria-label="Déconnexion" title="Déconnexion">
        <LogOut class="size-5" />
      </button>
    </aside>

    <!-- Rail 2 — contextual pages of the active domain (hidden for dashboard) -->
    {#if activeDomain && activeDomain.sections.length > 0}
      <aside class="flex w-56 flex-col border-r border-edge bg-surface">
        <div class="border-b border-edge-soft px-4 py-3.5">
          <div class="flex items-center gap-2">
            <span class="size-2.5 rounded-full" style={`background: ${activeUniverse.accent}`}></span>
            <div class="text-[11px] tracking-wide text-ink-faint uppercase">{$auth.tenant.name}</div>
          </div>
          <div class="mt-1 text-sm font-bold text-ink">{activeUniverse.title}</div>
          <p class="mt-2 text-xs leading-5 text-ink-muted">{activeUniverse.mission}</p>
          <div class="mt-3 rounded-lg border border-edge-soft p-2.5" style={`background: ${activeUniverse.soft}`}>
            <div class="text-[10px] font-semibold tracking-wider uppercase" style={`color: ${activeUniverse.accent}`}>
              {activeUniverse.signal}
            </div>
            <div class="mt-1 text-xs font-semibold text-ink">Agent: {activeUniverse.agent}</div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1">
            {#each activeUniverse.objects as object (object)}
              <span class="rounded-full border border-edge-soft bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-muted">{object}</span>
            {/each}
          </div>
          <div class="mt-2 flex flex-wrap gap-1">
            {#each activeUniverse.workflows as flow (flow)}
              <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={`background: ${activeUniverse.accent}`}>{flow}</span>
            {/each}
          </div>
        </div>
        <nav class="flex-1 space-y-3 overflow-y-auto px-2 py-3">
          {#each activeDomain.sections as section (section.label ?? section.links[0]?.href)}
            <div>
              {#if section.label}
                <div class="px-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">{section.label}</div>
              {/if}
              {#each section.links as l (l.href)}
                <a
                  href={l.href}
                  class={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${linkActive(l.href) ? 'font-semibold' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}`}
                  style={linkActive(l.href) ? `background: ${activeUniverse.soft}; color: ${activeUniverse.accent}` : ''}
                >
                  <span class="flex-1">{l.label}</span>
                  {#if l.badge}<span class="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{l.badge}</span>{/if}
                </a>
              {/each}
            </div>
          {/each}
        </nav>
        <div class="border-t border-edge-soft px-4 py-3">
          <div class="mb-2 rounded-lg border border-edge-soft bg-surface-muted px-2.5 py-2">
            <div class="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">Tenant actif</div>
            <div class="mt-0.5 truncate text-sm font-semibold text-ink">{$auth.tenant.name}</div>
            <div class="mt-0.5 inline-flex max-w-full rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
              <span class="truncate">{$auth.tenant.slug}</span>
            </div>
          </div>
          <div class="truncate text-xs text-ink-faint">{$auth.user.email}</div>
        </div>
      </aside>
    {/if}

    <main
      class="min-w-0 flex-1 overflow-x-hidden p-6"
      style={`background: radial-gradient(circle at top left, rgb(${activeUniverse.rgb} / 0.10), transparent 360px), var(--color-canvas);`}
    >{@render children()}</main>

    {#if notifOpen}
      <div class="fixed bottom-4 left-[5.5rem] z-30 max-h-96 w-72 overflow-y-auto rounded-card border border-edge bg-surface p-2 shadow-pop">
        {#if notifications.length === 0}
          <p class="px-2 py-3 text-center text-xs text-ink-faint">Aucune notification</p>
        {:else}
          {#each notifications as n (n.id)}
            <div class={`mb-1 rounded p-2 text-xs ${n.readAt ? 'opacity-60' : ''}`}>
              <div class="font-semibold text-ink">{n.title}</div>
              <div class="text-ink-muted">{n.body}</div>
              <div class="mt-1 flex items-center justify-between">
                <span class="text-ink-faint">{new Date(n.createdAt).toLocaleString()}</span>
                {#if !n.readAt}
                  <button class="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-soft" onclick={() => markRead(n.id)}>Marquer lu</button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
  <CommandPalette bind:open={paletteOpen} commands={paletteCommands} />
  {#if canChatAgents}<AssistantPanel bind:open={assistantOpen} />{/if}
{/if}
