<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains } from '$lib/modules/navigation';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import { deskSearch } from '$lib/stores/desk';
  import { getPreferences, putDeskLayout } from '$lib/api/preferences';
  import { defaultDeskLayout, reconcileDeskLayout, FRAMEWORK_FOLDER_ID } from '@pulsar/shared';
  import type { DeskLayout, DeskItem, DeskFolderChild } from '@pulsar/shared';
  import { toast } from '$lib/stores/toast';
  import DeskIcon from '$lib/components/desk/DeskIcon.svelte';
  import DeskFolderTile from '$lib/components/desk/DeskFolderTile.svelte';
  import FolderOverlay from '$lib/components/desk/FolderOverlay.svelte';
  import AddLinkPicker from '$lib/components/desk/AddLinkPicker.svelte';
  import DeskContextMenu from '$lib/components/desk/DeskContextMenu.svelte';
  import { Link } from 'lucide-svelte';
  import { gridDrag } from '$lib/actions/dnd';

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

  // ---------------------------------------------------------------------------
  // Edit mode
  // ---------------------------------------------------------------------------
  let editing = $state(false);

  // ---------------------------------------------------------------------------
  // Persistence — debounced PUT, flushed on unmount
  // ---------------------------------------------------------------------------
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function persist() {
    if (!loaded) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void putDeskLayout(layout).catch(() => toast.error('Échec de la sauvegarde du bureau'));
    }, 500);
  }

  onDestroy(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      void putDeskLayout(layout).catch(() => {});
    }
  });

  function enterEditMode() {
    deskSearch.set('');
    editing = true;
  }

  function exitEditMode() {
    editing = false;
    persist();
  }

  // ---------------------------------------------------------------------------
  // Drag state
  // ---------------------------------------------------------------------------
  let dragIndex = $state<number | null>(null);
  let hoverIndex = $state<number | null>(null);
  /** Index of the tile currently showing the "folder-intent" dwell highlight. */
  let folderTargetIndex = $state<number | null>(null);

  function onpick(i: number) {
    dragIndex = i;
    hoverIndex = null;
    folderTargetIndex = null;
  }

  function onhover(over: number | null, folderIntent: boolean) {
    hoverIndex = over;
    folderTargetIndex = folderIntent ? over : null;
  }

  function toChild(item: Extract<DeskItem, { type: 'module' | 'link' }>): DeskFolderChild {
    return item.type === 'module'
      ? { type: 'module' as const, moduleKey: item.moduleKey }
      : { type: 'link' as const, href: item.href, label: item.label, icon: item.icon };
  }

  function ondrop(from: number, over: number | null, folderIntent: boolean) {
    dragIndex = null;
    hoverIndex = null;
    folderTargetIndex = null;
    if (over === null || over === from) return;

    const items = [...layout.items] as DeskItem[];
    const dragged = items[from];
    const target = items[over];
    if (!dragged || !target) return;

    if (folderIntent && dragged.type !== 'folder' && target.type !== 'folder') {
      // Dwell on module/link → create a folder
      const folder: Extract<DeskItem, { type: 'folder' }> = {
        type: 'folder',
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `folder-${items.length}-${over}`,
        name: 'Dossier',
        items: [toChild(target as Extract<DeskItem, { type: 'module' | 'link' }>), toChild(dragged as Extract<DeskItem, { type: 'module' | 'link' }>)],
      };
      items.splice(from, 1);
      const targetIdxAfter = from < over ? over - 1 : over;
      items.splice(targetIdxAfter, 1, folder);
      layout = { ...layout, items };
    } else if (folderIntent && target.type === 'folder' && dragged.type !== 'folder') {
      // Dwell on an existing folder → append into it
      const folderCopy: Extract<DeskItem, { type: 'folder' }> = {
        ...target,
        items: [...target.items, toChild(dragged as Extract<DeskItem, { type: 'module' | 'link' }>)],
      };
      items.splice(from, 1);
      const targetIdxAfter = from < over ? over - 1 : over;
      items.splice(targetIdxAfter, 1, folderCopy);
      layout = { ...layout, items };
    } else {
      // Default: plain reorder (no dwell, or folder-to-folder)
      items.splice(over, 0, items.splice(from, 1)[0] as DeskItem);
      layout = { ...layout, items };
    }
    persist();
  }

  function removeItem(i: number) {
    layout = { ...layout, items: layout.items.filter((_, idx) => idx !== i) };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Add-link picker
  // ---------------------------------------------------------------------------
  let addLinkOpen = $state(false);

  function addQuickLink(l: { href: string; label: string }) {
    layout = { ...layout, items: [...layout.items, { type: 'link' as const, href: l.href, label: l.label }] };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Rename
  // ---------------------------------------------------------------------------
  let renamingIndex = $state<number | null>(null);
  let renameValue = $state('');

  function startRename(i: number) {
    const item = layout.items[i];
    if (!item || item.type === 'module') return;
    renameValue = item.type === 'folder' ? item.name : item.label;
    renamingIndex = i;
  }

  function commitRename() {
    if (renamingIndex === null) return;
    const item = layout.items[renamingIndex];
    if (!item || item.type === 'module') { renamingIndex = null; return; }
    const val = renameValue.trim() || (item.type === 'folder' ? item.name : item.label);
    const updated = item.type === 'folder'
      ? { ...item, name: val }
      : { ...item, label: val };
    const items = [...layout.items] as DeskItem[];
    items[renamingIndex] = updated;
    layout = { ...layout, items };
    renamingIndex = null;
    persist();
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { renamingIndex = null; }
  }

  /** Svelte action: focuses the element on mount (avoids the a11y_autofocus warning). */
  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  // ---------------------------------------------------------------------------
  // Make empty folder
  // ---------------------------------------------------------------------------
  function makeEmptyFolder() {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `folder-${Date.now()}`;
    layout = { ...layout, items: [...layout.items, { type: 'folder' as const, id, name: 'Dossier', items: [] }] };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------
  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuActions = $state<{ label: string; run: () => void }[]>([]);

  function openMenu(e: MouseEvent, i: number, item: DeskItem) {
    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;

    const common = [
      { label: 'Nouveau dossier', run: () => makeEmptyFolder() },
      { label: 'Ajouter un lien rapide', run: () => (addLinkOpen = true) },
    ];

    if (item.type === 'module') {
      menuActions = [...common, { label: 'Retirer', run: () => removeItem(i) }];
    } else if (item.type === 'link') {
      menuActions = [...common, { label: 'Renommer', run: () => startRename(i) }, { label: 'Retirer', run: () => removeItem(i) }];
    } else {
      // folder
      menuActions = [...common, { label: 'Renommer', run: () => startRename(i) }, { label: 'Retirer', run: () => removeItem(i) }];
    }
    menuOpen = true;
  }

  // ---------------------------------------------------------------------------
  // Folder overlay
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Find domain by moduleKey */
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

  // In edit mode render the full layout (indices must align with drag positions).
  // In normal mode render the search-filtered list.
  const renderItems = $derived(editing ? layout.items : visibleItems);

  // Stable key for each item (used in {#each} key expression)
  function itemKey(item: DeskItem): string {
    if (item.type === 'folder') return `folder:${item.id}`;
    if (item.type === 'module') return `module:${item.moduleKey}`;
    return `link:${item.href}`;
  }
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

<section class="min-h-[calc(100vh-3.5rem)] bg-[#f8f8f7] px-4 py-14 text-ink sm:px-8 lg:px-12">
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="mb-8 flex items-center justify-center gap-3">
      <div class="text-center">
        <p class="text-xs font-semibold tracking-[0.26em] text-ink-faint uppercase">Pulsar Desk</p>
        <h1 class="mt-2 text-xl font-semibold tracking-tight text-ink">Toutes les pages</h1>
      </div>
      {#if loaded}
        <button
          type="button"
          class="absolute right-4 rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink sm:right-8 lg:right-12"
          onclick={() => editing ? exitEditMode() : enterEditMode()}
        >
          {editing ? 'OK' : 'Personnaliser'}
        </button>
      {/if}
    </div>

    {#if !loaded}
      <div class="flex justify-center py-20">
        <span class="text-sm text-ink-faint">Chargement…</span>
      </div>
    {:else if renderItems.length === 0}
      <p class="text-center text-sm text-ink-faint">
        {search ? `Aucune page ne correspond à « ${$deskSearch} ».` : 'Aucune page disponible.'}
      </p>
    {:else}
      <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
        {#each renderItems as item, i (itemKey(item))}
          <div
            data-desk-index={i}
            style={editing ? 'touch-action: none;' : ''}
            class={[
              editing && hoverIndex === i && dragIndex !== null && dragIndex !== i && folderTargetIndex !== i
                ? 'opacity-60 scale-95 transition-transform duration-100'
                : '',
              editing && folderTargetIndex === i && dragIndex !== null
                ? 'ring-2 ring-accent scale-105 transition-transform duration-100'
                : '',
            ].filter(Boolean).join(' ')}
            use:gridDrag={{ index: i, enabled: editing, onpick, onhover, ondrop }}
          >
            {#if item.type === 'module'}
              {@const domain = domainByKey(item.moduleKey)}
              {#if domain}
                {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES['dashboard']}
                <DeskIcon
                  label={domain.label}
                  icon={domain.icon}
                  accent={universe.accent}
                  {editing}
                  onactivate={() => { if (!editing) goto(domain.home); }}
                  onremove={() => removeItem(i)}
                  oncontext={(e) => openMenu(e, i, item)}
                />
              {/if}
            {:else if item.type === 'link'}
              <div class="flex w-24 flex-col items-center text-center">
                <DeskIcon
                  label={renamingIndex === i ? renameValue : item.label}
                  icon={Link}
                  accent="#6f7480"
                  {editing}
                  onactivate={() => { if (!editing) goto(item.href); }}
                  onremove={() => removeItem(i)}
                  oncontext={(e) => openMenu(e, i, item)}
                />
                {#if renamingIndex === i}
                  <input
                    class="mt-1 w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-xs text-ink focus:outline-none"
                    bind:value={renameValue}
                    onblur={commitRename}
                    onkeydown={onRenameKeydown}
                    use:focusOnMount
                  />
                {/if}
              </div>
            {:else if item.type === 'folder'}
              <div class="flex w-24 flex-col items-center text-center">
                <DeskFolderTile
                  name={renamingIndex === i ? renameValue : item.name}
                  {editing}
                  onopen={() => { if (!editing) openFolderById(item.id); }}
                  onremove={() => removeItem(i)}
                  oncontext={(e) => openMenu(e, i, item)}
                />
                {#if renamingIndex === i}
                  <input
                    class="mt-1 w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-xs text-ink focus:outline-none"
                    bind:value={renameValue}
                    onblur={commitRename}
                    onkeydown={onRenameKeydown}
                    use:focusOnMount
                  />
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        {#if editing}
          <div class="flex w-24 flex-col items-center text-center">
            <button
              type="button"
              class="grid size-14 place-items-center rounded-2xl border-2 border-dashed border-edge text-ink-faint transition hover:border-accent hover:text-accent"
              onclick={() => (addLinkOpen = true)}
              aria-label="Ajouter un lien rapide"
            >
              <span class="text-2xl leading-none">+</span>
            </button>
            <span class="mt-3 text-xs text-ink-faint">Ajouter un lien</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<!-- Add-link picker (single instance) -->
<AddLinkPicker bind:open={addLinkOpen} {domains} onpick={addQuickLink} />

<!-- Context menu (single instance) -->
<DeskContextMenu bind:open={menuOpen} x={menuX} y={menuY} actions={menuActions} />

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
    {#snippet footer()}
      {#if openFolder.id === FRAMEWORK_FOLDER_ID}
        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            class="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-faint transition hover:border-accent hover:text-ink"
            onclick={() => { editing = true; closeFolder(); }}
          >
            Gérer les liens rapides
          </button>
          <button
            type="button"
            class="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-faint transition hover:border-red-400 hover:text-red-600"
            onclick={() => {
              if (confirm('Réinitialiser la disposition du bureau ?')) {
                layout = defaultDeskLayout(domains);
                persist();
                closeFolder();
              }
            }}
          >
            Réinitialiser la disposition
          </button>
        </div>
      {/if}
    {/snippet}
  </FolderOverlay>
{/if}
