<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Table as TableIcon, KanbanSquare } from 'lucide-svelte';
  import {
    PageHeader,
    Button,
    Select,
    Input,
    Field,
    Table,
    Badge,
    EmptyState,
    Panel,
    Modal,
    Card,
    Skeleton,
    toneFor,
    labelFor,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    mode: string | null;
    customerReference: string | null;
    requestedPickupEarly: string | null;
    requestedPickupLate: string | null;
    requestedDeliveryEarly: string | null;
    requestedDeliveryLate: string | null;
    customer: { id: string; name: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
  }

  interface Option {
    id: string;
    name: string;
  }

  type View = 'table' | 'kanban';
  let view = $state<View>('table');
  let search = $state('');
  let error = $state('');
  let selected = $state<OrderRow | null>(null);
  let showForm = $state(false);

  // — Table view (paginated) —
  let orders = $state<OrderRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let loadingTable = $state(true);

  // — Kanban view (grouped by status) —
  const KANBAN_COLS = [
    'DRAFT',
    'CONFIRMED',
    'PLANNED',
    'IN_EXECUTION',
    'COMPLETED',
    'CLOSED',
    'CANCELLED',
  ];
  let kanbanRows = $state<OrderRow[]>([]);
  let kanbanTotal = $state(0);
  let loadingKanban = $state(false);
  const byStatus = $derived((s: string) => kanbanRows.filter((r) => r.status === s));

  // Create form state
  let customers = $state<Option[]>([]);
  let locations = $state<Option[]>([]);
  let form = $state({
    customerId: '',
    originLocationId: '',
    destinationLocationId: '',
    customerReference: '',
    requestedPickupEarly: '',
    requestedPickupLate: '',
    requestedDeliveryEarly: '',
    requestedDeliveryLate: '',
    totalWeightKg: '',
    palletCount: '',
    mode: TransportMode.FTL,
  });

  const modeSuggestion = $derived(() => {
    const w = form.totalWeightKg ? Number(form.totalWeightKg) : null;
    const suggested = suggestMode(w);
    return suggested && suggested !== form.mode ? suggested : null;
  });

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleDateString() + (late ? ' → ' + new Date(late).toLocaleDateString() : '')
      : '—';

  async function loadTable() {
    loadingTable = true;
    try {
      const result = await api<Paginated<OrderRow>>('/transportation/transport-orders', {
        query: { search: search || undefined, page, pageSize },
      });
      orders = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des commandes';
    } finally {
      loadingTable = false;
    }
  }

  async function loadKanban() {
    loadingKanban = true;
    try {
      const result = await api<Paginated<OrderRow>>('/transportation/transport-orders', {
        query: { page: 1, pageSize: 100 },
      });
      kanbanRows = result.items;
      kanbanTotal = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des commandes';
    } finally {
      loadingKanban = false;
    }
  }

  // Refresh whatever view is active (after a mutation).
  async function refresh() {
    if (view === 'table') await loadTable();
    else await loadKanban();
  }

  async function openForm() {
    showForm = true;
    const [customersResult, locationsResult] = await Promise.all([
      api<Paginated<Option>>('/transportation/customers', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/locations', { query: { pageSize: 100 } }),
    ]);
    customers = customersResult.items;
    locations = locationsResult.items;
  }

  async function createOrder(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      await api('/transportation/transport-orders', {
        method: 'POST',
        body: {
          customerId: form.customerId,
          originLocationId: form.originLocationId,
          destinationLocationId: form.destinationLocationId,
          customerReference: form.customerReference || undefined,
          requestedPickupEarly: form.requestedPickupEarly
            ? new Date(form.requestedPickupEarly).toISOString()
            : undefined,
          requestedPickupLate: form.requestedPickupLate
            ? new Date(form.requestedPickupLate).toISOString()
            : undefined,
          requestedDeliveryEarly: form.requestedDeliveryEarly
            ? new Date(form.requestedDeliveryEarly).toISOString()
            : undefined,
          requestedDeliveryLate: form.requestedDeliveryLate
            ? new Date(form.requestedDeliveryLate).toISOString()
            : undefined,
          totalWeightKg: form.totalWeightKg ? Number(form.totalWeightKg) : undefined,
          palletCount: form.palletCount ? Number(form.palletCount) : undefined,
          mode: form.mode,
        },
      });
      showForm = false;
      await refresh();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec de la création de la commande';
    }
  }

  async function action(id: string, name: 'confirm' | 'plan' | 'cancel') {
    try {
      await api(`/transportation/transport-orders/${id}/${name}`, { method: 'POST' });
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Échec de l'action ${name}`);
    }
  }

  // Reset to page 1 whenever the search changes.
  $effect(() => { search; page = 1; });

  $effect(() => {
    error = '';
    if (view === 'table') void loadTable();
    else void loadKanban();
  });

  const views: { id: View; label: string; icon: typeof TableIcon }[] = [
    { id: 'table', label: 'Tableau', icon: TableIcon },
    { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  ];
</script>

<PageHeader title="Transport Orders" count={total || kanbanTotal}>
  {#snippet actions()}
    <Button onclick={openForm}>Nouvelle commande</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<div class="mb-3 flex flex-wrap items-center gap-3">
  <!-- view switcher -->
  <div class="inline-flex rounded-md border border-edge-soft bg-surface p-0.5 shadow-sm">
    {#each views as v (v.id)}
      {@const Icon = v.icon}
      <button
        class={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors ${view === v.id ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
        onclick={() => (view = v.id)}
      >
        <Icon class="size-3.5" /> {v.label}
      </button>
    {/each}
  </div>
  {#if view === 'table'}
    <div class="w-72">
      <input
        placeholder="Rechercher commande #, référence, client…"
        bind:value={search}
        onkeydown={(e) => { if (e.key === 'Enter') void loadTable(); }}
        class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      />
    </div>
  {/if}
</div>

{#if view === 'table'}
  {#if loadingTable}
    <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
  {:else}
    <Table>
      {#snippet head()}
        <th>Commande #</th><th>Client</th><th>Origine → Destination</th>
        <th>Mode</th><th>Enlèvement demandé</th><th>Statut</th>
      {/snippet}
      {#snippet body()}
        {#each orders as row (row.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <tr class="cursor-pointer" onclick={() => (selected = row)}>
            <td>
              <a href={`/transport-orders/${row.id}`} class="font-semibold text-accent hover:underline"
                 onclick={(e) => e.stopPropagation()}>{row.orderNumber}</a>
            </td>
            <td>{row.customer.name}</td>
            <td>{row.originLocation.city} → {row.destinationLocation.city}</td>
            <td>
              {#if row.mode}
                <span class="rounded border border-edge px-1.5 text-xs text-neutral">{row.mode}</span>
              {:else}
                —
              {/if}
            </td>
            <td>{fmtWindow(row.requestedPickupEarly, row.requestedPickupLate)}</td>
            <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
          </tr>
        {:else}
          <tr><td colspan="6"><EmptyState message="Aucune commande de transport." /></td></tr>
        {/each}
      {/snippet}
    </Table>

    {#if total > pageSize}
      <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
        <span class="font-mono text-xs">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}</span>
        <div class="flex items-center gap-2">
          <Button variant="secondary" disabled={page <= 1} onclick={() => { page = Math.max(1, page - 1); void loadTable(); }}>Précédent</Button>
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onclick={() => { page = Math.min(totalPages, page + 1); void loadTable(); }}>Suivant</Button>
        </div>
      </div>
    {/if}
  {/if}
{:else}
  {#if loadingKanban}
    <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
  {:else}
    <div class="flex gap-3 overflow-x-auto pb-2">
      {#each KANBAN_COLS as col (col)}
        {@const items = byStatus(col)}
        <div class="flex w-64 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted">
          <div class="flex items-center justify-between px-3 py-2">
            <Badge tone={toneFor(col)}>{labelFor(col)}</Badge>
            <span class="font-mono text-xs text-ink-muted">{items.length}</span>
          </div>
          <div class="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
            {#each items as row (row.id)}
              <div role="button" tabindex="0" class="cursor-pointer rounded-inner border border-edge-soft bg-surface p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-card" onclick={() => (selected = row)} onkeydown={(e) => { if (e.key === 'Enter') selected = row; }}>
                <div class="font-semibold text-sm text-accent">{row.orderNumber}</div>
                <div class="mt-0.5 truncate text-xs text-ink-muted">{row.customer.name}</div>
                <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                  <span class="truncate">{row.originLocation.city} → {row.destinationLocation.city}</span>
                  {#if row.mode}<span class="rounded border border-edge px-1">{row.mode}</span>{/if}
                </div>
              </div>
            {:else}
              <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    {#if kanbanTotal > 100}<p class="mt-2 text-xs text-ink-faint">Affiche les 100 commandes les plus récentes. Utilise le tableau pour la liste complète.</p>{/if}
  {/if}
{/if}

{#if selected}
  {@const sel = selected}
  <Panel open={true} title={sel.orderNumber} href={`/transport-orders/${sel.id}`} onclose={() => (selected = null)}>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Statut</div>
      <div class="text-sm text-ink"><Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge></div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Client</div>
      <div class="text-sm text-ink">{sel.customer.name}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Origine → Destination</div>
      <div class="text-sm text-ink">{sel.originLocation.name}, {sel.originLocation.city} → {sel.destinationLocation.name}, {sel.destinationLocation.city}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Enlèvement demandé</div>
      <div class="text-sm text-ink">{fmtWindow(sel.requestedPickupEarly, sel.requestedPickupLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Livraison demandée</div>
      <div class="text-sm text-ink">{fmtWindow(sel.requestedDeliveryEarly, sel.requestedDeliveryLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Mode</div>
      <div class="text-sm text-ink">{sel.mode ?? '—'}</div>
    </div>
    {#if sel.customerReference}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Référence</div>
        <div class="text-sm text-ink">{sel.customerReference}</div>
      </div>
    {/if}
  {#snippet footer()}
    {#if sel.status === 'DRAFT'}
      <Button variant="primary" onclick={async () => { await action(sel.id, 'confirm'); selected = null; }}>Confirmer</Button>
      <Button variant="danger" onclick={async () => { await action(sel.id, 'cancel'); selected = null; }}>Annuler</Button>
    {:else if sel.status === 'CONFIRMED'}
      <Button variant="primary" onclick={async () => { await action(sel.id, 'plan'); selected = null; }}>Planifier</Button>
    {/if}
  {/snippet}
  </Panel>
{/if}

<Modal bind:open={showForm} title="Nouvelle commande de transport">
  {#snippet children()}
    <form onsubmit={createOrder}>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Client">
          <Select bind:value={form.customerId} required>
            <option value="" disabled>Sélectionner…</option>
            {#each customers as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Référence client">
          <Input bind:value={form.customerReference} placeholder="PO-12345" />
        </Field>
        <Field label="Origine">
          <Select bind:value={form.originLocationId} required>
            <option value="" disabled>Sélectionner…</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Destination">
          <Select bind:value={form.destinationLocationId} required>
            <option value="" disabled>Sélectionner…</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Enlèvement à partir de">
          <Input type="date" bind:value={form.requestedPickupEarly} />
        </Field>
        <Field label="Enlèvement jusqu'à (optionnel)">
          <Input type="date" bind:value={form.requestedPickupLate} />
        </Field>
        <Field label="Livraison à partir de">
          <Input type="date" bind:value={form.requestedDeliveryEarly} />
        </Field>
        <Field label="Livraison jusqu'à (optionnel)">
          <Input type="date" bind:value={form.requestedDeliveryLate} />
        </Field>
        <Field label="Poids (kg)">
          <Input type="number" min="0" bind:value={form.totalWeightKg} />
        </Field>
        <Field label="Palettes">
          <Input type="number" min="0" bind:value={form.palletCount} />
        </Field>
        <div class="col-span-2">
          <Field label="Mode">
            <Select bind:value={form.mode}>
              {#each Object.values(TransportMode) as m (m)}
                <option value={m}>{m}</option>
              {/each}
            </Select>
            {#if modeSuggestion()}
              <p class="mt-1 text-xs text-ink-muted">Suggéré : {modeSuggestion()} selon le poids</p>
            {/if}
          </Field>
        </div>
      </div>
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Annuler</Button>
        <Button variant="primary" type="submit">Créer</Button>
      </div>
    </form>
  {/snippet}
</Modal>
