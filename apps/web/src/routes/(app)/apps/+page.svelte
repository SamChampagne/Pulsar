<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { visibleDomains, type NavDomain } from '$lib/modules/navigation';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import { Cuboid, Search, Settings, Database, Users, Wrench } from 'lucide-svelte';
  import type { ComponentType } from 'svelte';

  const systemShortcuts: Array<{ key: string; label: string; href: string; icon: ComponentType }> = [
    { key: 'settings', label: 'Réglages',    href: '/settings/users',        icon: Settings },
    { key: 'data',     label: 'Données',     href: '/settings/modules',      icon: Database },
    { key: 'users',    label: 'Utilisateurs',href: '/settings/users',        icon: Users    },
    { key: 'automation',label: 'Automation', href: '/settings/agent-runtime',icon: Wrench   },
  ];

  // Build caps from auth store — mirrors +layout.svelte exactly.
  const domains = $derived(
    visibleDomains({
      enabledModules: ($auth?.tenant.enabledModules ?? []) as string[],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    }),
  );

  // Flatten all links per domain for searching.
  interface FlatLink { domainKey: string; domainLabel: string; href: string; label: string }
  const allLinks = $derived<FlatLink[]>(
    domains.flatMap((d) =>
      d.sections.flatMap((s) =>
        s.links.map((l) => ({ domainKey: d.key, domainLabel: d.label, href: l.href, label: l.label })),
      ),
    ),
  );

  let query = $state('');

  // Domains matching the search query (domain label, section label, or link label).
  const filteredDomains = $derived<NavDomain[]>(
    query.trim() === ''
      ? domains
      : domains
          .map((d) => ({
            ...d,
            sections: d.sections
              .map((s) => ({
                ...s,
                links: s.links.filter(
                  (l) =>
                    d.label.toLowerCase().includes(query.toLowerCase()) ||
                    (s.label ?? '').toLowerCase().includes(query.toLowerCase()) ||
                    l.label.toLowerCase().includes(query.toLowerCase()),
                ),
              }))
              .filter((s) => s.links.length > 0),
          }))
          .filter((d) => d.sections.length > 0),
  );

  let frameworkOpen = $state(false);
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

<section class="min-h-[calc(100vh-3.5rem)] bg-[#f8f8f7] px-4 py-14 text-ink sm:px-8 lg:px-12">
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="mb-8 text-center">
      <p class="text-xs font-semibold tracking-[0.26em] text-ink-faint uppercase">Pulsar Desk</p>
      <h1 class="mt-2 text-xl font-semibold tracking-tight text-ink">Toutes les pages</h1>
    </div>

    <!-- Search -->
    <div class="mx-auto mb-10 flex max-w-sm items-center gap-2 rounded-xl border border-edge bg-white px-3 py-2 shadow-sm ring-1 ring-black/5 focus-within:ring-accent">
      <Search class="size-4 shrink-0 text-ink-faint" />
      <input
        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
        placeholder="Rechercher une page…"
        bind:value={query}
        aria-label="Filtrer les pages"
      />
      {#if query}
        <button
          type="button"
          class="rounded-md px-1 text-xs text-ink-faint hover:text-ink"
          onclick={() => (query = '')}
          aria-label="Effacer la recherche"
        >✕</button>
      {/if}
    </div>

    {#if filteredDomains.length === 0}
      <p class="text-center text-sm text-ink-faint">Aucune page ne correspond à «{query}».</p>
    {:else}
      <div class="space-y-12">
        {#each filteredDomains as domain (domain.key)}
          {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES.dashboard}
          {@const Icon = domain.icon}
          {@const allDomainLinks = domain.sections.flatMap((s) => s.links)}

          {#if domain.key === 'dashboard'}
            <!-- Dashboard / Plateforme domain — keep the Framework folder + its links side by side -->
            <div>
              <div class="mb-5 flex items-center gap-3">
                <div
                  class="grid size-8 place-items-center rounded-xl text-white shadow-sm"
                  style={`background: ${universe.accent}`}
                >
                  <Icon class="size-4" />
                </div>
                <h2 class="text-sm font-semibold text-ink">{domain.label}</h2>
              </div>
              <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
                <!-- Framework folder (special) -->
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
                          {@const ShortcutIcon = shortcut.icon}
                          <a href={shortcut.href} class="group/item flex flex-col items-center rounded-2xl bg-[#f3f3f2] p-3 text-center transition hover:-translate-y-0.5 hover:bg-[#ececea]">
                            <span class="flex size-10 items-center justify-center rounded-2xl bg-[#737985] text-white shadow-sm"><ShortcutIcon class="size-5" /></span>
                            <span class="mt-2 text-xs font-semibold leading-tight text-ink-muted group-hover/item:text-ink">{shortcut.label}</span>
                          </a>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Catalogue links for dashboard domain -->
                {#each allDomainLinks as link (link.href)}
                  <a
                    href={link.href}
                    class="group flex w-24 flex-col items-center text-center outline-none"
                    aria-label={link.label}
                  >
                    <span
                      class="relative flex size-14 items-center justify-center rounded-2xl text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-accent"
                      style={`background: ${universe.accent}`}
                    >
                      <Icon class="size-7" strokeWidth={2.15} />
                    </span>
                    <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{link.label}</span>
                  </a>
                {/each}
              </div>
            </div>
          {:else}
            <!-- Regular business/platform domain -->
            <div>
              <div class="mb-5 flex items-center gap-3">
                <div
                  class="grid size-8 place-items-center rounded-xl text-white shadow-sm"
                  style={`background: ${universe.accent}`}
                >
                  <Icon class="size-4" />
                </div>
                <h2 class="text-sm font-semibold text-ink">{domain.label}</h2>
              </div>
              <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
                {#each allDomainLinks as link (link.href)}
                  <a
                    href={link.href}
                    class="group flex w-24 flex-col items-center text-center outline-none"
                    aria-label={link.label}
                  >
                    <span
                      class="relative flex size-14 items-center justify-center rounded-2xl text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-accent"
                      style={`background: ${universe.accent}`}
                    >
                      <Icon class="size-7" strokeWidth={2.15} />
                    </span>
                    <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{link.label}</span>
                  </a>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</section>
