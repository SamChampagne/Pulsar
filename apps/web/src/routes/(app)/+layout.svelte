<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fade } from 'svelte/transition';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth, clearAuth, getRefreshToken } from '$lib/stores/auth';
  import { Bell, LogOut, Search, UserRound } from 'lucide-svelte';
  import CommandPalette from '$lib/components/ui/CommandPalette.svelte';
  import AssistantPanel from '$lib/components/agents/AssistantPanel.svelte';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import { visibleDomains as buildVisibleDomains, type NavDomain } from '$lib/modules/navigation';

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
  let profileOpen = $state(false);
  const unreadCount = $derived(notifications.filter((n) => !n.readAt).length);

  const canReadAgentActions = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_ACTIONS_READ) ?? false,
  );
  const canChatAgents = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_CHAT) ?? false,
  );
  let pendingActions = $state(0);
  let assistantOpen = $state(false);

  async function loadNotifications() {
    try {
      notifications = await api<Notification[]>('/notifications', { query: { unread: 'true' } });
    } catch {
      /* non-critical */
    }
  }
  async function loadPendingActions() {
    if (!canReadAgentActions) return;
    try {
      pendingActions = (await api<unknown[]>('/agent-actions')).length;
    } catch {
      /* non-critical */
    }
  }
  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      await loadNotifications();
    } catch {
      /* silent */
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
  $effect(() => {
    if (!$auth) void goto('/login');
  });

  // Build the filtered domain list from the catalogue, then inject the runtime badge.
  const visibleDomains = $derived.by(() => {
    const domains = buildVisibleDomains({
      enabledModules: ($auth?.tenant.enabledModules ?? []) as string[],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    });
    // Inject pendingActions badge onto the agent-actions link (runtime value).
    if (pendingActions > 0) {
      for (const d of domains) {
        for (const s of d.sections) {
          for (const l of s.links) {
            if (l.href === '/agent-actions') l.badge = pendingActions;
          }
        }
      }
    }
    return domains;
  });

  function pathInDomain(d: NavDomain): boolean {
    return d.prefixes.some(
      (p) =>
        page.url.pathname === p ||
        page.url.pathname.startsWith(p + '/') ||
        page.url.pathname.startsWith(p),
    );
  }
  // Active domain = most-specific prefix match; fall back to dashboard.
  const activeDomain = $derived(
    visibleDomains
      .filter((d) => d.key !== 'dashboard' && pathInDomain(d))
      .sort(
        (a, b) =>
          Math.max(...b.prefixes.map((p) => p.length)) -
          Math.max(...a.prefixes.map((p) => p.length)),
      )[0] ?? visibleDomains.find((d) => d.key === 'dashboard'),
  );
  const activeUniverse = $derived(
    MODULE_UNIVERSES[activeDomain?.key ?? 'dashboard'] ?? MODULE_UNIVERSES.dashboard,
  );
  const activeLinks = $derived(activeDomain?.sections.flatMap((s) => s.links) ?? []);
  const deskMode = $derived(
    String(page.url.pathname) === '/apps' || String(page.url.pathname) === '/framework',
  );

  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function linkActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
  }

  function displayName(): string {
    const user = $auth?.user;
    if (!user) return 'Utilisateur Pulsar';
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name || user.email;
  }

  function initials(): string {
    const user = $auth?.user;
    if (!user) return 'U';
    const letters = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.trim();
    return (letters || user.email.slice(0, 2)).toUpperCase();
  }

  function closeFloaters() {
    notifOpen = false;
    profileOpen = false;
  }

  function logout() {
    const refreshToken = getRefreshToken();
    if (refreshToken)
      void api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    clearAuth();
    void goto('/login');
  }

  let paletteOpen = $state(false);
  const paletteCommands = $derived([
    ...(canChatAgents
      ? [{ label: 'Assistant IA', hint: 'chat', run: () => (assistantOpen = true) }]
      : []),
    ...visibleDomains.flatMap((d) =>
      d.sections.flatMap((s) =>
        s.links.map((l) => ({ label: l.label, hint: d.label, run: () => goto(l.href) })),
      ),
    ),
    { label: 'Pulsar Apps', hint: 'plateforme', run: () => goto('/apps') },
    { label: 'Framework', hint: 'plateforme', run: () => goto('/framework') },
  ]);
</script>

