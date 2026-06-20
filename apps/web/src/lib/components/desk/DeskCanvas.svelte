<script lang="ts" module>
  export type { DeskAddPick } from './AddLinkPicker.svelte';
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';
  import type { NavDomain } from '$lib/modules/navigation';
  import {
    FRAMEWORK_FOLDER_ID,
    DESK_CANVAS_W,
    defaultPosition,
    TILE_SIZES,
    DESK_GRADIENTS,
    deskBackgroundIsDark,
  } from '@pulsar/shared';
  import type { DeskLayout, DeskItem, DeskFolderChild, DeskTileSize } from '@pulsar/shared';
  import { fetchDocumentObjectUrl } from '$lib/api/files';
  import { toast } from '$lib/stores/toast';
  import DeskIcon from './DeskIcon.svelte';
  import DeskFolderTile from './DeskFolderTile.svelte';
  import FolderOverlay from './FolderOverlay.svelte';
  import AddLinkPicker, { type DeskAddPick } from './AddLinkPicker.svelte';
  import DeskContextMenu from './DeskContextMenu.svelte';
  import { Link, LayoutDashboard, Plus } from 'lucide-svelte';
  import { freeDrag } from '$lib/actions/dnd';

  let {
    layout = $bindable(),
    domains = [] as NavDomain[],
    editing = false,
    search = '',
    minHeight = '70vh',
    framed = false,
    header = undefined,
    onchange = undefined as (() => void) | undefined,
  } = $props<{
    layout: DeskLayout;
    domains?: NavDomain[];
    editing?: boolean;
    search?: string;
    minHeight?: string;
    framed?: boolean;
    header?: import('svelte').Snippet;
    onchange?: () => void;
  }>();

  function commit() {
    onchange?.();
  }

  const linkIcon = (href: string) => (href === '/dashboard' ? LayoutDashboard : Link);
  const linkAccent = (href: string) =>
    href === '/dashboard' ? (MODULE_UNIVERSES['dashboard']?.accent ?? '#6f7480') : '#6f7480';

  const tilePx = $derived(TILE_SIZES[(layout.tileSize ?? 'md') as DeskTileSize]);
  const bgIsDark = $derived(deskBackgroundIsDark(layout.background));

  // ── Background image blob ────────────────────────────────────────────────
  let bgImageUrl = $state<string | null>(null);
  let bgImageForId: string | null = null;
  const bgStyle = $derived.by(() => {
    const bg = layout.background;
    if (!bg) return 'background:#f8f8f7';
    if (bg.type === 'color') return `background:${bg.value}`;
    if (bg.type === 'gradient') {
      const g = DESK_GRADIENTS.find((x) => x.id === bg.value);
      return g ? `background:${g.css}` : 'background:#f8f8f7';
    }
    if (bg.type === 'image' && bgImageUrl)
      return `background-image:url('${bgImageUrl}');background-size:cover;background-position:center`;
    return 'background:#f8f8f7';
  });
  $effect(() => {
    const bg = layout.background;
    if (bg?.type === 'image') {
      if (bg.value !== bgImageForId) {
        bgImageForId = bg.value;
        void fetchDocumentObjectUrl(bg.value)
          .then((url) => {
            if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
            bgImageUrl = url;
          })
          .catch(() => { bgImageUrl = null; toast.error("Impossible de charger l'image de fond"); });
      }
    } else if (bgImageUrl) {
      URL.revokeObjectURL(bgImageUrl);
      bgImageUrl = null;
      bgImageForId = null;
    }
  });
  onDestroy(() => { if (bgImageUrl) URL.revokeObjectURL(bgImageUrl); });

  // ── Identity helpers ─────────────────────────────────────────────────────
  function deskId(item: DeskItem): string {
    if (item.type === 'folder') return `folder:${item.id}`;
    if (item.type === 'module') return `module:${item.moduleKey}`;
    return `link:${item.href}`;
  }
  function itemById(id: string): DeskItem | undefined {
    return layout.items.find((it: DeskItem) => deskId(it) === id);
  }
  function domainByKey(key: string): NavDomain | null {
    return (domains as NavDomain[]).find((d) => d.key === key) ?? null;
  }

  // ── Drag state ───────────────────────────────────────────────────────────
  let movingId = $state<string | null>(null);
  let movingPos = $state<{ x: number; y: number } | null>(null);
  let folderTargetId = $state<string | null>(null);
  let suppressClick = false;
  let canvasW = $state(0);
  let canvasH = $state(0);

  function onDragStart(id: string) { movingId = id; suppressClick = true; }
  function onDragMove(x: number, y: number) { movingPos = { x, y }; }
  function onFolderIntent(id: string | null) { folderTargetId = id; }
  function clampX(x: number) { const w = canvasW || DESK_CANVAS_W; return Math.max(0, Math.min(x, w - tilePx)); }
  function clampY(y: number) { const h = canvasH || 600; return Math.max(0, Math.min(y, h - tilePx)); }

  function toChild(item: Extract<DeskItem, { type: 'module' | 'link' }>): DeskFolderChild {
    return item.type === 'module'
      ? { type: 'module' as const, moduleKey: item.moduleKey }
      : { type: 'link' as const, href: item.href, label: item.label, icon: item.icon };
  }

  function foldInto(dragId: string, targetId: string) {
    const dragged = itemById(dragId);
    const target = itemById(targetId);
    if (!dragged || !target) return;
    if (dragged.type === 'folder') return;
    const items = [...layout.items] as DeskItem[];
    if (target.type === 'folder') {
      const folderCopy: Extract<DeskItem, { type: 'folder' }> = {
        ...target,
        items: [...target.items, toChild(dragged as Extract<DeskItem, { type: 'module' | 'link' }>)],
      };
      layout = { ...layout, items: items.filter((it) => deskId(it) !== dragId).map((it) => (deskId(it) === targetId ? folderCopy : it)) };
    } else {
      const folder: Extract<DeskItem, { type: 'folder' }> = {
        type: 'folder',
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `folder-${Date.now()}`,
        name: 'Dossier',
        pos: target.pos,
        items: [
          toChild(target as Extract<DeskItem, { type: 'module' | 'link' }>),
          toChild(dragged as Extract<DeskItem, { type: 'module' | 'link' }>),
        ],
      };
      layout = { ...layout, items: items.filter((it) => deskId(it) !== dragId).map((it) => (deskId(it) === targetId ? folder : it)) };
    }
  }

  function reorderBefore(dragId: string, targetId: string) {
    const items = [...layout.items];
    const from = items.findIndex((it: DeskItem) => deskId(it) === dragId);
    if (from === -1) return;
    const [moved] = items.splice(from, 1);
    const insertAt = items.findIndex((it: DeskItem) => deskId(it) === targetId);
    if (insertAt === -1) { items.splice(from, 0, moved); return; }
    items.splice(insertAt, 0, moved);
    layout = { ...layout, items };
  }

  function onDragDrop(id: string, x: number, y: number, dwellId: string | null, overId: string | null) {
    movingId = null; movingPos = null; folderTargetId = null;
    const dragged = itemById(id);
    if (!dragged) return;
    if (dwellId && dragged.type !== 'folder') {
      foldInto(id, dwellId);
    } else if (layout.mode === 'free') {
      layout = { ...layout, items: layout.items.map((it: DeskItem) => (deskId(it) === id ? { ...it, pos: { x: clampX(x), y: clampY(y) } } : it)) };
    } else if (layout.mode === 'reorder' && overId && overId !== id) {
      reorderBefore(id, overId);
    }
    commit();
    setTimeout(() => { suppressClick = false; }, 0);
  }

  function removeItem(item: DeskItem) {
    layout = { ...layout, items: layout.items.filter((it: DeskItem) => it !== item) };
    commit();
  }

  // ── Add / restore picker ─────────────────────────────────────────────────
  let addLinkOpen = $state(false);
  const presentModuleKeys = $derived.by(() => {
    const keys = new Set<string>();
    for (const it of layout.items as DeskItem[]) {
      if (it.type === 'module') keys.add(it.moduleKey);
      else if (it.type === 'folder') for (const c of it.items) if (c.type === 'module') keys.add(c.moduleKey);
    }
    return [...keys];
  });
  const presentLinkHrefs = $derived.by(() => {
    const hrefs = new Set<string>();
    for (const it of layout.items as DeskItem[]) {
      if (it.type === 'link') hrefs.add(it.href);
      else if (it.type === 'folder') for (const c of it.items) if (c.type === 'link') hrefs.add(c.href);
    }
    return [...hrefs];
  });
  // When set, the next pick from the AddLinkPicker drops INTO this folder instead
  // of the top level.
  let addTargetFolderId = $state<string | null>(null);
  function openAddPicker(folderId: string | null = null) {
    addTargetFolderId = folderId;
    addLinkOpen = true;
  }

  function addToDesk(pick: DeskAddPick) {
    if (addTargetFolderId) {
      const folderId = addTargetFolderId;
      addTargetFolderId = null;
      const child: DeskFolderChild =
        pick.kind === 'module'
          ? { type: 'module', moduleKey: pick.moduleKey }
          : { type: 'link', href: pick.href, label: pick.label };
      layout = {
        ...layout,
        items: layout.items.map((it: DeskItem) =>
          it.type === 'folder' && it.id === folderId ? { ...it, items: [...it.items, child] } : it,
        ),
      };
      commit();
      return;
    }
    const pos = defaultPosition(layout.items.length);
    const item: DeskItem =
      pick.kind === 'module'
        ? { type: 'module', moduleKey: pick.moduleKey, pos }
        : { type: 'link', href: pick.href, label: pick.label, pos };
    layout = { ...layout, items: [...layout.items, item] };
    commit();
  }

  // Pull a child out of a folder and drop it back onto the desk (top level).
  function removeFromFolder(folderId: string, index: number) {
    const folder = layout.items.find(
      (it: DeskItem): it is Extract<DeskItem, { type: 'folder' }> =>
        it.type === 'folder' && it.id === folderId,
    );
    if (!folder) return;
    const child = folder.items[index];
    if (!child) return;
    const remaining = folder.items.filter((_c: DeskFolderChild, i: number) => i !== index);
    const restored: DeskItem =
      child.type === 'module'
        ? { type: 'module', moduleKey: child.moduleKey, pos: defaultPosition(layout.items.length) }
        : { type: 'link', href: child.href, label: child.label, icon: child.icon, pos: defaultPosition(layout.items.length) };
    layout = {
      ...layout,
      items: [
        ...layout.items.map((it: DeskItem) =>
          it.type === 'folder' && it.id === folderId ? { ...it, items: remaining } : it,
        ),
        restored,
      ],
    };
    commit();
  }

  // ── Rename ───────────────────────────────────────────────────────────────
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
    const updated: DeskItem = item.type === 'folder' ? { ...item, name: val } : { ...item, label: val };
    layout = { ...layout, items: layout.items.map((it: DeskItem) => (it === item ? updated : it)) };
    renamingItem = null;
    commit();
  }
  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { renamingItem = null; }
  }
  function focusOnMount(node: HTMLElement) { node.focus(); }

  function makeEmptyFolder() {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `folder-${Date.now()}`;
    layout = { ...layout, items: [...layout.items, { type: 'folder' as const, id, name: 'Dossier', items: [], pos: defaultPosition(layout.items.length) }] };
    commit();
  }

  // ── Context menu ─────────────────────────────────────────────────────────
  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuActions = $state<{ label: string; run: () => void }[]>([]);
  function openMenu(e: MouseEvent, item: DeskItem) {
    if (!editing) return;
    e.preventDefault();
    menuX = e.clientX; menuY = e.clientY;
    const common = [
      { label: 'Nouveau dossier', run: () => makeEmptyFolder() },
      { label: 'Ajouter au bureau', run: () => openAddPicker() },
    ];
    if (item.type === 'module') menuActions = [...common, { label: 'Retirer', run: () => removeItem(item) }];
    else menuActions = [...common, { label: 'Renommer', run: () => startRename(item) }, { label: 'Retirer', run: () => removeItem(item) }];
    menuOpen = true;
  }
  function openCanvasMenu(e: MouseEvent) {
    if (!editing) return;
    if ((e.target as HTMLElement)?.closest('[data-desk-id]')) return;
    e.preventDefault();
    menuX = e.clientX; menuY = e.clientY;
    menuActions = [
      { label: 'Nouveau dossier', run: () => makeEmptyFolder() },
      { label: 'Ajouter au bureau', run: () => openAddPicker() },
    ];
    menuOpen = true;
  }

  // ── Folder overlay ───────────────────────────────────────────────────────
  let openFolderId = $state<string | null>(null);
  let folderIsOpen = $state(false);
  const openFolder = $derived(
    layout.items.find((i: DeskItem): i is Extract<DeskItem, { type: 'folder' }> => i.type === 'folder' && i.id === openFolderId) ?? null,
  );
  function openFolderById(id: string) { openFolderId = id; folderIsOpen = true; }
  function closeFolder() { folderIsOpen = false; openFolderId = null; }

  // ── Search ───────────────────────────────────────────────────────────────
  const term = $derived(search.trim().toLowerCase());
  function itemMatchesSearch(item: DeskItem): boolean {
    if (term === '') return true;
    if (item.type === 'module') { const d = domainByKey(item.moduleKey); return (d?.label ?? item.moduleKey).toLowerCase().includes(term); }
    if (item.type === 'link') return item.label.toLowerCase().includes(term);
    if (item.type === 'folder') {
      if (item.name.toLowerCase().includes(term)) return true;
      return item.items.some((child) => {
        if (child.type === 'module') { const d = domainByKey(child.moduleKey); return (d?.label ?? child.moduleKey).toLowerCase().includes(term); }
        return child.label.toLowerCase().includes(term);
      });
    }
    return false;
  }
  const visibleItems = $derived(layout.items.filter(itemMatchesSearch));
