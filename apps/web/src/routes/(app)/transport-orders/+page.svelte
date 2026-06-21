<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Select,
    Input,
    Field,
    Table,
    Badge,
    EmptyState,
    Modal,
    Card,
    Skeleton,
    ErrorNotice,
    toneFor,
    labelFor,
    ViewToggle,
    type ViewId,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';

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
    customData?: Record<string, unknown>;
  }

  // Custom field helpers
  function fmtCustomValue(value: unknown, type?: string): string {
    if (value === null || value === undefined) return '—';
    if (type === 'BOOLEAN') return value ? 'Oui' : 'Non';
    if (type === 'DATE' && typeof value === 'string')
      return new Date(value).toLocaleDateString();
    return String(value);
  }

  interface Option {
    id: string;
    name: string;
  }

  let view = $state<ViewId>('table');
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

  // Custom fields
  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }
  let orderFieldDefs = $state<CustomFieldDef[]>([]);
  let customData = $state<Record<string, unknown>>({});

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
      ? new Date(early).toLocaleDateString() +
        (late ? ' → ' + new Date(late).toLocaleDateString() : '')
      : '—';

  const orderScope = $derived(view === 'kanban' ? kanbanRows : orders);
  const draftCount = $derived(orderScope.filter((o) => o.status === 'DRAFT').length);
  const confirmedCount = $derived(orderScope.filter((o) => o.status === 'CONFIRMED').length);
  const plannedCount = $derived(
    orderScope.filter((o) => ['PLANNED', 'IN_EXECUTION'].includes(o.status)).length,
  );

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
    customData = {};
    const [customersResult, locationsResult, fieldDefs] = await Promise.all([
      api<Paginated<Option>>('/transportation/customers', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/locations', { query: { pageSize: 100 } }),
      api<CustomFieldDef[]>('/transportation/custom-fields', {
        query: { entityType: 'TRANSPORT_ORDER' },
      }).catch(() => [] as CustomFieldDef[]),
    ]);
    customers = customersResult.items;
    locations = locationsResult.items;
    orderFieldDefs = fieldDefs;
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
          customData: Object.keys(customData).length > 0 ? customData : undefined,
        },
      });
      showForm = false;
      customData = {};
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
  $effect(() => {
    search;
    page = 1;
  });

  $effect(() => {
    error = '';
    if (view === 'table') void loadTable();
    else void loadKanban();
  });
</script>

<PageHeader
  title="Transport Orders"
  subtitle="Capture demand, confirm it, then plan orders into shipments and executable loads."
  count={total || kanbanTotal}
