<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains } from '$lib/modules/navigation';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import { deskSearch } from '$lib/stores/desk';
  import { getPreferences } from '$lib/api/preferences';
  import { defaultDeskLayout, reconcileDeskLayout } from '@pulsar/shared';
  import type { DeskLayout, DeskItem } from '@pulsar/shared';
  import DeskIcon from '$lib/components/desk/DeskIcon.svelte';
  import DeskFolderTile from '$lib/components/desk/DeskFolderTile.svelte';
  import FolderOverlay from '$lib/components/desk/FolderOverlay.svelte';
  import { Link } from 'lucide-svelte';

  // Build visible domains from auth caps — mirrors +layout.svelte exactly.
  const domains = $derived(
    visibleDomains({
      enabledModules: ($auth?.tenant.enabledModules ?? []) as string[],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    }),
  );

  let layout = $state<DeskLayout>(defaultDeskLayout([]));
  let loaded = $state(false);
  let rawSaved = $state<unknown>(undefined);
  let fetchedOnce = $state(false);

  // Fetch preferences once; re-reconcile when domains change after load.
  $effect(() => {
    if (fetchedOnce) return;
    fetchedOnce = true;
    const snap = domains; // capture current value inside the effect
    void (async () => {
      try {
        const res = await getPreferences();
        rawSaved = res.deskLayout;
        layout = reconcileDeskLayout(res.deskLayout, snap);
      } catch {
        layout = defaultDeskLayout(snap);
      } finally {
        loaded = true;
      }
    })();
  });

  // When domains settle after initial load (module toggled, perms refreshed),
  // re-reconcile without re-fetching — rawSaved may still be undefined (first fetch
  // in progress), but reconcileDeskLayout handles that gracefully.
  $effect(() => {
    if (!loaded) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    domains; // reactive dependency
    layout = reconcileDeskLayout(rawSaved, domains);
  });

  // Folder overlay
  let openFolderId = $state<string | null>(null);
  let folderIsOpen = $state(false);

  const openFolder = $derived(
    layout.items.find(
      (i): i is Extract<DeskItem, { type: 'folder' }> =>
        i.type === 'folder' && i.id === openFolderId,
    ) ?? null,
  );

  function openFolderById(id: string) {
    openFolderId = id;
    folderIsOpen = true;
  }

  function closeFolder() {
    folderIsOpen = false;
    openFolderId = null;
  }

  // Helper: find domain by moduleKey
  function domainByKey(key: string) {
    return domains.find((d) => d.key === key) ?? null;
  }

  // Search filtering
  const search = $derived($deskSearch.trim().toLowerCase());

  function itemMatchesSearch(item: DeskItem): boolean {
    if (search === '') return true;
    if (item.type === 'module') {
      const d = domainByKey(item.moduleKey);
      return (d?.label ?? item.moduleKey).toLowerCase().includes(search);
    }
    if (item.type === 'link') {
      return item.label.toLowerCase().includes(search);
    }
    // folder: matches name or any child label
    if (item.type === 'folder') {
      if (item.name.toLowerCase().includes(search)) return true;
      return item.items.some((child) => {
        if (child.type === 'module') {
          const d = domainByKey(child.moduleKey);
          return (d?.label ?? child.moduleKey).toLowerCase().includes(search);
        }
        return child.label.toLowerCase().includes(search);
      });
    }
    return false;
  }

  const visibleItems = $derived(layout.items.filter(itemMatchesSearch));
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

<section class="min-h-[calc(100vh-3.5rem)] bg-[#f8f8f7] px-4 py-14 text-ink sm:px-8 lg:px-12">
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="mb-8 text-center">
      <p class="text-xs font-semibold tracking-[0.26em] text-ink-faint uppercase">Pulsar Desk</p>
      <h1 class="mt-2 text-xl font-semibold tracking-tight text-ink">Toutes les pages</h1>
    </div>

    {#if !loaded}
      <div class="flex justify-center py-20">
        <span class="text-sm text-ink-faint">Chargement…</span>
      </div>
    {:else if visibleItems.length === 0}
      <p class="text-center text-sm text-ink-faint">
        {search ? `Aucune page ne correspond à « ${$deskSearch} ».` : 'Aucune page disponible.'}
      </p>
    {:else}
      <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
        {#each visibleItems as item (item.type === 'folder' ? item.id : item.type === 'module' ? item.moduleKey : item.href)}
          {#if item.type === 'module'}
            {@const domain = domainByKey(item.moduleKey)}
            {#if domain}
              {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES['dashboard']}
              <DeskIcon
                label={domain.label}
                icon={domain.icon}
                accent={universe.accent}
                onactivate={() => goto(domain.home)}
              />
            {/if}
          {:else if item.type === 'link'}
            <DeskIcon
              label={item.label}
              icon={Link}
              accent="#6f7480"
              onactivate={() => goto(item.href)}
            />
          {:else if item.type === 'folder'}
            <DeskFolderTile
              name={item.name}
              onopen={() => openFolderById(item.id)}
            />
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</section>

<!-- Folder overlay (single instance, driven by openFolderId) -->
{#if openFolder}
  <FolderOverlay bind:open={folderIsOpen} name={openFolder.name} onclose={closeFolder}>
    {#each openFolder.items as child (child.type === 'module' ? child.moduleKey : child.href)}
      {#if child.type === 'module'}
        {@const domain = domainByKey(child.moduleKey)}
        {#if domain}
          {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES['dashboard']}
          <DeskIcon
            label={domain.label}
            icon={domain.icon}
            accent={universe.accent}
            onactivate={() => { closeFolder(); goto(domain.home); }}
          />
        {/if}
      {:else if child.type === 'link'}
        <DeskIcon
          label={child.label}
          icon={Link}
          accent="#6f7480"
          onactivate={() => { closeFolder(); goto(child.href); }}
        />
      {/if}
    {/each}
  </FolderOverlay>
{/if}
