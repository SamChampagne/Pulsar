<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth, clearAuth, getRefreshToken } from '$lib/stores/auth';
  import { ChevronDown, ChevronRight, Bell, LogOut, Search } from 'lucide-svelte';
  import CommandPalette from '$lib/components/ui/CommandPalette.svelte';
  import AssistantPanel from '$lib/components/agents/AssistantPanel.svelte';

  let { children } = $props();

  interface Notification {
    id: string;
    level: string;
    title: string;
    body: string;
    readAt: string | null;
    createdAt: string;
  }

  let notifications = $state<Notification[]>([]);
  let notifOpen = $state(false);

  const unreadCount = $derived(notifications.filter((n) => !n.readAt).length);

  // Operating workbench: gated on the read permission.
  const canReadWorkbench = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_READ) ?? false,
  );

  // Agent-actions inbox: count of pending proposals, gated on the read permission.
  const canReadAgentActions = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_ACTIONS_READ) ?? false,
  );

  // Agents roster: gated on agents read permission.
  const canReadAgents = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_READ) ?? false,
  );

  // Integration operating layer: gated on integration read permission.
  const canReadIntegrations = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.INTEGRATIONS_READ) ?? false,
  );
  let pendingActions = $state(0);

  // ⌘K assistant: chat with an employee-agent, gated on the chat permission.
  const canChatAgents = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_CHAT) ?? false,
  );
  let assistantOpen = $state(false);

  async function loadNotifications() {
    try {
      notifications = await api<Notification[]>('/notifications', { query: { unread: 'true' } });
    } catch {
      // silent — notifications are non-critical
    }
  }

  async function loadPendingActions() {
    if (!canReadAgentActions) return;
    try {
      const pending = await api<unknown[]>('/agent-actions');
      pendingActions = pending.length;
    } catch {
      // silent — badge is non-critical
    }
  }

  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      await loadNotifications();
    } catch {
      // silent
    }
  }

  $effect(() => {
    if ($auth) {
      void loadNotifications();
      void loadPendingActions();
      const interval = setInterval(() => {
        void loadNotifications();
        void loadPendingActions();
      }, 60_000);
      return () => clearInterval(interval);
    }
  });

  // Client-side auth guard for every page in the (app) group.
  $effect(() => {
    if (!$auth) void goto('/login');
  });

  const hasTransportation = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.TRANSPORTATION) ?? false,
  );
  const hasBilling = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.BILLING) ?? false,
  );
  const hasFleet = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.FLEET) ?? false,
  );
  const hasWms = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.WMS) ?? false,
  );
  const hasYard = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.YARD) ?? false,
  );

  function isActive(href: string): boolean {
    return page.url.pathname.startsWith(href);
  }

  function logout() {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      void api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    }
    clearAuth();
    void goto('/login');
  }

  interface NavGroup { label: string; items: { href: string; label: string }[]; visible: boolean }

  const groups = $derived<NavGroup[]>([
    { label: 'Opérations', visible: hasTransportation, items: [
      { href: '/transport-orders', label: 'Transport Orders' },
      { href: '/shipments', label: 'Shipments' },
      { href: '/loads', label: 'Loads' },
    ]},
    { label: 'Tarification', visible: hasTransportation, items: [
      { href: '/lanes', label: 'Lanes' },
      { href: '/rates', label: 'Rates' },
      { href: '/accessorials', label: 'Accessorials' },
      { href: '/fuel-tables', label: 'Fuel tables' },
    ]},
    { label: 'Partenaires', visible: hasTransportation, items: [
      { href: '/customers', label: 'Customers' },
      { href: '/carriers', label: 'Carriers' },
    ]},
    { label: 'Fleet', visible: hasFleet, items: [
      { href: '/fleet', label: 'Fleet' },
    ]},
    { label: 'Warehouse', visible: hasWms, items: [
      { href: '/wms', label: 'Warehouse' },
      { href: '/wms/inventory', label: 'Inventaire' },
      { href: '/wms/receiving', label: 'Réception' },
      { href: '/wms/fulfillment', label: 'Préparation' },
      { href: '/wms/picking', label: 'Prélèvement' },
      { href: '/wms/items', label: 'Articles' },
      { href: '/wms/bins', label: 'Emplacements' },
    ]},
    { label: 'Yard', visible: hasYard, items: [
      { href: '/yard', label: 'Yard' },
      { href: '/yard/gate', label: 'Gate' },
      { href: '/yard/appointments', label: 'Rendez-vous' },
      { href: '/yard/spots', label: 'Spots' },
    ]},
    { label: 'Facturation', visible: hasBilling, items: [
      { href: '/invoices', label: 'Invoices' },
      { href: '/billing/freight-audit', label: 'Freight Audit' },
    ]},
    { label: 'Analytics', visible: hasTransportation, items: [{ href: '/analytics', label: 'Analytics' }] },
    { label: 'Intégrations', visible: canReadIntegrations, items: [{ href: '/integrations', label: 'Integration layer' }] },
    { label: 'Réglages', visible: true, items: [
      { href: '/settings/users', label: 'Users' },
      { href: '/settings/api-keys', label: 'API keys' },
      { href: '/settings/agent-runtime', label: 'Runtime agents' },
      { href: '/settings/modules', label: 'Modules' },
      { href: '/settings/sso', label: 'SSO' },
    ]},
  ]);

  // Nav groups: open by default; persist the user's collapse choices.
  let openGroups = $state<Record<string, boolean>>({});
  // Hydrate from localStorage once.
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem('pulsar.nav.openGroups');
    if (saved) {
      try { openGroups = JSON.parse(saved) as Record<string, boolean>; } catch { /* ignore */ }
    }
  });
  // Any group not yet recorded defaults to OPEN; persist.
  $effect(() => {
    let changed = false;
    for (const g of groups) {
      if (openGroups[g.label] === undefined) { openGroups[g.label] = true; changed = true; }
    }
    if (changed && typeof localStorage !== 'undefined') {
      localStorage.setItem('pulsar.nav.openGroups', JSON.stringify(openGroups));
    }
  });
  // Always reveal the group that contains the active route (so a deep link is visible
  // even if the user previously collapsed that group).
  $effect(() => {
    for (const g of groups) {
      if (g.items.some((i) => isActive(i.href)) && !openGroups[g.label]) {
        openGroups[g.label] = true;
      }
    }
  });

  let paletteOpen = $state(false);
  const paletteCommands = $derived([
    ...(canChatAgents
      ? [{ label: 'AI assistant', hint: 'chat', run: () => (assistantOpen = true) }]
      : []),
    { label: 'Dashboard', hint: 'page', run: () => goto('/dashboard') },
    ...groups.filter((g) => g.visible).flatMap((g) =>
      g.items.map((i) => ({ label: i.label, hint: g.label, run: () => goto(i.href) })),
    ),
    ...(hasTransportation
      ? [
          { label: 'Dispatch', hint: 'page', run: () => goto('/dispatch') },
          { label: 'New transport order', hint: 'action', run: () => goto('/transport-orders') },
          { label: 'New load', hint: 'action', run: () => goto('/loads') },
        ]
      : []),
  ]);
