<script module lang="ts">
  import type { ComponentType } from 'svelte';

  /**
   * One entry of the portal's left navigation. `href` drives a real SPA link
   * (session plane: one route per section); a nav item without `href` is an
   * in-page tab handled through `onselect` — that is the capability-link plane,
   * which lives entirely under `/portal/:token` and has no sub-routes.
   */
  export interface PortalNavItem {
    key: string;
    label: string;
    href?: string;
    icon?: ComponentType;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { Drawer } from '$lib/components/ui';
  import { Menu } from 'lucide-svelte';

  let {
    branding = undefined,
    shipperName = '',
    customerName = '',
    user = null,
    nav = [],
    activeKey = undefined,
    onselect = undefined,
    onLogout = undefined,
    children,
  }: {
    branding?: { logoUrl?: string; accentColor?: string } | undefined;
    shipperName?: string;
    customerName?: string;
    user?: { firstName: string; lastName: string; email: string } | null;
    nav?: PortalNavItem[];
    activeKey?: string | undefined;
    onselect?: ((key: string) => void) | undefined;
    onLogout?: (() => void | Promise<void>) | undefined;
    children: Snippet;
  } = $props();

  let drawerOpen = $state(false);
  let profileOpen = $state(false);

  /**
   * Active item: the explicit `activeKey` when the caller drives tabs itself,
   * otherwise the longest matching `href` — so a section home never lights up
   * at the same time as one of its children.
   */
  const activeItemKey = $derived.by(() => {
    if (activeKey !== undefined) return activeKey;
    let best: PortalNavItem | null = null;
    for (const item of nav) {
      if (!item.href) continue;
      if (page.url.pathname === item.href || page.url.pathname.startsWith(item.href + '/')) {
        if (!best || item.href.length > (best.href?.length ?? 0)) best = item;
      }
    }
    return best?.key;
  });

  const initials = $derived(
    user
      ? (
          `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.trim() || user.email.slice(0, 2)
        ).toUpperCase()
      : '',
  );
  const displayName = $derived(
    user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : '',
  );

  // Only the accent token is themed by the shipper: everything else stays on
  // the product palette, so an unlucky brand colour can never make the portal
  // unreadable. `--t-accent` is the real token (`--color-accent` reads it).
  const accentStyle = $derived(
    branding?.accentColor ? `--t-accent: ${branding.accentColor};` : undefined,
  );

  function pick(item: PortalNavItem) {
    drawerOpen = false;
    if (!item.href) onselect?.(item.key);
  }
</script>

{#snippet navLinks()}
  <div class="grid gap-0.5">
    {#each nav as item (item.key)}
      {@const active = item.key === activeItemKey}
      {@const cls = `flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active
          ? 'bg-surface-muted font-medium text-ink'
          : 'text-ink-muted hover:bg-surface-muted/70 hover:text-ink'
      }`}
      {#if item.href}
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          class={cls}
          onclick={() => pick(item)}
        >
          {#if item.icon}{@const Icon = item.icon}<Icon class="size-4 shrink-0" />{/if}
          <span class="truncate">{item.label}</span>
        </a>
      {:else}
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          class={cls}
          onclick={() => pick(item)}
        >
          {#if item.icon}{@const Icon = item.icon}<Icon class="size-4 shrink-0" />{/if}
          <span class="truncate">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/snippet}

<div
  data-theme="warm"
  data-testid="portal-shell"
  class="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas"
  style={accentStyle}
>
  <a
    href="#portal-content"
    class="sr-only z-[60] rounded-md bg-surface p-3 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    >Aller au contenu</a
  >

  <header
    class="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-surface px-3 sm:gap-3 sm:px-4"
  >
    {#if nav.length > 0}
      <button
        class="shell-icon lg:hidden"
        onclick={() => (drawerOpen = true)}
        aria-label="Ouvrir le menu"
        aria-expanded={drawerOpen}><Menu class="size-5" /></button
      >
    {/if}

    <div class="flex min-w-0 shrink items-center gap-2">
      {#if branding?.logoUrl}
        <img src={branding.logoUrl} alt={shipperName} class="h-7 max-w-[150px] object-contain" />
      {:else}
        <span
          class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-base font-semibold text-white"
          aria-hidden="true">⬢</span
        >
        <span class="hidden truncate text-sm font-semibold text-ink sm:inline">{shipperName}</span>
      {/if}
    </div>

    <span class="hidden h-5 w-px bg-edge sm:block"></span>
    <span class="min-w-0 truncate text-sm text-ink-muted" data-testid="portal-customer"
      >{customerName}</span
    >

    <div class="ml-auto flex shrink-0 items-center gap-2">
      {#if user}
        <button
          class="grid size-8 shrink-0 place-items-center rounded-full border border-edge bg-surface-muted text-xs font-medium text-ink"
          onclick={() => (profileOpen = !profileOpen)}
          aria-label={`Votre compte — ${displayName}`}
          aria-expanded={profileOpen}
          title={user.email}>{initials}</button
        >
      {:else}
        <span class="hidden text-xs text-ink-faint sm:inline">Accès par lien sécurisé</span>
      {/if}
    </div>
  </header>

  {#if user && profileOpen}
    <div class="relative">
      <div
        class="absolute right-3 z-30 mt-1 w-64 rounded-card border border-edge bg-surface p-3 shadow-pop sm:right-4"
        role="group"
        aria-label="Votre compte"
      >
        <p class="text-sm font-semibold text-ink">{displayName}</p>
        <p class="mt-0.5 text-xs break-all text-ink-muted">{user.email}</p>
        <p class="mt-2 text-xs text-ink-muted">{customerName}</p>
        {#if onLogout}
          <button
            class="mt-3 w-full rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-danger-soft"
            onclick={() => {
              profileOpen = false;
              void onLogout?.();
            }}>Se déconnecter</button
          >
        {/if}
      </div>
    </div>
  {/if}

  <div class="flex min-h-0 min-w-0 flex-1">
    {#if nav.length > 0}
      <aside
        class="hidden w-56 shrink-0 flex-col border-r border-edge bg-surface lg:flex"
        aria-label="Sections du portail"
      >
        <nav class="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Portail client">
          {@render navLinks()}
        </nav>
        <div class="shrink-0 border-t border-edge px-4 py-3">
          <div class="truncate text-xs font-medium text-ink">{customerName}</div>
          <p class="mt-1 text-xs text-ink-faint">Propulsé par Pulsar</p>
        </div>
      </aside>
    {/if}

    <main
      id="portal-content"
      tabindex="-1"
      class="min-h-0 min-w-0 flex-1 overflow-auto p-4 focus:outline-none lg:p-6"
    >
      <div class="mx-auto min-w-0 max-w-6xl">
        {@render children()}
      </div>
    </main>
  </div>
</div>

<Drawer bind:open={drawerOpen} title={customerName || 'Portail client'} width="sm" side="left">
  <nav aria-label="Portail client (mobile)">{@render navLinks()}</nav>
  {#snippet footer()}<span class="mr-auto text-xs text-ink-faint">Propulsé par Pulsar</span
    >{/snippet}
</Drawer>
