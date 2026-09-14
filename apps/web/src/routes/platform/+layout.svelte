<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { clearPlatformToken, getPlatformToken } from '$lib/api/platform';
  import { Activity, Building2, Boxes, LogOut } from 'lucide-svelte';
  let { children } = $props();
  const login = $derived(page.url.pathname === '/platform/login');
  const links = [
    { href: '/platform/operations', label: 'Exploitation', icon: Activity },
    { href: '/platform/tenants', label: 'Entreprises', icon: Building2 },
    { href: '/platform/modules', label: 'Catalogue', icon: Boxes },
  ];
  $effect(() => {
    if (!login && !getPlatformToken()) void goto('/platform/login');
  });
  function logout() {
    clearPlatformToken();
    void goto('/platform/login');
  }
</script>

<div class="min-h-dvh bg-canvas text-ink">
  {#if login}
    {@render children()}
  {:else}
    <a
      href="#platform-content"
      class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-3"
      >Aller au contenu</a
    >
    <header class="border-b border-edge bg-surface">
      <div
        class="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
      >
        <a href="/platform/operations" class="font-semibold tracking-tight"
          >PULSAR <span class="ml-2 font-mono text-xs font-normal text-ink-muted"
            >Administration SaaS</span
          ></a
        >
        <div class="flex items-center gap-3 text-xs">
          <a href="/apps" class="text-ink-muted hover:text-accent">Espace entreprise</a><button
            onclick={logout}
            class="rounded p-2 hover:bg-surface-muted"
            aria-label="Déconnexion administration"><LogOut class="size-4" /></button
          >
        </div>
      </div>
      <nav
        aria-label="Administration Pulsar"
        class="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 sm:px-6"
      >
        {#each links as link (link.href)}
          <a
            href={link.href}
            aria-current={page.url.pathname === link.href ? 'page' : undefined}
            class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm {page.url
              .pathname === link.href
              ? 'border-accent font-semibold text-accent'
              : 'border-transparent text-ink-muted hover:text-ink'}"
            ><link.icon class="size-4" />{link.label}</a
          >
        {/each}
      </nav>
    </header>
    <main id="platform-content" class="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      {@render children()}
    </main>
  {/if}
</div>
