<script lang="ts" generics="Row extends { id: string }">
  import type { Snippet } from 'svelte';
  import { browser } from '$app/environment';
  import { auth } from '$lib/stores/auth';
  import { density } from '$lib/stores/density';
  import { normalizeTableView, columnWidth, type ViewColumn, type TableView } from './table-view';
  let {
    viewKey,
    columns,
    rows,
    cell,
  }: { viewKey: string; columns: ViewColumn[]; rows: Row[]; cell: Snippet<[Row, string]> } =
    $props();
  let view = $state<TableView>({ hidden: [], widths: {} });
  let storageError = $state('');
  const storageKey = $derived(`pulsar.table.v1:${$auth?.tenant.id}:${$auth?.user.id}:${viewKey}`);
  const visible = $derived(columns.filter((c) => !view.hidden.includes(c.key)));
  $effect(() => {
    const key = storageKey,
      schema = columns;
    let saved: unknown = null;
    storageError = '';
    if (browser)
      try {
        saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      } catch {
        /* damaged or unavailable storage uses defaults */
      }
    view = normalizeTableView(saved, schema);
  });
  function persist(next: TableView) {
    view = normalizeTableView(next, columns);
    if (browser)
      try {
        localStorage.setItem(storageKey, JSON.stringify(view));
        storageError = '';
      } catch {
        storageError = 'Réglages appliqués, mais non conservés par ce navigateur.';
      }
  }
  function resize(key: string, width: number) {
    persist({ ...view, widths: { ...view.widths, [key]: columnWidth(width) } });
  }
  let drag: { key: string; x: number; width: number; pointer: number } | null = null;
  function start(e: PointerEvent, key: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { key, x: e.clientX, width: view.widths[key] ?? 180, pointer: e.pointerId };
  }
  function move(e: PointerEvent) {
    if (drag?.pointer !== e.pointerId) return;
    view = {
      ...view,
      widths: { ...view.widths, [drag.key]: columnWidth(drag.width + e.clientX - drag.x) },
    };
  }
  function end(e: PointerEvent) {
    if (drag?.pointer !== e.pointerId) return;
    drag = null;
    persist(view);
  }
</script>

<details class="mb-3 rounded-lg border border-edge bg-surface p-3">
  <summary class="cursor-pointer text-sm font-medium">Colonnes et largeur</summary>
  <p class="my-3 text-xs text-ink-muted">
    Votre vue sur cet appareil, par compte et entreprise. Aucun champ ni droit d’accès n’est
    modifié. Glissez une séparation ou utilisez les flèches du clavier.
  </p>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {#each columns as c (c.key)}<div class="flex items-center gap-3">
        <label class="flex min-w-0 flex-1 items-center gap-2 text-xs"
          ><input
            type="checkbox"
            checked={!view.hidden.includes(c.key)}
            disabled={c.required}
            onchange={(e) =>
              persist({
                ...view,
                hidden: e.currentTarget.checked
                  ? view.hidden.filter((k) => k !== c.key)
                  : [...view.hidden, c.key],
              })}
          />{c.label}</label
        >
        <input
          type="range"
          min="100"
          max="640"
          step="10"
          class="w-24 accent-accent"
          aria-label={`Largeur ${c.label}`}
          value={view.widths[c.key] ?? c.width ?? 180}
          oninput={(e) => resize(c.key, +e.currentTarget.value)}
        />
      </div>{/each}
  </div>
  <button
    type="button"
    class="mt-3 text-xs text-accent hover:underline"
    onclick={() => persist(normalizeTableView(null, columns))}>Réinitialiser la vue</button
  >
  {#if storageError}<p role="status" class="mt-2 text-xs text-warn">{storageError}</p>{/if}
</details>
<div class="max-w-full overflow-x-auto rounded-card border border-edge bg-surface">
  <table
    class="border-collapse text-sm"
    style:width={`${visible.reduce((n, c) => n + (view.widths[c.key] ?? c.width ?? 180), 0)}px`}
    style:min-width="100%"
    style:table-layout="fixed"
  >
    <colgroup
      >{#each visible as c (c.key)}<col
          style:width={`${view.widths[c.key] ?? c.width ?? 180}px`}
        />{/each}</colgroup
    >
    <thead
      ><tr class="border-b border-edge bg-surface-muted text-left text-xs text-ink-muted">
        {#each visible as c (c.key)}<th scope="col" class="relative px-3 py-2 font-semibold">
            {c.label}
            <button
              type="button"
              class="absolute inset-y-0 right-0 w-3 cursor-col-resize touch-none border-r border-edge hover:bg-accent/15 focus-visible:bg-accent/15"
              aria-label={`Redimensionner ${c.label}`}
              onpointerdown={(e) => start(e, c.key)}
              onpointermove={move}
              onpointerup={end}
              onpointercancel={end}
              onkeydown={(e) => {
                if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                  e.preventDefault();
                  resize(c.key, (view.widths[c.key] ?? 180) + (e.key === 'ArrowRight' ? 20 : -20));
                }
              }}
            ></button>
          </th>{/each}
      </tr></thead
    >
    <tbody
      >{#each rows as row (row.id)}<tr
          class="border-b border-edge-soft last:border-b-0 hover:bg-surface-muted"
        >
          {#each visible as c (c.key)}<td
              class={$density === 'compact'
                ? 'break-words px-3 py-1 align-top'
                : 'break-words px-3 py-2.5 align-top'}>{@render cell(row, c.key)}</td
            >{/each}
        </tr>{/each}</tbody
    >
  </table>
</div>
