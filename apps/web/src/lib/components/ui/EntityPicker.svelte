<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { ChevronDown, X, Check, Search } from 'lucide-svelte';
  import Modal from './Modal.svelte';
  import Input from './Input.svelte';
  import ErrorNotice from './ErrorNotice.svelte';

  interface Item {
    id: string;
    name: string;
  }
  let {
    endpoint,
    label,
    placeholder = 'Sélectionner…',
    value = $bindable(''),
    disabled = false,
    filters = {},
  }: {
    endpoint: string;
    label: string;
    placeholder?: string;
    value?: string;
    disabled?: boolean;
    filters?: Record<string, string>;
  } = $props();
  let open = $state(false);
  let search = $state('');
  let selected = $state<Item | null>(null);
  let items = $state<Item[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let generation = 0;

  $effect(() => {
    const id = value;
    const path = endpoint;
    let cancelled = false;
    if (!id) {
      selected = null;
      return;
    }
    api<Item>(`${path}/${encodeURIComponent(id)}`)
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
      const result = await api<Paginated<Item>>(path, {
        query: { ...filters, search: query, pageSize: 20 },
      });
      if (request !== generation) return;
      items = result.items;
      total = result.total;
    } catch (e) {
      if (request === generation)
        error = e instanceof ApiError ? e.message : 'Recherche indisponible';
    } finally {
      if (request === generation) loading = false;
    }
  }

  $effect(() => {
    const request = ++generation;
    const query = search;
    const path = endpoint;
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
</script>

<div class="flex min-w-0 items-center gap-1">
  <button
    type="button"
    {disabled}
    aria-haspopup="dialog"
    aria-label={`${label} : ${selected?.name ?? (value ? 'Sélection conservée' : placeholder)}`}
    onclick={() => {
      search = '';
      open = true;
    }}
    class="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3 rounded-md border border-edge bg-surface px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
  >
    <span class="truncate">{selected?.name ?? (value ? 'Sélection conservée' : placeholder)}</span
    ><ChevronDown size={14} class="shrink-0 text-ink-faint" />
  </button>
  {#if value}<button
      type="button"
      {disabled}
      aria-label={`Effacer ${label.toLowerCase()}`}
      onclick={() => (value = '')}
      class="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      ><X size={14} /></button
    >{/if}
</div>

<Modal bind:open title={label} size="sm">
  <div class="flex items-center gap-2">
    <Search size={16} class="shrink-0 text-ink-faint" /><Input
      bind:value={search}
      aria-label={`Rechercher : ${label.toLowerCase()}`}
      placeholder="Rechercher par nom…"
    />
  </div>
  <div class="mt-3 min-h-32" aria-busy={loading}>
    <ErrorNotice
      message={error}
      onretry={() => {
        loading = true;
        error = '';
        void load(search, endpoint, ++generation);
      }}
    />
    {#if loading}<p class="py-4 text-sm text-ink-muted" role="status">Recherche…</p>
    {:else if !error && !items.length}<p class="py-4 text-sm text-ink-muted">
        Aucun résultat. Essayez un autre nom.
      </p>
    {:else}
      <ul class="max-h-72 space-y-1 overflow-y-auto">
        {#each items as item (item.id)}
          <li>
            <button
              type="button"
              onclick={() => {
                selected = item;
                value = item.id;
                open = false;
              }}
              class="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span class="min-w-0 break-words">{item.name}</span>{#if value === item.id}<Check
                  size={16}
                  class="shrink-0 text-accent"
                />{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if total > items.length}<p class="mt-3 text-xs text-ink-muted">
          {items.length} résultats sur {total}. Affinez votre recherche.
        </p>{/if}
    {/if}
  </div>
</Modal>
