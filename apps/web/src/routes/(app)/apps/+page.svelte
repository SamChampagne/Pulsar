<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains } from '$lib/modules/navigation';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import { deskSearch } from '$lib/stores/desk';
  import { getPreferences, putDeskLayout } from '$lib/api/preferences';
  import { defaultDeskLayout, reconcileDeskLayout, FRAMEWORK_FOLDER_ID, DESK_CANVAS_W, DESK_TILE, defaultPosition, DESK_MODES } from '@pulsar/shared';
  import type { DeskLayout, DeskItem, DeskFolderChild } from '@pulsar/shared';
  import { toast } from '$lib/stores/toast';
  import DeskIcon from '$lib/components/desk/DeskIcon.svelte';
  import DeskFolderTile from '$lib/components/desk/DeskFolderTile.svelte';
  import FolderOverlay from '$lib/components/desk/FolderOverlay.svelte';
  import AddLinkPicker from '$lib/components/desk/AddLinkPicker.svelte';
  import DeskContextMenu from '$lib/components/desk/DeskContextMenu.svelte';
  import { Link } from 'lucide-svelte';
  import { freeDrag } from '$lib/actions/dnd';

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
  // Free-position drag state
  // ---------------------------------------------------------------------------
  let movingId = $state<string | null>(null);
  let movingPos = $state<{ x: number; y: number } | null>(null);
  let folderTargetId = $state<string | null>(null);
  let suppressClick = false; // set true on drag start; blocks the click right after a move

  // Measured canvas size (bound via bind:clientWidth/Height)
  let canvasW = $state(0);
  let canvasH = $state(0);

  function deskId(item: DeskItem): string {
    if (item.type === 'folder') return `folder:${item.id}`;
    if (item.type === 'module') return `module:${item.moduleKey}`;
    return `link:${item.href}`;
  }

  function itemById(id: string): DeskItem | undefined {
    return layout.items.find((it) => deskId(it) === id);
  }

  function onDragStart(id: string) {
    movingId = id;
    suppressClick = true;
  }

  function onDragMove(x: number, y: number) {
    movingPos = { x, y };
  }

  function onFolderIntent(id: string | null) {
    folderTargetId = id;
  }

  function clampX(x: number) {
    const w = canvasW || DESK_CANVAS_W;
    return Math.max(0, Math.min(x, w - DESK_TILE));
  }

  function clampY(y: number) {
    const h = canvasH || 600;
    return Math.max(0, Math.min(y, h - DESK_TILE));
  }

  function toChild(item: Extract<DeskItem, { type: 'module' | 'link' }>): DeskFolderChild {
    return item.type === 'module'
      ? { type: 'module' as const, moduleKey: item.moduleKey }
      : { type: 'link' as const, href: item.href, label: item.label, icon: item.icon };
  }

  function foldInto(dragId: string, targetId: string) {
    const dragged = itemById(dragId);
    const target = itemById(targetId);
    if (!dragged || !target) return;
    // Folders are not folded into other items — caller already guards this
    if (dragged.type === 'folder') return;

    const items = [...layout.items] as DeskItem[];

    if (target.type === 'folder') {
      // Append into existing folder
      const folderCopy: Extract<DeskItem, { type: 'folder' }> = {
        ...target,
        items: [...target.items, toChild(dragged as Extract<DeskItem, { type: 'module' | 'link' }>)],
      };
      layout = {
        ...layout,
        items: items
          .filter((it) => deskId(it) !== dragId)
          .map((it) => (deskId(it) === targetId ? folderCopy : it)),
      };
    } else {
      // Create new folder in place of the target
      const folder: Extract<DeskItem, { type: 'folder' }> = {
        type: 'folder',
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `folder-${Date.now()}`,
        name: 'Dossier',
        pos: target.pos,
        items: [
          toChild(target as Extract<DeskItem, { type: 'module' | 'link' }>),
          toChild(dragged as Extract<DeskItem, { type: 'module' | 'link' }>),
        ],
      };
      layout = {
        ...layout,
        items: items
          .filter((it) => deskId(it) !== dragId)
          .map((it) => (deskId(it) === targetId ? folder : it)),
      };
    }
  }

  function reorderBefore(dragId: string, targetId: string) {
    const items = [...layout.items];
    const from = items.findIndex((it) => deskId(it) === dragId);
    if (from === -1) return;
    const [moved] = items.splice(from, 1);
    const insertAt = items.findIndex((it) => deskId(it) === targetId);
    if (insertAt === -1) { items.splice(from, 0, moved); return; } // safety: put back
    items.splice(insertAt, 0, moved);
    layout = { ...layout, items };
  }

  function onDragDrop(id: string, x: number, y: number, dwellId: string | null, overId: string | null) {
    movingId = null;
    movingPos = null;
    folderTargetId = null;
    const dragged = itemById(id);
    if (!dragged) return;
    if (dwellId && dragged.type !== 'folder') {
      foldInto(id, dwellId);
    } else if (layout.mode === 'free') {
      layout = { ...layout, items: layout.items.map((it) => (deskId(it) === id ? { ...it, pos: { x: clampX(x), y: clampY(y) } } : it)) };
    } else if (layout.mode === 'reorder' && overId && overId !== id) {
      reorderBefore(id, overId);
    }
    persist();
    setTimeout(() => { suppressClick = false; }, 0);
  }

  function removeItem(item: DeskItem) {
    layout = { ...layout, items: layout.items.filter((it) => it !== item) };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Add-link picker
  // ---------------------------------------------------------------------------
  let addLinkOpen = $state(false);

  function addQuickLink(l: { href: string; label: string }) {
    layout = {
      ...layout,
      items: [
        ...layout.items,
        { type: 'link' as const, href: l.href, label: l.label, pos: defaultPosition(layout.items.length) },
      ],
    };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Rename
  // ---------------------------------------------------------------------------
  let renamingItem = $state<DeskItem | null>(null);
  let renameValue = $state('');

  function startRename(item: DeskItem) {
    if (item.type === 'module') return;
    renameValue = item.type === 'folder' ? item.name : item.label;
    renamingItem = item;
  }

  function commitRename() {
    const item = renamingItem;
    if (!item || item.type === 'module') { renamingItem = null; return; }
    const val = renameValue.trim() || (item.type === 'folder' ? item.name : item.label);
    const updated: DeskItem =
      item.type === 'folder' ? { ...item, name: val } : { ...item, label: val };
    layout = { ...layout, items: layout.items.map((it) => (it === item ? updated : it)) };
    renamingItem = null;
    persist();
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { renamingItem = null; }
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
    layout = { ...layout, items: [...layout.items, { type: 'folder' as const, id, name: 'Dossier', items: [], pos: defaultPosition(layout.items.length) }] };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------
  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuActions = $state<{ label: string; run: () => void }[]>([]);

  function openMenu(e: MouseEvent, item: DeskItem) {
    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;

    const common = [
      { label: 'Nouveau dossier', run: () => makeEmptyFolder() },
      { label: 'Ajouter un lien rapide', run: () => (addLinkOpen = true) },
    ];

    if (item.type === 'module') {
      menuActions = [...common, { label: 'Retirer', run: () => removeItem(item) }];
    } else {
      // link or folder — both renamable + removable
      menuActions = [
        ...common,
        { label: 'Renommer', run: () => startRename(item) },
        { label: 'Retirer', run: () => removeItem(item) },
      ];
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
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

{#snippet tile(item: DeskItem)}
  {#if item.type === 'module'}
    {@const domain = domainByKey(item.moduleKey)}
    {#if domain}
      {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES['dashboard']}
      <DeskIcon label={domain.label} icon={domain.icon} accent={universe.accent} {editing}
        onactivate={() => { if (!suppressClick && !editing) goto(domain.home); }}
        onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
    {/if}
  {:else if item.type === 'link'}
    <DeskIcon label={renamingItem === item ? renameValue : item.label} icon={Link} accent="#6f7480" {editing}
      onactivate={() => { if (!suppressClick && !editing) goto(item.href); }}
      onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
    {#if renamingItem === item}<input class="mt-1 w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-xs text-ink focus:outline-none" bind:value={renameValue} onblur={commitRename} onkeydown={onRenameKeydown} use:focusOnMount />{/if}
  {:else if item.type === 'folder'}
    <DeskFolderTile name={renamingItem === item ? renameValue : item.name} {editing}
      onopen={() => { if (!suppressClick && !editing) openFolderById(item.id); }}
      onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
    {#if renamingItem === item}<input class="mt-1 w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-xs text-ink focus:outline-none" bind:value={renameValue} onblur={commitRename} onkeydown={onRenameKeydown} use:focusOnMount />{/if}
  {/if}
{/snippet}

<section class="min-h-[calc(100vh-3.5rem)] bg-[#f8f8f7] px-4 py-14 text-ink sm:px-8 lg:px-12">
  <!-- Header -->
  <div class="mb-8 flex items-center justify-center gap-3">
    <div class="text-center">
      <p class="text-xs font-semibold tracking-[0.26em] text-ink-faint uppercase">Pulsar Desk</p>
      <h1 class="mt-2 text-xl font-semibold tracking-tight text-ink">Toutes les pages</h1>
    </div>
    {#if loaded}
      <div class="absolute right-4 flex items-center gap-2 sm:right-8 lg:right-12">
        {#if editing}
          <button
            type="button"
            class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink"
            onclick={() => (addLinkOpen = true)}
          >
            + Ajouter un lien
          </button>
          <div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
            {#each DESK_MODES as m (m)}
              <button type="button"
                class={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${layout.mode === m ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
                onclick={() => { layout = { ...layout, mode: m }; persist(); }}
              >{m === 'auto' ? 'Grille auto' : m === 'free' ? 'Libre' : 'Réordonnable'}</button>
            {/each}
          </div>
        {/if}
        <button
          type="button"
          class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink"
          onclick={() => editing ? exitEditMode() : enterEditMode()}
        >
          {editing ? 'OK' : 'Personnaliser'}
        </button>
      </div>
    {/if}
  </div>

  {#if !loaded}
    <div class="flex justify-center py-20">
      <span class="text-sm text-ink-faint">Chargement…</span>
    </div>
  {:else if search && visibleItems.length === 0}
    <p class="text-center text-sm text-ink-faint">
      {`Aucune page ne correspond à « ${$deskSearch} ».`}
    </p>
  {:else if !search && layout.items.length === 0}
    <p class="text-center text-sm text-ink-faint">Aucune page disponible.</p>
  {:else}
    <div class="relative w-full" bind:clientWidth={canvasW} bind:clientHeight={canvasH} style="min-height: calc(100vh - 7rem)">
      {#if search}
        <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
          {#each visibleItems as item, i (deskId(item) + '#' + i)}
            <div>{@render tile(item)}</div>
          {/each}
        </div>
      {:else if layout.mode === 'free'}
        {#each layout.items as item, i (deskId(item) + '#' + i)}
          {@const id = deskId(item)}
          {@const pos = (movingId === id && movingPos) ? movingPos : (item.pos ?? defaultPosition(i))}
          <div data-desk-id={id}
            class={`absolute ${folderTargetId === id ? 'ring-2 ring-accent rounded-2xl' : ''}`}
            style={`left:${pos.x}px; top:${pos.y}px; touch-action:none;${movingId === id ? ' z-index:20; pointer-events:none;' : ''}`}
            use:freeDrag={{ id, pos: item.pos ?? defaultPosition(i), enabled: true, onstart: () => onDragStart(id), onmove: onDragMove, onfolderintent: onFolderIntent, ondrop: (x, y, d, o) => onDragDrop(id, x, y, d, o) }}>
            {@render tile(item)}
          </div>
        {/each}
      {:else}
        <!-- auto + reorder: flowing grid -->
        <div class="flex flex-wrap gap-x-10 gap-y-11 px-2 py-4">
          {#each layout.items as item, i (deskId(item) + '#' + i)}
            {@const id = deskId(item)}
            <div data-desk-id={id}
              style={layout.mode === 'reorder' ? 'touch-action:none;' : ''}
              class={folderTargetId === id ? 'ring-2 ring-accent rounded-2xl' : ''}
              use:freeDrag={{ id, pos: { x: 0, y: 0 }, enabled: layout.mode === 'reorder', onstart: () => onDragStart(id), onmove: () => {}, onfolderintent: onFolderIntent, ondrop: (x, y, d, o) => onDragDrop(id, x, y, d, o) }}>
              {@render tile(item)}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<!-- Add-link picker (single instance) -->
<AddLinkPicker bind:open={addLinkOpen} {domains} onpick={addQuickLink} />

<!-- Context menu (single instance) -->
<DeskContextMenu bind:open={menuOpen} x={menuX} y={menuY} actions={menuActions} />

<!-- Folder overlay (single instance, driven by openFolderId) -->
{#if openFolder}
  <FolderOverlay bind:open={folderIsOpen} name={openFolder.name} onclose={closeFolder}>
    {#each openFolder.items as child, ci (child.type === 'module' ? `m:${child.moduleKey}#${ci}` : `l:${child.href}#${ci}`)}
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