</script>

{#if $auth}
  <div class="flex min-h-screen">
    <aside class="relative flex w-56 flex-col bg-sidebar px-3 py-4 text-sm">
      <div class="px-2 font-bold text-white">⬢ PULSAR</div>
      <div class="mb-3 px-2 text-xs text-ink-faint">{$auth.tenant.name}</div>

      <button
        class="mb-3 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-hover px-2 py-1.5 text-xs text-ink-faint"
        onclick={() => (paletteOpen = true)}
      >
        <Search class="size-3.5" /> Search…
        <kbd class="ml-auto rounded border border-sidebar-border px-1 text-[10px]">⌘K</kbd>
      </button>

      <nav class="flex-1 space-y-0.5 overflow-y-auto">
        <a href="/dashboard"
           class={`block rounded-md px-2 py-1.5 ${isActive('/dashboard') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
          Dashboard
        </a>
        {#if hasTransportation}
          <a href="/dispatch"
             class={`block rounded-md px-2 py-1.5 ${isActive('/dispatch') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
            Dispatch
          </a>
        {/if}
        {#if canReadAgentActions}
          <a href="/agent-actions"
             class={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive('/agent-actions') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
            <span class="flex-1">Agent actions</span>
            {#if pendingActions > 0}
              <span class="rounded-full bg-danger px-1.5 text-[10px] text-white">{pendingActions}</span>
            {/if}
          </a>
        {/if}
        {#if canReadWorkbench}
          <a href="/workbench"
             class={`block rounded-md px-2 py-1.5 ${isActive('/workbench') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
            Workbench
          </a>
        {/if}
        {#if canReadAgents}
          <a href="/agents"
             class={`block rounded-md px-2 py-1.5 ${isActive('/agents') ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
            Agents
          </a>
        {/if}
        {#each groups.filter((g) => g.visible) as group (group.label)}
          <button
            class="flex w-full items-center gap-1 rounded-md px-2 py-1.5 font-semibold text-slate-200 hover:bg-sidebar-hover"
            onclick={() => { openGroups[group.label] = !openGroups[group.label]; if (typeof localStorage !== 'undefined') localStorage.setItem('pulsar.nav.openGroups', JSON.stringify(openGroups)); }}
            aria-expanded={openGroups[group.label] ?? false}
          >
            {#if openGroups[group.label]}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
            {group.label}
          </button>
          {#if openGroups[group.label]}
            {#each group.items as item (item.href)}
              <a href={item.href}
                 class={`block rounded-md py-1.5 pr-2 pl-7 ${isActive(item.href) ? 'bg-accent text-white' : 'text-ink-faint hover:bg-sidebar-hover hover:text-white'}`}>
                {item.label}
              </a>
            {/each}
          {/if}
        {/each}
      </nav>

      <div class="border-t border-sidebar-border pt-3">
        <!-- notifications bell row -->
        <button
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-ink-faint hover:bg-sidebar-hover hover:text-white"
          onclick={() => (notifOpen = !notifOpen)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
        >
          <Bell class="size-4" />
          <span class="flex-1 text-left text-xs">Notifications</span>
          {#if unreadCount > 0}
            <span class="rounded-full bg-danger px-1.5 text-[10px] text-white">{unreadCount}</span>
          {/if}
        </button>

        {#if notifOpen}
          <div class="absolute bottom-14 left-3 z-30 max-h-80 w-64 overflow-y-auto rounded-card border border-edge bg-surface p-2 shadow-pop">
            {#if notifications.length === 0}
              <p class="px-2 py-3 text-center text-xs text-ink-faint">No notifications</p>
            {:else}
              {#each notifications as n (n.id)}
                <div class={`mb-1 rounded p-2 text-xs ${n.readAt ? 'opacity-60' : ''}`}>
                  <div class="font-semibold text-ink">{n.title}</div>
                  <div class="text-ink-muted">{n.body}</div>
                  <div class="mt-1 flex items-center justify-between">
                    <span class="text-ink-faint">{new Date(n.createdAt).toLocaleString()}</span>
                    {#if !n.readAt}
                      <button
                        class="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-soft"
                        onclick={() => markRead(n.id)}
                      >
                        Mark read
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}

        <!-- user row -->
        <div class="mt-1 flex items-center gap-2 px-2 py-1.5">
          <span class="flex-1 truncate text-xs text-ink-faint">{$auth.user.email}</span>
          <button
            class="rounded p-1 text-ink-faint hover:bg-sidebar-hover hover:text-white"
            onclick={logout}
            aria-label="Sign out"
          >
            <LogOut class="size-3.5" />
          </button>
        </div>
      </div>
    </aside>

    <main class="min-w-0 flex-1 p-6">{@render children()}</main>
  </div>
  <CommandPalette bind:open={paletteOpen} commands={paletteCommands} />
  {#if canChatAgents}
    <AssistantPanel bind:open={assistantOpen} />
  {/if}
{/if}