</script>

{#snippet tile(item: DeskItem)}
  {#if item.type === 'module'}
    {@const domain = domainByKey(item.moduleKey)}
    {#if domain}
      {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES['dashboard']}
      <DeskIcon label={domain.label} icon={domain.icon} accent={universe.accent} {editing} size={tilePx} onDark={bgIsDark}
        onactivate={() => { if (!suppressClick && !editing) goto(domain.home); }}
        onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
    {/if}
  {:else if item.type === 'link'}
    <DeskIcon label={renamingItem === item ? renameValue : item.label} icon={linkIcon(item.href)} accent={linkAccent(item.href)} {editing} size={tilePx} onDark={bgIsDark}
      onactivate={() => { if (!suppressClick && !editing) goto(item.href); }}
      onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
    {#if renamingItem === item}<input class="mt-1 w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-xs text-ink focus:outline-none" bind:value={renameValue} onblur={commitRename} onkeydown={onRenameKeydown} use:focusOnMount />{/if}
  {:else if item.type === 'folder'}
    <div class="group relative">
      <DeskFolderTile name={renamingItem === item ? renameValue : item.name} {editing} size={tilePx} onDark={bgIsDark}
        onopen={() => { if (!suppressClick) openFolderById(item.id); }}
        onremove={() => removeItem(item)} oncontext={(e) => openMenu(e, item)} />
      {#if item.id === FRAMEWORK_FOLDER_ID && !editing}
        <div class="pointer-events-none absolute left-1/2 top-0 z-30 hidden w-72 -translate-x-1/2 -translate-y-[calc(100%+0.75rem)] rounded-2xl border border-edge bg-surface p-3 text-left shadow-pop group-hover:block group-focus-within:block sm:w-80">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-[10px] font-bold tracking-[0.22em] text-ink-faint uppercase">Framework</p>
              <h2 class="mt-0.5 text-sm font-bold text-ink">Bloc système, pas une page</h2>
            </div>
            <span class="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-bold text-ink-muted">hover</span>
          </div>
          <p class="mt-2 text-xs leading-5 text-ink-muted">
            Réglages, modules, utilisateurs et automation restent dans le core Pulsar. Le bureau affiche ce bloc au survol; on ne quitte pas le desk pour un écran “Framework”.
          </p>
          <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-ink-muted">
            <span class="rounded-lg bg-surface-muted px-2 py-1.5">Réglages</span>
            <span class="rounded-lg bg-surface-muted px-2 py-1.5">Modules</span>
            <span class="rounded-lg bg-surface-muted px-2 py-1.5">Utilisateurs</span>
            <span class="rounded-lg bg-surface-muted px-2 py-1.5">Automation</span>
          </div>
        </div>
      {/if}
    </div>
    {#if renamingItem === item}<input class="mt-1 w-full rounded border border-accent bg-surface px-1 py-0.5 text-center text-xs text-ink focus:outline-none" bind:value={renameValue} onblur={commitRename} onkeydown={onRenameKeydown} use:focusOnMount />{/if}
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={`relative flex w-full flex-col overflow-hidden text-ink ${framed ? 'rounded-card ring-1 ring-edge' : ''}`}
  style={`${bgStyle}; min-height:${minHeight}`}
  oncontextmenu={openCanvasMenu}
>
  {#if layout.background?.type === 'image'}
    <div class={`pointer-events-none absolute inset-0 ${bgIsDark ? 'bg-black/30' : 'bg-surface/35'}`}></div>
  {/if}

  {#if editing}
    <div class="absolute right-3 top-3 z-10">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        onclick={() => openAddPicker()}
      >
        <Plus class="size-4" /> Ajouter
      </button>
    </div>
  {/if}

  {#if header}
    <div class="relative">{@render header()}</div>
  {/if}

  <div
    class="relative flex-1 self-center px-3 py-6"
    bind:clientWidth={canvasW}
    bind:clientHeight={canvasH}
    style={`width:min(100%, ${DESK_CANVAS_W}px); min-height:0`}
  >
    {#if term}
      <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
        {#each visibleItems as item, i (deskId(item) + '#' + i)}
          <div>{@render tile(item)}</div>
        {/each}
      </div>
    {:else if layout.mode === 'free'}
      <div class="mx-auto grid max-w-[360px] grid-cols-3 justify-items-center gap-x-4 gap-y-8 md:hidden">
        {#each layout.items as item, i (deskId(item) + '#mobile-' + i)}
          <div>{@render tile(item)}</div>
        {/each}
      </div>
      <div class="relative hidden min-h-[520px] md:block">
        {#each layout.items as item, i (deskId(item) + '#' + i)}
          {@const id = deskId(item)}
          {@const pos = (movingId === id && movingPos) ? movingPos : (item.pos ?? defaultPosition(i))}
          <div data-desk-id={id}
            class={`absolute ${folderTargetId === id ? 'ring-2 ring-accent rounded-2xl' : ''}`}
            style={`left:${pos.x}px; top:${pos.y}px; touch-action:none;${movingId === id ? ' z-index:20; pointer-events:none;' : ''}`}
            use:freeDrag={{ id, pos: item.pos ?? defaultPosition(i), enabled: editing, onstart: () => onDragStart(id), onmove: onDragMove, onfolderintent: onFolderIntent, ondrop: (x, y, d, o) => onDragDrop(id, x, y, d, o) }}>
            {@render tile(item)}
          </div>
        {/each}
      </div>
    {:else}
      <div class="flex flex-wrap justify-center gap-x-10 gap-y-11 px-2 py-4">
        {#each layout.items as item, i (deskId(item) + '#' + i)}
          {@const id = deskId(item)}
          <div data-desk-id={id}
            style={layout.mode === 'reorder' ? 'touch-action:none;' : ''}
            class={folderTargetId === id ? 'ring-2 ring-accent rounded-2xl' : ''}
            use:freeDrag={{ id, pos: { x: 0, y: 0 }, enabled: editing && layout.mode === 'reorder', onstart: () => onDragStart(id), onmove: () => {}, onfolderintent: onFolderIntent, ondrop: (x, y, d, o) => onDragDrop(id, x, y, d, o) }}>
            {@render tile(item)}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if openFolder}
  {@const folderId = openFolder.id}
  <FolderOverlay bind:open={folderIsOpen} name={openFolder.name} onclose={closeFolder}>
    {#each openFolder.items as child, ci (child.type === 'module' ? `m:${child.moduleKey}#${ci}` : `l:${child.href}#${ci}`)}
      {#if child.type === 'module'}
        {@const domain = domainByKey(child.moduleKey)}
        {#if domain}
          {@const universe = MODULE_UNIVERSES[domain.key] ?? MODULE_UNIVERSES['dashboard']}
          <DeskIcon label={domain.label} icon={domain.icon} accent={universe.accent}
            editing={editing}
            onactivate={() => { if (!editing) { closeFolder(); goto(domain.home); } }}
            onremove={editing ? () => removeFromFolder(folderId, ci) : undefined} />
        {/if}
      {:else if child.type === 'link'}
        <DeskIcon label={child.label} icon={linkIcon(child.href)} accent={linkAccent(child.href)}
          editing={editing}
          onactivate={() => { if (!editing) { closeFolder(); goto(child.href); } }}
          onremove={editing ? () => removeFromFolder(folderId, ci) : undefined} />
      {/if}
    {:else}
      <p class="col-span-full py-6 text-center text-sm text-ink-faint">
        {editing ? 'Dossier vide — utilisez « Ajouter à ce dossier ».' : 'Dossier vide.'}
      </p>
    {/each}
    {#snippet footer()}
      {#if editing}
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs text-ink-muted">× pour sortir un élément · ou glissez une tuile sur le dossier.</span>
          <button type="button"
            class="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-sm font-semibold text-white transition hover:opacity-90"
            onclick={() => openAddPicker(folderId)}>
            <Plus class="size-4" /> Ajouter à ce dossier
          </button>
        </div>
      {/if}
    {/snippet}
  </FolderOverlay>
{/if}

<!-- Rendered last so the picker/menu stack above the folder overlay. -->
<AddLinkPicker bind:open={addLinkOpen} {domains} {presentModuleKeys} {presentLinkHrefs} onpick={addToDesk} />
<DeskContextMenu bind:open={menuOpen} x={menuX} y={menuY} actions={menuActions} />
