<!--
  Search-and-pick control for a value that lives behind an API endpoint
  (hard rule 53). Defaults reproduce v1 exactly — `{ endpoint, label }` still
  searches a `Paginated<{ id, name }>` list by `search`, 20 rows at a time, and
  binds the picked row's `id`.

  What v2 adds, all opt-in:
   - `labelKey` / `detailKey` / `valueKey`: endpoints without a `name` (bins,
     drivers, vehicles, GL accounts) used to render blank rows.
   - `listShape: 'array'`: endpoints that return the whole list at once and take
     no `search` parameter (chart of accounts) — fetched once per opening and
     filtered in the browser.
   - `selectedLabel`: display the current value without a `GET :endpoint/:id`.
   - `allowFreeText`: offer the typed text itself as a choice, for fields where
     an off-catalog value is legitimate (an external driver at the gate).
   - `allowCreate`: a footer action; the parent opens its own creation modal.
   - Keyboard: ↑/↓ move the highlight, Enter picks it, Escape closes (Modal).
     Listbox semantics with `aria-activedescendant` on the search box.
-->
<script lang="ts">
  import ScanInput from '$lib/components/scanning/ScanInput.svelte';
  import { pickerScanContext } from '$lib/scanning/context';
  import type { ScanResult } from '@pulsar/shared';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { ChevronDown, X, Check, Search, Plus } from 'lucide-svelte';
  import Modal from './Modal.svelte';
  import ErrorNotice from './ErrorNotice.svelte';
  import Button from './Button.svelte';
  import { formatItem, filterArray, type PickerRecord } from './entity-picker';

  let {
    endpoint,
    label,
    placeholder = 'Sélectionner…',
    value = $bindable(''),
    disabled = false,
    filters = {},
    labelKey = 'name',
    detailKey = undefined,
    valueKey = 'id',
    pageSize = 20,
    listShape = 'paginated',
    selectedLabel = '',
    allowCreate = undefined,
    allowFreeText = false,
    onfreetext = undefined,
    onselect = undefined,
  }: {
    endpoint: string;
    label: string;
    placeholder?: string;
    value?: string;
    disabled?: boolean;
    filters?: Record<string, string>;
    /** Field holding the row label; may name several fields ('firstName lastName'). */
    labelKey?: string;
    /** Optional secondary field shown next to the label (a bin's zone, a city). */
    detailKey?: string;
    /** Field bound to `value` — 'id' by default, 'code'/'sku' for natural keys. */
    valueKey?: string;
    pageSize?: number;
    /** 'array': the endpoint returns a bare array and is filtered client-side. */
    listShape?: 'paginated' | 'array';
    /** Label of the current value; skips the resolution request when provided. */
    selectedLabel?: string;
    allowCreate?: { label: string; onCreate: () => void };
    /** Offer the raw query as a choice when nothing in the catalog fits. */
    allowFreeText?: boolean;
    onfreetext?: (text: string) => void;
    onselect?: (item: PickerRecord) => void;
  } = $props();

  type Option = {
    key: string;
    kind: 'item' | 'free';
    value: string;
    label: string;
    detail?: string;
    item?: PickerRecord;
  };

  const uid = `picker-${Math.random().toString(36).slice(2, 9)}`;
  const listId = `${uid}-list`;

  let open = $state(false);
  let scanning = $state(false);
  const scanContext = $derived(pickerScanContext(endpoint, filters));
  async function scan(code: string) {
    if (!scanContext || disabled) return;
    const path = endpoint,
      context = JSON.stringify(scanContext);
    const result = await api<ScanResult>('/scan/wms', {
      method: 'POST',
      body: { ...scanContext, code },
    });
    if (!open || disabled || endpoint !== path || JSON.stringify(scanContext) !== context) return;
    selected = {
      id: result.id,
      sku: result.code,
      code: result.code,
      name: result.name,
      unit: result.unit,
    };
    value = valueKey === 'sku' || valueKey === 'code' ? result.code : result.id;
    open = false;
    onselect?.(selected);
  }
  let search = $state('');
  let selected = $state<PickerRecord | null>(null);
  /** Paginated shape: the current page. Array shape: the whole list, filtered below. */
  let items = $state<PickerRecord[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let highlight = $state(0);
  let generation = 0;

  const isArray = $derived(listShape === 'array');
  /** Only an `id`-keyed, paginated endpoint exposes `GET :endpoint/:id`. */
  const resolvesById = $derived(!isArray && valueKey === 'id' && !selectedLabel.trim());

  const visible = $derived(
    isArray ? filterArray(items, search, [labelKey, detailKey].filter(Boolean) as string[]) : items,
  );
  const shown = $derived(isArray ? visible.length : total);

  const options = $derived.by<Option[]>(() => {
    const list: Option[] = visible.map((item, index) => {
      const { label: text, detail } = formatItem(item, labelKey, detailKey);
      return {
        key: `item-${index}-${String(item[valueKey] ?? '')}`,
        kind: 'item',
        value: String(item[valueKey] ?? ''),
        label: text,
        detail,
        item,
      };
    });
    const query = search.trim();
    if (allowFreeText && query)
      list.push({ key: 'free-text', kind: 'free', value: query, label: `Utiliser “${query}”` });
    return list;
  });

  const display = $derived.by(() => {
    const explicit = selectedLabel.trim();
    if (explicit) return explicit;
    if (selected) return formatItem(selected, labelKey, detailKey).label || value;
    if (!value) return placeholder;
    // Resolution is still in flight (or failed): show the raw value when it means
    // something to a human (a code, a free-text entry), a neutral note otherwise.
    return resolvesById && !allowFreeText ? 'Sélection conservée' : value;
  });

  // Resolve the label of the current value. Skipped for array shapes, natural
  // keys and callers that already know the label — none of them has `GET :id`.
  $effect(() => {
    const id = value;
    const path = endpoint;
    if (!resolvesById) return;
    if (!id) {
      selected = null;
      return;
    }
    if (selected && String(selected[valueKey] ?? '') === id) return;
    let cancelled = false;
    api<PickerRecord>(`${path}/${encodeURIComponent(id)}`)
      .then((item) => {
        if (!cancelled) selected = item;
      })
      .catch(() => {
        if (!cancelled) selected = null;
      });
    return () => {
      cancelled = true;
    };
  });

  async function load(query: string, path: string, request: number) {
    try {
      if (isArray) {
        const result = await api<PickerRecord[]>(path, { query: { ...filters } });
        if (request !== generation) return;
        items = Array.isArray(result) ? result : [];
        total = items.length;
      } else {
        const result = await api<Paginated<PickerRecord>>(path, {
          query: { ...filters, search: query, pageSize },
        });
        if (request !== generation) return;
        items = result.items;
        total = result.total;
      }
    } catch (e) {
      if (request === generation)
        error = e instanceof ApiError ? e.message : 'Recherche indisponible';
    } finally {
      if (request === generation) loading = false;
    }
  }

  $effect(() => {
    const request = ++generation;
    const path = endpoint;
    // In array mode the whole list is fetched once per opening, so `search` is
    // deliberately not read here — filtering happens in `visible`.
    const query = isArray ? '' : search;
    if (!open) return;
    loading = true;
    items = [];
    error = '';
    const timer = setTimeout(() => void load(query, path, request), 200);
    return () => {
      clearTimeout(timer);
      generation++;
    };
  });

  // A new query starts the highlight back at the first row…
  $effect(() => {
    void search;
    highlight = 0;
  });

  // …and it never points past the current result set.
  $effect(() => {
    if (highlight >= options.length) highlight = 0;
  });

  $effect(() => {
    if (!open) return;
    const active = options[highlight];
    if (!active) return;
    document.getElementById(`${uid}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  });

  function choose(option: Option) {
    if (option.kind === 'free') {
      selected = null;
      value = option.value;
      open = false;
      onfreetext?.(option.value);
      return;
    }
    selected = option.item ?? null;
    value = option.value;
    open = false;
    if (selected) onselect?.(selected);
  }

  function onSearchKeydown(event: KeyboardEvent) {
    const count = options.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (count) highlight = (highlight + 1) % count;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) highlight = (highlight - 1 + count) % count;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[highlight] ?? options[0];
      if (option) choose(option);
    }
  }

  function retry() {
    loading = true;
    error = '';
    void load(isArray ? '' : search, endpoint, ++generation);
  }
</script>

<div class="flex min-w-0 items-center gap-1">
  <button
    type="button"
    {disabled}
    aria-haspopup="dialog"
    aria-label={`${label} : ${display}`}
    onclick={() => {
      scanning = false;
      search = '';
      highlight = 0;
      open = true;
    }}
    class="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3 rounded-md border border-edge bg-surface px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
  >
    <span class="truncate">{display}</span><ChevronDown size={14} class="shrink-0 text-ink-faint" />
  </button>
  {#if value}<button
      type="button"
      {disabled}
      aria-label={`Effacer ${label.toLowerCase()}`}
      onclick={() => {
        value = '';
        selected = null;
      }}
      class="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      ><X size={14} /></button
    >{/if}
</div>

{#snippet createFooter()}
  {#if allowCreate}
    <Button
      variant="secondary"
      onclick={() => {
        open = false;
        allowCreate.onCreate();
      }}><Plus size={14} />{allowCreate.label}</Button
    >
  {/if}
{/snippet}

<Modal bind:open title={label} size="sm" footer={allowCreate ? createFooter : undefined}>
  {#if scanContext}
    <div class="mb-3">
      <Button
        variant="secondary"
        onclick={() => {
          scanning = !scanning;
        }}>{scanning ? 'Rechercher manuellement' : 'Scanner un code-barres'}</Button
      >
    </div>
  {/if}
  {#if scanning && scanContext}
    <ScanInput
      onscan={scan}
      {disabled}
      label={scanContext.kind === 'item' ? 'Scanner un article' : 'Scanner un emplacement'}
    />
  {:else}
    <div class="flex items-center gap-2">
      <Search size={16} class="shrink-0 text-ink-faint" />
      <input
        bind:value={search}
        onkeydown={onSearchKeydown}
        type="text"
        autocomplete="off"
        aria-label={`Rechercher : ${label.toLowerCase()}`}
        aria-controls={listId}
        aria-activedescendant={options[highlight] ? `${uid}-opt-${highlight}` : undefined}
        placeholder="Rechercher par nom…"
        class="min-h-9 w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
      />
    </div>
    <div class="mt-3 min-h-32" aria-busy={loading}>
      <ErrorNotice message={error} onretry={retry} />
      {#if loading}<p class="py-4 text-sm text-ink-muted" role="status">Recherche…</p>
      {:else if !error && !options.length}<p class="py-4 text-sm text-ink-muted">
          Aucun résultat. Essayez un autre nom.
        </p>
      {:else}
        <div
          id={listId}
          role="listbox"
          aria-label={`Résultats : ${label.toLowerCase()}`}
          class="max-h-72 space-y-1 overflow-y-auto"
        >
          {#each options as option, index (option.key)}
            <button
              type="button"
              role="option"
              id={`${uid}-opt-${index}`}
              aria-selected={option.kind === 'item' && value === option.value}
              onmouseenter={() => (highlight = index)}
              onclick={() => choose(option)}
              class="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent {index ===
              highlight
                ? 'bg-surface-muted'
                : 'hover:bg-surface-muted'}"
            >
              <span class="min-w-0 break-words"
                >{option.label}{#if option.detail}<span class="ml-2 text-xs text-ink-muted"
                    >{option.detail}</span
                  >{/if}</span
              >{#if option.kind === 'item' && value === option.value}<Check
                  size={16}
                  class="shrink-0 text-accent"
                />{/if}
            </button>
          {/each}
        </div>
        {#if shown > visible.length}<p class="mt-3 text-xs text-ink-muted">
            {visible.length} résultats sur {shown}. Affinez votre recherche.
          </p>{/if}
      {/if}
    </div>
  {/if}
</Modal>
