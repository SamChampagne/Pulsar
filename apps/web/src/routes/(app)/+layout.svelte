<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import UserTimeZone from '$lib/components/ui/UserTimeZone.svelte';
  import ModuleScanner from '$lib/components/scanning/ModuleScanner.svelte';
  import ModuleTour from '$lib/components/help/ModuleTour.svelte';
  import { requestModuleTour } from '$lib/help/tours';
  import { onMount } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fade } from 'svelte/transition';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth, clearAuth, getRefreshToken } from '$lib/stores/auth';
  import { deskSearch } from '$lib/stores/desk';
  import { getPreferences } from '$lib/api/preferences';
  import { loadAppearanceFrom } from '$lib/stores/appearance';
  import { unseenReleaseNotes } from '$lib/stores/release-notes';
  import {
    Bell,
    CircleHelp,
    LogOut,
    Menu,
    Search,
    Sparkles,
    X,
    Grid2X2,
    ChevronDown,
    Inbox,
    Workflow,
    Bot,
    SlidersHorizontal,
  } from 'lucide-svelte';
  import { Drawer, Modal } from '$lib/components/ui';
  import { density, toggleDensity } from '$lib/stores/density';
  import CommandPalette from '$lib/components/ui/CommandPalette.svelte';
  import AssistantPanel from '$lib/components/agents/AssistantPanel.svelte';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import {
    visibleDomains as buildVisibleDomains,
    domainHome,
    type NavDomain,
  } from '$lib/modules/navigation';

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
  let drawerOpen = $state(false);
  let switcherOpen = $state(false);
  let switcherSearch = $state('');
  let lastRoutes = $state<Record<string, string>>({});
  let workspaceEl = $state<HTMLElement>();
  const unreadCount = $derived(notifications.filter((n) => !n.readAt).length);

  const canReadAgentActions = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_ACTIONS_READ) ?? false,
  );
  const canChatAgents = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_CHAT) ?? false,
  );
  let pendingActions = $state(0);
  let assistantOpen = $state(false);
  let activeAgentChats = $state(0);

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
  async function loadUnseenReleaseNotes() {
    try {
      const { count } = await api<{ count: number }>('/release-notes/unseen-count');
      unseenReleaseNotes.set(count);
    } catch {
      /* non-critical */
    }
  }

  $effect(() => {
    if ($auth) {
      void loadNotifications();
      void loadPendingActions();
      void loadUnseenReleaseNotes();
      const interval = setInterval(() => {
        void loadNotifications();
        void loadPendingActions();
        void loadUnseenReleaseNotes();
      }, 60_000);
      return () => clearInterval(interval);
    }
  });
  $effect(() => {
    if (!$auth) void goto('/login');
  });
  $effect(() => {
    if (page.url.pathname !== '/apps') deskSearch.set('');
    // Route change (including SPA navigations from drawer links) always closes
    // the mobile drawer — there's nothing to keep open once we've navigated.
    drawerOpen = false;
    closeFloaters();
    switcherOpen = false;
    workspaceEl?.scrollTo({ top: 0, left: 0 });
  });

  onMount(() => {
    void getPreferences()
      .then((p) => loadAppearanceFrom(p.appearance))
      .catch(() => {});
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

  // Length of the LONGEST prefix of `d` that the current path actually matches
  // (0 if none). Used so the most-specific *matching* prefix wins — never an
  // unrelated longer prefix of the same domain.
  function matchedPrefixLen(d: NavDomain): number {
    let best = 0;
    for (const p of d.prefixes) {
      if (page.url.pathname === p || page.url.pathname.startsWith(p + '/')) {
        if (p.length > best) best = p.length;
      }
    }
    return best;
  }
  // Active domain = the domain whose matching prefix is most specific; fall back to dashboard.
  const activeDomain = $derived(
    visibleDomains
      .filter((d) => d.key !== 'dashboard' && matchedPrefixLen(d) > 0)
      .sort((a, b) => matchedPrefixLen(b) - matchedPrefixLen(a))[0] ??
      visibleDomains.find((d) => d.key === 'dashboard'),
  );
  const activeUniverse = $derived(
    MODULE_UNIVERSES[activeDomain?.key ?? 'dashboard'] ?? MODULE_UNIVERSES.dashboard,
  );
  const activeLinks = $derived(activeDomain?.sections.flatMap((s) => s.links) ?? []);
  const deskMode = $derived(
    String(page.url.pathname) === '/apps' || String(page.url.pathname) === '/framework',
  );

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // The single active link = the LONGEST href among the visible links that the
  // current path matches. Without this, a module "home" link (e.g. /analytics)
  // would also light up on every child route (/analytics/control-tower, …),
  // making it look like two menu items are selected at once.
  const activeLinkHref = $derived.by(() => {
    let best = '';
    for (const l of activeLinks) {
      if (page.url.pathname === l.href || page.url.pathname.startsWith(l.href + '/')) {
        if (l.href.length > best.length) best = l.href;
      }
    }
    return best;
  });

  function linkActive(href: string): boolean {
    return href === activeLinkHref;
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

  const canWork = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_READ) ?? false,
  );
  const canTrace = $derived(
    !!$auth?.tenant.enabledModules.includes('analytics') &&
      $auth.user.permissions.includes(PERMISSIONS.ANALYTICS.READ),
  );
  const isWorkbench = $derived(page.url.pathname.startsWith('/workbench'));
  const contextTitle = $derived(isWorkbench ? 'Mon travail' : (activeDomain?.label ?? 'Pulsar'));
  const currentPage = $derived(activeLinks.find((l) => l.href === activeLinkHref)?.label);
  const switcherDomains = $derived(
    visibleDomains.filter(
      (d) =>
        d.key !== 'dashboard' &&
        d.label.toLocaleLowerCase('fr').includes(switcherSearch.toLocaleLowerCase('fr').trim()),
    ),
  );

  // Keep each app's most recent URL (including filters) for this signed-in workspace only.
  $effect(() => {
    const scope = $auth ? $auth.tenant.id + ':' + $auth.user.id : '';
    if (scope) lastRoutes = {};
  });
  beforeNavigate(() => {
    if (activeDomain && !deskMode) {
      lastRoutes = { ...lastRoutes, [activeDomain.key]: page.url.pathname + page.url.search };
    }
  });
  function openSwitcher() {
    closeFloaters();
    switcherSearch = '';
    switcherOpen = true;
  }
</script>

{#snippet moduleLinks()}
  {#if activeDomain}
    <div class="space-y-5">
      {#each activeDomain.sections as section (section.label ?? section.links[0]?.href)}
        <section>
          {#if section.label}<h2 class="px-3 pb-2 text-xs font-medium text-ink-faint">
              {section.label}
            </h2>{/if}
          <div class="grid gap-0.5">
            {#each section.links as l (l.href)}
              <a
                data-tour-href={l.href}
                href={l.href}
                aria-current={linkActive(l.href) ? 'page' : undefined}
                class={`flex min-h-9 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors ${linkActive(l.href) ? 'bg-surface-muted font-medium text-ink' : 'text-ink-muted hover:bg-surface-muted/70 hover:text-ink'}`}
              >
                <span class="truncate">{l.label}</span>
                {#if l.badge}<span
                    class="rounded bg-danger px-1.5 text-[10px] font-semibold text-white"
                    >{l.badge}</span
                  >{/if}
              </a>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
{/snippet}

{#if $auth}
  <div
    class="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas"
    style={`--module-accent: ${activeUniverse.accent}; --module-soft: ${activeUniverse.soft}; --module-rgb: ${activeUniverse.rgb};`}
    data-testid="workspace-shell"
  >
    <a
      href="#workspace-content"
      class="sr-only z-[60] rounded-md bg-surface p-3 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >Aller au contenu</a
    >
    <header
      class="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-surface px-3 sm:gap-3 sm:px-4"
    >
      {#if !deskMode}
        <button
          class="shell-icon lg:hidden"
          onclick={() => (drawerOpen = true)}
          aria-label="Ouvrir le menu"
          data-tour="module-menu"
          aria-expanded={drawerOpen}><Menu class="size-5" /></button
        >
      {/if}
      <a
        href="/apps"
        aria-label="Retour au bureau Pulsar"
        class="flex shrink-0 items-center gap-2 rounded-md"
      >
        <span
          class="grid size-8 place-items-center rounded-lg bg-zinc-800 text-base font-semibold text-white"
          >⬢</span
        >
        <span class="hidden text-sm font-semibold sm:inline">Pulsar</span>
      </a>
      <span class="hidden h-5 w-px bg-edge sm:block"></span>
      <button
        class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-surface-muted"
        onclick={openSwitcher}
        aria-label="Changer d’application"
        data-tour="module-switcher"
        aria-haspopup="dialog"
      >
        {#if deskMode}<Grid2X2 class="size-4 shrink-0 text-ink-muted" />{:else if activeDomain}
          {@const Icon = activeDomain.icon}
          <span
            class="grid size-6 shrink-0 place-items-center rounded-md text-white"
            style={`background: ${activeUniverse.accent}`}><Icon class="size-3.5" /></span
          >
        {/if}
        <span class="max-w-32 truncate">{deskMode ? 'Bureau' : contextTitle}</span><ChevronDown
          class="size-3.5 shrink-0 text-ink-faint"
        />
      </button>
      {#if !deskMode && currentPage && currentPage !== contextTitle}
        <span class="hidden min-w-0 truncate text-xs text-ink-muted xl:block"
          >/ &nbsp; {currentPage}</span
        >
      {/if}
      <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <ModuleScanner domain={activeDomain?.key ?? ''} />
        <button
          type="button"
          class="shell-icon"
          data-tour="module-help"
          aria-label="Tutoriel du module"
          title="Rejouer le tutoriel du module"
          onclick={requestModuleTour}><CircleHelp size={18} /></button
        >
        {#if page.url.pathname === '/apps'}
          <label
            class="hidden h-9 w-52 items-center gap-2 rounded-md border border-edge bg-surface px-2.5 md:flex lg:w-64"
          >
            <Search class="size-4 shrink-0 text-ink-faint" /><input
              class="min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder="Rechercher une app…"
              bind:value={$deskSearch}
              aria-label="Rechercher une app"
            />
            {#if $deskSearch}<button
                class="text-ink-muted"
                onclick={() => ($deskSearch = '')}
                aria-label="Effacer"><X class="size-3.5" /></button
              >{/if}
          </label>
        {:else}
          <nav class="hidden items-center gap-1 xl:flex" aria-label="Outils de travail">
            {#if canWork}<a
                class="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-ink-muted hover:bg-surface-muted"
                href="/workbench"><Inbox class="size-3.5" /> Mon travail</a
              >{/if}
            {#if canTrace}<a
                class="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-ink-muted hover:bg-surface-muted"
                href="/workflows"><Workflow class="size-3.5" /> Dossiers connectés</a
              >{/if}
          </nav>
        {/if}
        <button
          class="shell-icon"
          onclick={() => {
            closeFloaters();
            paletteOpen = true;
          }}
          aria-label="Rechercher (Ctrl+K)"
          title="Aller à… (Ctrl+K)"><Search class="size-4" /></button
        >
        {#if canChatAgents}<button
            class="shell-icon relative"
            onclick={() => {
              closeFloaters();
              assistantOpen = true;
            }}
            aria-label="Assistant IA"
            title="Espace IA — conversations et workers"
            ><Bot class="size-4" />{#if activeAgentChats > 0}<span
                class="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white"
                aria-label="{activeAgentChats} conversations en cours">{activeAgentChats}</span
              >{/if}</button
          >{/if}
        <a
          href="/whats-new"
          class="shell-icon relative"
          onclick={closeFloaters}
          aria-label="Quoi de neuf"
          title="Quoi de neuf"
        >
          <Sparkles class="size-4" />{#if $unseenReleaseNotes > 0}<span
              class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-danger"
            ></span>{/if}
        </a>
        <button
          class="shell-icon relative"
          onclick={() => {
            profileOpen = false;
            notifOpen = !notifOpen;
          }}
          aria-label="Notifications"
          aria-expanded={notifOpen}
        >
          <Bell class="size-4" />{#if unreadCount > 0}<span
              class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-danger"
            ></span>{/if}
        </button>
        <button
          class="grid size-8 shrink-0 place-items-center rounded-full border border-edge bg-surface-muted text-xs font-medium text-ink"
          onclick={() => {
            notifOpen = false;
            profileOpen = !profileOpen;
          }}
          aria-label="Profil utilisateur"
          aria-expanded={profileOpen}
          title={$auth.user.email}>{initials()}</button
        >
      </div>
    </header>
    <div
      class="flex h-7 shrink-0 items-center justify-end border-b border-edge bg-surface px-3"
      aria-label="Contexte horaire"
    >
      <UserTimeZone />
    </div>

    <div class="flex min-h-0 min-w-0 flex-1">
      {#if !deskMode}
        <aside
          class="hidden w-56 shrink-0 flex-col border-r border-edge bg-surface lg:flex"
          aria-label="Menu principal"
        >
          <nav
            class="workspace-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4"
            aria-label="Menu du module sélectionné"
            data-tour="module-nav"
          >
            {@render moduleLinks()}
          </nav>
          <div class="shrink-0 border-t border-edge px-4 py-3">
            <div class="truncate text-xs font-medium text-ink">{$auth.tenant.name}</div>
            <a
              class="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
              href="/apps"><Grid2X2 class="size-3.5" /> Bureau des apps</a
            >
          </div>
        </aside>
      {/if}
      <main
        id="workspace-content"
        data-tour="workspace"
        data-workspace-scroll
        bind:this={workspaceEl}
        tabindex="-1"
        class={`workspace-scroll min-h-0 min-w-0 flex-1 overflow-auto focus:outline-none ${deskMode ? '' : 'p-4 lg:p-6'}`}
      >
        {#key page.url.pathname}
          <div class="min-w-0" in:fade={{ duration: reduceMotion ? 0 : 120 }}>
            {@render children()}
          </div>
        {/key}
      </main>
    </div>
  </div>

  <ModuleTour domain={activeDomain} />
  <Drawer bind:open={drawerOpen} title={contextTitle} width="sm" side="left">
    <nav aria-label="Menu du module sélectionné">{@render moduleLinks()}</nav>
    {#snippet footer()}<a href="/apps" class="mr-auto text-sm font-medium">Bureau des apps</a
      >{/snippet}
  </Drawer>

  <Modal bind:open={switcherOpen} title="Changer d’application" size="lg">
    <label class="mb-4 flex items-center gap-2 rounded-md border border-edge px-3 py-2">
      <Search class="size-4 text-ink-muted" /><input
        class="min-w-0 flex-1 bg-transparent text-sm outline-none"
        bind:value={switcherSearch}
        aria-label="Filtrer les applications"
        placeholder="Trouver une application…"
      />
    </label>
    <div class="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Applications accessibles">
      {#each switcherDomains as domain (domain.key)}
        {@const Icon = domain.icon}
        {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES.dashboard}
        <a
          href={lastRoutes[domain.key] ?? domainHome(domain)}
          onclick={() => (switcherOpen = false)}
          class="flex min-h-24 flex-col items-center gap-2 rounded-lg p-2 text-center text-xs text-ink hover:bg-surface-muted"
        >
          <span
            class="grid size-11 place-items-center rounded-xl text-white shadow-sm"
            style={`background: ${universe.accent}`}><Icon class="size-5" /></span
          >
          <span class="line-clamp-2">{domain.label}</span>
        </a>
      {:else}<p class="col-span-full py-8 text-center text-sm text-ink-muted">
          Aucune application correspondante.
        </p>{/each}
    </div>
    {#snippet footer()}
      <div class="flex w-full flex-wrap items-center justify-between gap-3 text-sm">
        <a
          href="/apps"
          onclick={() => (switcherOpen = false)}
          class="inline-flex items-center gap-2 font-medium"
          ><Grid2X2 class="size-4" /> Ouvrir le bureau</a
        >
        <div class="flex gap-4">
          {#if canWork}<a
              href="/workbench"
              onclick={() => (switcherOpen = false)}
              class="text-ink-muted">Mon travail</a
            >{/if}
          {#if canTrace}<a
              href="/workflows"
              onclick={() => (switcherOpen = false)}
              class="text-ink-muted">Dossiers connectés</a
            >{/if}
        </div>
      </div>
    {/snippet}
  </Modal>

  <Modal bind:open={profileOpen} title="Votre espace" size="sm">
    <div class="mb-4 border-b border-edge pb-4">
      <p class="text-sm font-semibold">{displayName()}</p>
      <p class="mt-1 break-all text-xs text-ink-muted">{$auth.user.email}</p>
      <p class="mt-2 text-xs text-ink-muted">
        {$auth.tenant.name} · {$auth.tenant.enabledModules.length} modules
      </p>
    </div>
    <div class="grid gap-2 text-sm">
      <a
        href="/personalize"
        onclick={closeFloaters}
        class="flex items-center gap-2 rounded-md p-2 hover:bg-surface-muted"
        ><SlidersHorizontal class="size-4" /> Personnaliser mon espace</a
      >
      <button
        class="flex items-center justify-between gap-2 rounded-md p-2 text-left hover:bg-surface-muted"
        onclick={toggleDensity}
        aria-pressed={$density === 'compact'}
        ><span>Tables compactes</span><span class="text-xs text-ink-muted"
          >{$density === 'compact' ? 'Activées' : 'Désactivées'}</span
        ></button
      >
      {#if canChatAgents}<button
          class="flex items-center gap-2 rounded-md p-2 hover:bg-surface-muted"
          onclick={() => {
            closeFloaters();
            assistantOpen = true;
          }}><Bot class="size-4" /> Assistant IA</button
        >{/if}
    </div>
    {#snippet footer()}<button
        class="mr-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-danger hover:bg-danger-soft"
        onclick={logout}><LogOut class="size-4" /> Déconnexion</button
      >{/snippet}
  </Modal>

  <Drawer bind:open={notifOpen} title="Notifications" width="md">
    {#each notifications as n (n.id)}
      <article class="border-b border-edge-soft py-3">
        <h3 class="text-sm font-medium">{n.title}</h3>
        <p class="mt-1 text-sm text-ink-muted">{n.body}</p>
        <div class="mt-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
          <time datetime={n.createdAt}>{fmtUserInstant(n.createdAt)}</time>
          {#if !n.readAt}<button
              class="rounded-md px-2 py-1 text-ink hover:bg-surface-muted"
              onclick={() => markRead(n.id)}>Marquer lu</button
            >{/if}
        </div>
      </article>
    {:else}<p class="py-8 text-center text-sm text-ink-muted">Aucune notification à lire.</p>{/each}
  </Drawer>
  <CommandPalette bind:open={paletteOpen} commands={paletteCommands} />
  {#if canChatAgents}<AssistantPanel
      bind:open={assistantOpen}
      bind:activeCount={activeAgentChats}
    />{/if}
{/if}