{#if $auth}
  <div
    class="flex min-h-screen"
    style={`--module-accent: ${activeUniverse.accent}; --module-soft: ${activeUniverse.soft}; --module-rgb: ${activeUniverse.rgb};`}
  >
    {#if deskMode}
      <div class="flex min-h-screen flex-1 flex-col bg-[#f8f8f7]">
        <header
          class="sticky top-0 z-20 flex h-14 items-center border-b border-edge-soft bg-surface/96 px-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur"
        >
          <a
            href="/apps"
            class="flex size-8 items-center justify-center rounded-xl bg-[#6f7480] text-sm font-bold text-white shadow-sm"
            aria-label="Pulsar desk">⬢</a
          >
          <button
            class="mx-auto hidden h-9 w-full max-w-sm items-center justify-between rounded-lg bg-surface-muted px-3 text-sm text-ink-faint ring-1 ring-edge-soft transition hover:bg-surface sm:flex"
            onclick={() => {
              closeFloaters();
              paletteOpen = true;
            }}
            aria-label="Rechercher (Ctrl+K)"
          >
            <span class="inline-flex items-center gap-2"><Search class="size-4" /> Search</span>
            <span class="text-xs">Ctrl+K</span>
          </button>
          <div class="flex items-center gap-2">
            <button
              class="relative flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
              onclick={() => {
                profileOpen = false;
                notifOpen = !notifOpen;
              }}
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              <Bell class="size-4" />
              {#if unreadCount > 0}<span
                  class="absolute top-1 right-1 size-2 rounded-full bg-danger"
                ></span>{/if}
            </button>
            <button
              class={`grid size-8 place-items-center rounded-full text-xs font-semibold transition ${profileOpen ? 'bg-ink text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
              onclick={() => {
                notifOpen = false;
                profileOpen = !profileOpen;
              }}
              aria-label="Profil utilisateur"
              aria-expanded={profileOpen}
              title={$auth.user.email}
            >
              {initials()}
            </button>
          </div>
        </header>
        <main class="min-w-0 flex-1 overflow-x-hidden">
          {#key page.url.pathname}
            <div in:fade={{ duration: reduceMotion ? 0 : 120 }}>
              {@render children()}
            </div>
          {/key}
        </main>
      </div>
    {:else}
      <!-- Module shell — once an app is opened, show ONLY that selected universe. Global app switching lives on /apps. -->
      <aside class="flex w-64 shrink-0 flex-col border-r border-edge bg-surface">
        <div class="border-b border-edge-soft p-4">
          <a
            href="/apps"
            class="inline-flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 text-xs font-semibold text-ink-muted transition hover:bg-accent-soft hover:text-accent"
            aria-label="Retour au bureau Pulsar"
          >
            <span class="text-base leading-none">⬢</span>
            Bureau des apps
          </a>
          <div class="mt-5 flex items-start gap-3">
            {#if activeDomain}
              {@const Icon = activeDomain.icon}
              <div
                class="grid size-11 place-items-center rounded-2xl text-white shadow-sm"
                style={`background: ${activeUniverse.accent}`}
              >
                <Icon class="size-5" />
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="truncate text-base font-bold text-ink">{activeUniverse.title}</h1>
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                  style={`background: ${activeUniverse.accent}`}>{activeUniverse.signal}</span
                >
              </div>
            </div>
          </div>
        </div>

        <nav class="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Menu du module sélectionné">
          {#if activeDomain && activeDomain.sections.length > 0}
            <div class="space-y-4">
              {#each activeDomain.sections as section (section.label ?? section.links[0]?.href)}
                <section>
                  {#if section.label}
                    <div
                      class="px-2 pb-1 text-[10px] font-semibold tracking-[0.18em] text-ink-faint uppercase"
                    >
                      {section.label}
                    </div>
                  {/if}
                  <div class="grid gap-1">
                    {#each section.links as l (l.href)}
                      <a
                        href={l.href}
                        class={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm transition ${linkActive(l.href) ? 'font-semibold text-white shadow-sm' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}`}
                        style={linkActive(l.href) ? `background: ${activeUniverse.accent}` : ''}
                      >
                        <span class="truncate">{l.label}</span>
                        {#if l.badge}<span
                            class="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white"
                            >{l.badge}</span
                          >{/if}
                      </a>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {:else}
            <p class="rounded-2xl bg-surface-muted p-3 text-sm text-ink-muted">
              Ce module n'a pas encore de menu dédié.
            </p>
          {/if}
        </nav>

        <div class="border-t border-edge-soft p-3">
          <div class="mb-3 rounded-2xl bg-surface-muted p-3 text-xs text-ink-muted">
            <div class="font-semibold text-ink">{$auth.tenant.name}</div>
            <div class="mt-1 font-mono text-[10px] text-ink-faint">tenant {$auth.tenant.slug}</div>
          </div>
          <div class="flex gap-2">
            <button
              class="relative flex size-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted hover:text-ink"
              onclick={() => {
                profileOpen = false;
                notifOpen = !notifOpen;
              }}
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              <Bell class="size-5" />
              {#if unreadCount > 0}<span
                  class="absolute top-1 right-1 size-2 rounded-full bg-danger"
                ></span>{/if}
            </button>
            <button
              class={`grid size-10 flex-1 place-items-center rounded-xl text-xs font-bold transition-colors ${profileOpen ? 'bg-ink text-white' : 'bg-surface-muted text-ink hover:bg-accent-soft hover:text-accent'}`}
              onclick={() => {
                notifOpen = false;
                profileOpen = !profileOpen;
              }}
              aria-label="Profil utilisateur"
              aria-expanded={profileOpen}
              title="Profil utilisateur"
            >
              {initials()}
            </button>
          </div>
        </div>
      </aside>

      <main
        class="min-w-0 flex-1 overflow-x-hidden p-6"
        style={`background: radial-gradient(circle at top left, rgb(${activeUniverse.rgb} / 0.10), transparent 360px), var(--color-canvas);`}
      >
        {#key page.url.pathname}
          <div in:fade={{ duration: reduceMotion ? 0 : 120 }}>
            {@render children()}
          </div>
        {/key}
      </main>
    {/if}

    {#if profileOpen}
      <div
        class={`fixed z-50 w-80 rounded-2xl border border-edge bg-surface p-3 shadow-pop ${deskMode ? 'top-14 right-4' : 'bottom-4 left-[17rem]'}`}
      >
        <div class="flex items-start gap-3 border-b border-edge-soft pb-3">
          <div
            class="grid size-11 place-items-center rounded-2xl text-sm font-bold text-white"
            style={`background: ${activeUniverse.accent}`}
          >
            {initials()}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold text-ink">{displayName()}</div>
            <div class="truncate text-xs text-ink-muted">{$auth.user.email}</div>
            <div
              class="mt-2 inline-flex rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok"
            >
              Compte actif
            </div>
          </div>
        </div>
        <div class="grid gap-2 py-3 text-xs">
          <div class="rounded-xl bg-surface-muted p-3">
            <div class="font-semibold text-ink">Tenant</div>
            <div class="mt-1 flex items-center justify-between gap-2">
              <span class="truncate text-ink-muted">{$auth.tenant.name}</span>
              <span
                class="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
                style={`background: ${activeUniverse.soft}; color: ${activeUniverse.accent}`}
                >{$auth.tenant.slug}</span
              >
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-xl bg-surface-muted p-3">
              <div class="text-ink-faint">Modules</div>
              <div class="mt-1 text-base font-bold text-ink">
                {$auth.tenant.enabledModules.length}
              </div>
            </div>
            <div class="rounded-xl bg-surface-muted p-3">
              <div class="text-ink-faint">Permissions</div>
              <div class="mt-1 text-base font-bold text-ink">{$auth.user.permissions.length}</div>
            </div>
          </div>
        </div>
        <div class="flex gap-2 border-t border-edge-soft pt-3">
          <a
            href="/settings/users"
            class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs font-semibold text-ink hover:bg-accent-soft hover:text-accent"
          >
            <UserRound class="size-4" /> Profil
          </a>
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger hover:text-white"
            onclick={logout}
          >
            <LogOut class="size-4" /> Déconnexion
          </button>
        </div>
      </div>
    {/if}

    {#if notifOpen}
      <div
        class="fixed bottom-4 left-[17rem] z-30 max-h-96 w-72 overflow-y-auto rounded-card border border-edge bg-surface p-2 shadow-pop"
      >
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
                  <button
                    class="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-soft"
                    onclick={() => markRead(n.id)}>Marquer lu</button
                  >
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
