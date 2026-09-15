<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    PageHeader,
    Select,
    Skeleton,
    Table,
    ViewToggle,
    type ViewId,
    type Tone,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Bin {
    id: string;
    code: string;
    location: { code: string; name: string };
  }
  interface CountLine {
    id: string;
    itemId: string;
    systemQty: string;
    countedQty: string | null;
    item: { sku: string; name: string };
  }
  interface CycleCount {
    id: string;
    number: string;
    status: 'OPEN' | 'COUNTED' | 'RECONCILED' | 'CANCELLED';
    binId: string;
    note: string | null;
    bin: { code: string };
    lines?: CountLine[];
    _count?: { lines: number };
  }

  let counts = $state<CycleCount[]>([]);
  let bins = $state<Bin[]>([]);
  let selected = $state<CycleCount | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let createBinId = $state('');
  let createNote = $state('');
  let view = $state<ViewId>('table');
  // line id -> entered count (string)
  let entered = $state<Record<string, string>>({});

  const KANBAN_COLS: { status: CycleCount['status']; label: string }[] = [
    { status: 'OPEN', label: 'Ouvert' },
    { status: 'COUNTED', label: 'Compté' },
    { status: 'RECONCILED', label: 'Réconcilié' },
    { status: 'CANCELLED', label: 'Annulé' },
  ];

  function statusTone(s: string): Tone {
    return s === 'RECONCILED'
      ? 'ok'
      : s === 'COUNTED'
        ? 'info'
        : s === 'CANCELLED'
          ? 'neutral'
          : 'warn';
  }

  function statusLabel(s: string): string {
    switch (s) {
      case 'OPEN':
        return 'Ouvert';
      case 'COUNTED':
        return 'Compté';
      case 'RECONCILED':
        return 'Réconcilié';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return s;
    }
  }

  async function load() {
    loading = true;
    try {
      const [cc, bn] = await Promise.all([
        api<CycleCount[]>('/wms/cycle-counts'),
        api<Bin[]>('/wms/bins'),
      ]);
      counts = cc;
      bins = bn;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement');
    } finally {
      loading = false;
    }
  }

  async function openCount(id: string) {
    try {
      const c = await api<CycleCount>(`/wms/cycle-counts/${id}`);
      selected = c;
      entered = {};
      for (const l of c.lines ?? []) entered[l.id] = l.countedQty ?? '';
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    }
  }

  async function create() {
    if (!createBinId) {
      toast.error('Choisis un emplacement');
      return;
    }
    busy = true;
    try {
      const c = await api<CycleCount>('/wms/cycle-counts', {
        method: 'POST',
        body: { binId: createBinId, note: createNote.trim() || undefined },
      });
      createNote = '';
      await load();
      await openCount(c.id);
      toast.success(`${c.number} créé — saisis les quantités comptées`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      busy = false;
    }
  }

  async function recordCounts() {
    if (!selected) return;
    const payload = (selected.lines ?? [])
      .filter((l) => entered[l.id] !== '' && entered[l.id] != null)
      .map((l) => ({ lineId: l.id, countedQty: Number(entered[l.id]) }));
    if (payload.length === 0) {
      toast.error('Saisis au moins une quantité');
      return;
    }
    busy = true;
    try {
      await api(`/wms/cycle-counts/${selected.id}/counts`, {
        method: 'POST',
        body: { counts: payload },
      });
      toast.success('Comptage enregistré');
      await load();
      await openCount(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      busy = false;
    }
  }

  async function reconcile() {
    if (!selected) return;
    busy = true;
    try {
      await api(`/wms/cycle-counts/${selected.id}/reconcile`, { method: 'POST' });
      toast.success('Réconcilié — ajustements postés');
      await load();
      await openCount(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la réconciliation');
    } finally {
      busy = false;
    }
  }

  async function cancel(id: string) {
    if (!(await confirmAction('Annuler ce comptage ?'))) return;
    try {
      await api(`/wms/cycle-counts/${id}/cancel`, { method: 'POST' });
      await load();
      if (selected?.id === id) await openCount(id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    }
  }

  function variance(l: CountLine): number | null {
    if (l.countedQty == null) return null;
    return Number(l.countedQty) - Number(l.systemQty);
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Comptages cycliques — Pulsar</title></svelte:head>

<PageHeader
  title="Comptages cycliques"
  subtitle="Boucle de précision d'inventaire : compter un emplacement, comparer au système, réconcilier — les écarts postent des ajustements et alimentent le Workbench."
  count={counts.length}
>
  {#snippet actions()}
    <ViewToggle bind:view views={['table', 'cards', 'kanban']} />
  {/snippet}
</PageHeader>

<div class="grid gap-3 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
  <!-- Left: create + list -->
  <div class="space-y-3">
    <Card>
      <h2 class="mb-3 text-sm font-bold text-ink">Nouveau comptage</h2>
      <div class="space-y-3">
        <Field label="Emplacement">
          <Select bind:value={createBinId}>
            <option value="">Choisir…</option>
            {#each bins as b (b.id)}<option value={b.id}>{b.code} · {b.location.code}</option
              >{/each}
          </Select>
        </Field>
        <Field label="Note">
          <input
            bind:value={createNote}
            placeholder="Optionnel"
            class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </Field>
        <Button variant="primary" loading={busy} onclick={create}>Démarrer le comptage</Button>
      </div>
    </Card>

    {#if loading}
      <Card padded={false}><Skeleton rows={5} /></Card>
    {:else if view === 'table'}
      {#if counts.length === 0}
        <Card><EmptyState message="Aucun comptage. Démarre-en un sur un emplacement." /></Card>
      {:else}
        <Card padded={false}>
          <div class="divide-y divide-edge">
            {#each counts as c (c.id)}
              <button
                type="button"
                class={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted ${selected?.id === c.id ? 'bg-surface-muted' : ''}`}
                onclick={() => openCount(c.id)}
              >
                <span class="font-mono font-semibold text-ink">{c.number}</span>
                <span class="text-ink-muted">{c.bin.code}</span>
                <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                <span class="ml-auto text-xs text-ink-faint">{c._count?.lines ?? 0} lignes</span>
              </button>
            {/each}
          </div>
        </Card>
      {/if}
    {:else if view === 'cards'}
      {#if counts.length === 0}
        <Card><EmptyState message="Aucun comptage. Démarre-en un sur un emplacement." /></Card>
      {:else}
        <div class="grid gap-3">
          {#each counts as c (c.id)}
            <button type="button" class="block w-full text-left" onclick={() => openCount(c.id)}>
              <Card>
                <div class="flex items-start justify-between gap-2">
                  <span class="font-mono font-semibold text-ink">{c.number}</span>
                  <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                </div>
                <p class="mt-1 text-sm text-ink-muted">{c.bin.code}</p>
                <div class="mt-2 text-xs text-ink-faint">
                  {c._count?.lines ?? 0} lignes
                </div>
              </Card>
            </button>
          {/each}
        </div>
      {/if}
    {:else if view === 'kanban'}
      {#if counts.length === 0}
        <Card><EmptyState message="Aucun comptage. Démarre-en un sur un emplacement." /></Card>
      {:else}
        <div class="flex gap-2 overflow-x-auto pb-2">
          {#each KANBAN_COLS as col (col.status)}
            {@const items = counts.filter((c) => c.status === col.status)}
            <div
              class="flex w-52 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
            >
              <div class="flex items-center justify-between px-3 py-2">
                <Badge tone={statusTone(col.status)}>{col.label}</Badge>
                <span class="font-mono text-xs text-ink-muted">{items.length}</span>
              </div>
              <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {#if items.length === 0}
                  <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
                {:else}
                  {#each items as c (c.id)}
                    <button
                      type="button"
                      class={`block w-full rounded-inner border text-left p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card ${selected?.id === c.id ? 'border-accent bg-surface' : 'border-edge-soft bg-surface'}`}
                      onclick={() => openCount(c.id)}
                    >
                      <div class="font-mono font-semibold text-sm text-ink">{c.number}</div>
                      <div class="mt-0.5 text-xs text-ink-muted">{c.bin.code}</div>
                      <div class="mt-1 text-[11px] text-ink-faint">
                        {c._count?.lines ?? 0} lignes
                      </div>
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Right: selected detail -->
  <Card padded={false}>
    {#if !selected}
      <div class="p-4">
        <EmptyState message="Sélectionne un comptage pour saisir les quantités." />
      </div>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
        <div class="flex items-center gap-2">
          <span class="font-mono font-semibold text-ink">{selected.number}</span>
          <span class="text-ink-muted">{selected.bin.code}</span>
          <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
        </div>
        <div class="flex gap-2">
          {#if selected.status === 'OPEN'}
            <Button variant="primary" loading={busy} onclick={recordCounts}
              >Enregistrer le comptage</Button
            >
          {/if}
          {#if selected.status === 'COUNTED'}
            <Button variant="primary" loading={busy} onclick={reconcile}>Réconcilier</Button>
          {/if}
          {#if selected.status === 'OPEN' || selected.status === 'COUNTED'}
            <Button variant="secondary" onclick={() => cancel(selected!.id)}>Annuler</Button>
          {/if}
        </div>
      </div>

      {#if (selected.lines ?? []).length === 0}
        <div class="p-4">
          <EmptyState
            message="Aucun stock système dans cet emplacement. Annule ou ajoute du stock d'abord."
          />
        </div>
      {:else}
        <Table>
          {#snippet head()}
            <th>SKU</th><th>Article</th><th class="text-right">Système</th><th class="text-right"
              >Compté</th
            ><th class="text-right">Écart</th>
          {/snippet}
          {#snippet body()}
            {#each selected!.lines ?? [] as l (l.id)}
              {@const v = variance(l)}
              <tr>
                <td class="font-mono font-semibold text-ink">{l.item.sku}</td>
                <td class="text-ink-muted">{l.item.name}</td>
                <td class="text-right text-ink">{Number(l.systemQty)}</td>
                <td class="text-right">
                  {#if selected!.status === 'OPEN'}
                    <input
                      type="number"
                      step="any"
                      min="0"
                      bind:value={entered[l.id]}
                      class="w-24 rounded-md border border-edge bg-surface px-2 py-1 text-right text-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                  {:else}
                    {l.countedQty != null ? Number(l.countedQty) : '—'}
                  {/if}
                </td>
                <td
                  class={`text-right font-medium ${v == null ? 'text-ink-faint' : v === 0 ? 'text-ink-muted' : v > 0 ? 'text-ok' : 'text-danger'}`}
                >
                  {v == null ? '—' : v > 0 ? `+${v}` : v}
                </td>
              </tr>
            {/each}
          {/snippet}
        </Table>
      {/if}
    {/if}
  </Card>
</div>