>
  {#snippet actions()}
    <Button onclick={openForm}>Nouvelle commande</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={refresh} />

<div class="mb-4 grid gap-3 md:grid-cols-3">
  <Card
    ><div class="text-xl font-bold text-ink">{draftCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Draft</div>
    <p class="mt-1 text-xs text-ink-faint">Customer demand still needs confirmation.</p></Card
  >
  <Card
    ><div class="text-xl font-bold text-ink">{confirmedCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Ready to plan</div>
    <p class="mt-1 text-xs text-ink-faint">
      Next step: create shipments from confirmed orders.
    </p></Card
  >
  <Card
    ><div class="text-xl font-bold text-ink">{plannedCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">In flow</div>
    <p class="mt-1 text-xs text-ink-faint">Already planned or moving through execution.</p></Card
  >
</div>

<div class="mb-3 flex flex-wrap items-center gap-3">
  <!-- view switcher -->
  <ViewToggle bind:view views={['table', 'kanban']} />
  {#if view === 'table'}
    <div class="w-72">
      <input
        placeholder="Rechercher commande #, référence, client…"
        bind:value={search}
        onkeydown={(e) => {
          if (e.key === 'Enter') void loadTable();
        }}
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
              <a
                href={`/transport-orders/${row.id}`}
                class="font-semibold text-accent hover:underline"
                onclick={(e) => e.stopPropagation()}>{row.orderNumber}</a
              >
            </td>
            <td>{row.customer.name}</td>
            <td>{row.originLocation.city} → {row.destinationLocation.city}</td>
            <td>
              {#if row.mode}
                <span class="rounded border border-edge px-1.5 text-xs text-neutral"
                  >{row.mode}</span
                >
              {:else}
                —
              {/if}
            </td>
            <td>{fmtWindow(row.requestedPickupEarly, row.requestedPickupLate)}</td>
            <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
          </tr>
        {:else}
          <tr
            ><td colspan="6"
              ><EmptyState
                title="Aucune commande de transport"
                message="Créez une commande pour capturer la demande client, puis confirmez-la avant la planification."
              >
                {#snippet children()}<Button onclick={openForm}>Créer la première commande</Button
                  >{/snippet}
              </EmptyState></td
            ></tr
          >
        {/each}
      {/snippet}
    </Table>

    {#if total > pageSize}
      <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
        <span class="font-mono text-xs"
          >{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}</span
        >
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onclick={() => {
              page = Math.max(1, page - 1);
              void loadTable();
            }}>Précédent</Button
          >
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => {
              page = Math.min(totalPages, page + 1);
              void loadTable();
            }}>Suivant</Button
          >
        </div>
      </div>
    {/if}
  {/if}
{:else if loadingKanban}
  <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
{:else}
  <div class="flex gap-3 overflow-x-auto pb-2">
    {#each KANBAN_COLS as col (col)}
      {@const items = byStatus(col)}
      <div
        class="flex w-64 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
      >
        <div class="flex items-center justify-between px-3 py-2">
          <Badge tone={toneFor(col)}>{labelFor(col)}</Badge>
          <span class="font-mono text-xs text-ink-muted">{items.length}</span>
        </div>
        <div class="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
          {#each items as row (row.id)}
            <div
              role="button"
              tabindex="0"
              class="cursor-pointer rounded-inner border border-edge-soft bg-surface p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
              onclick={() => (selected = row)}
              onkeydown={(e) => {
                if (e.key === 'Enter') selected = row;
              }}
            >
              <div class="font-semibold text-sm text-accent">{row.orderNumber}</div>
              <div class="mt-0.5 truncate text-xs text-ink-muted">{row.customer.name}</div>
              <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                <span class="truncate"
                  >{row.originLocation.city} → {row.destinationLocation.city}</span
                >
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
  {#if kanbanTotal > 100}<p class="mt-2 text-xs text-ink-faint">
      Affiche les 100 commandes les plus récentes. Utilise le tableau pour la liste complète.
    </p>{/if}
{/if}

{#if selected}
  {@const sel = selected}
  <Modal open={true} size="lg" title={sel.orderNumber} onclose={() => (selected = null)}>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Statut</div>
      <div class="text-sm text-ink">
        <Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge>
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Client</div>
      <div class="text-sm text-ink">{sel.customer.name}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Origine → Destination
      </div>
      <div class="text-sm text-ink">
        {sel.originLocation.name}, {sel.originLocation.city} → {sel.destinationLocation.name}, {sel
          .destinationLocation.city}
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Enlèvement demandé
      </div>
      <div class="text-sm text-ink">
        {fmtWindow(sel.requestedPickupEarly, sel.requestedPickupLate)}
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Livraison demandée
      </div>
      <div class="text-sm text-ink">
        {fmtWindow(sel.requestedDeliveryEarly, sel.requestedDeliveryLate)}
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Mode</div>
      <div class="text-sm text-ink">{sel.mode ?? '—'}</div>
    </div>
    {#if sel.customerReference}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          Référence
        </div>
        <div class="text-sm text-ink">{sel.customerReference}</div>
      </div>
    {/if}
    {#if sel.customData && orderFieldDefs.length > 0}
      {#each orderFieldDefs.filter((d) => d.showInList ?? true) as d (d.key)}
        {#if sel.customData[d.key] !== undefined && sel.customData[d.key] !== null}
          <div class="mb-3">
            <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
              {d.label}
            </div>
            <div class="text-sm text-ink">{fmtCustomValue(sel.customData[d.key], d.type)}</div>
          </div>
        {/if}
      {/each}
    {/if}
    {#snippet footer()}
      {#if sel.status === 'DRAFT'}
        <Button
          variant="primary"
          onclick={async () => {
            await action(sel.id, 'confirm');
            selected = null;
          }}>Confirmer</Button
        >
        <Button
          variant="danger"
          onclick={async () => {
            await action(sel.id, 'cancel');
            selected = null;
          }}>Annuler</Button
        >
      {:else if sel.status === 'CONFIRMED'}
        <Button
          variant="primary"
          onclick={async () => {
            await action(sel.id, 'plan');
            selected = null;
          }}>Planifier</Button
        >
      {/if}
      <Button variant="secondary" href={`/transport-orders/${sel.id}`}
        >Ouvrir la page complète</Button
      >
    {/snippet}
  </Modal>
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
      {#if orderFieldDefs.length > 0}
        <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <CustomFieldInputs definitions={orderFieldDefs} bind:data={customData} />
        </div>
      {/if}
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showForm = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit">Créer</Button>
      </div>
    </form>
  {/snippet}
</Modal>
