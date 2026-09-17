<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    PageHeader,
    Select,
    Skeleton,
    Table,
    ViewToggle,
    type ViewId,
    type Tone,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  type WoStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

  interface MaintenanceOrder {
    id: string;
    vehicleId: string | null;
    trailerId: string | null;
    type: string;
    status: WoStatus;
    description: string;
    odometerKm: number | null;
    costAmount: string | null;
    costCurrency: string;
    vendor: string | null;
    dueDate: string | null;
    openedAt: string;
    completedAt: string | null;
  }

  interface Asset {
    id: string;
    unitNumber: string;
  }

  let orders = $state<MaintenanceOrder[]>([]);
  let vehicles = $state<Asset[]>([]);
  let trailers = $state<Asset[]>([]);
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let statusFilter = $state<'' | WoStatus>('');
  let view = $state<ViewId>('table');

  const STATUS_OPTIONS: { value: '' | WoStatus; label: string }[] = [
    { value: '', label: 'Tous les statuts' },
    { value: 'OPEN', label: 'Ouvert' },
    { value: 'IN_PROGRESS', label: 'En cours' },
    { value: 'COMPLETED', label: 'Terminé' },
    { value: 'CANCELLED', label: 'Annulé' },
  ];

  const KANBAN_COLS: { status: WoStatus; label: string }[] = [
    { status: 'OPEN', label: 'Ouvert' },
    { status: 'IN_PROGRESS', label: 'En cours' },
    { status: 'COMPLETED', label: 'Terminé' },
    { status: 'CANCELLED', label: 'Annulé' },
  ];

  function statusTone(s: string): Tone {
    return s === 'COMPLETED'
      ? 'ok'
      : s === 'IN_PROGRESS'
        ? 'info'
        : s === 'CANCELLED'
          ? 'neutral'
          : 'warn';
  }

  function statusLabel(s: string): string {
    switch (s) {
      case 'OPEN':
        return 'Ouvert';
      case 'IN_PROGRESS':
        return 'En cours';
      case 'COMPLETED':
        return 'Terminé';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return s;
    }
  }

  function typeLabel(t: string): string {
    switch (t) {
      case 'PREVENTIVE':
        return 'Préventif';
      case 'REPAIR':
        return 'Réparation';
      case 'INSPECTION':
        return 'Inspection';
      default:
        return t;
    }
  }

  function fmtDate(d: string | null): string {
    return formatDate(d);
  }

  // Asset link + label derived from the vehicle/trailer lookups (the list payload
  // only carries the foreign-key id, never the joined unit number).
  function assetHref(wo: MaintenanceOrder): string | null {
    if (wo.vehicleId) return `/fleet/vehicles/${wo.vehicleId}`;
    if (wo.trailerId) return `/fleet/trailers/${wo.trailerId}`;
    return null;
  }
  function assetLabel(wo: MaintenanceOrder): string {
    if (wo.vehicleId) {
      return vehicles.find((v) => v.id === wo.vehicleId)?.unitNumber ?? 'Véhicule';
    }
    if (wo.trailerId) {
      return trailers.find((t) => t.id === wo.trailerId)?.unitNumber ?? 'Remorque';
    }
    return '—';
  }
  function assetKind(wo: MaintenanceOrder): string {
    return wo.vehicleId ? 'véh.' : wo.trailerId ? 'rem.' : '';
  }

  async function load() {
    loading = true;
    try {
      const [wo, veh, trl] = await Promise.all([
        api<MaintenanceOrder[]>('/fleet/maintenance-orders', {
          query: statusFilter ? { status: statusFilter } : {},
        }),
        api<Paginated<Asset>>('/transportation/vehicles', { query: { pageSize: 100 } }),
        api<Paginated<Asset>>('/transportation/trailers', { query: { pageSize: 100 } }),
      ]);
      orders = wo;
      vehicles = veh.items;
      trailers = trl.items;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement');
    } finally {
      loading = false;
    }
  }

  async function act(id: string, verb: 'start' | 'complete' | 'cancel') {
    if (verb === 'cancel' && !(await confirmAction('Annuler cet ordre de maintenance ?'))) return;
    busy = id;
    try {
      await api(`/fleet/maintenance-orders/${id}/${verb}`, { method: 'POST', body: {} });
      const msg =
        verb === 'start'
          ? 'Maintenance démarrée'
          : verb === 'complete'
            ? 'Maintenance terminée — état flotte revérifié'
            : 'Ordre annulé';
      toast.success(msg);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      busy = null;
    }
  }

  // Server-side filter: reload whenever the status filter changes.
  $effect(() => {
    void statusFilter;
    void load();
  });
</script>

<svelte:head><title>Ordres de maintenance — Pulsar</title></svelte:head>

<PageHeader
  title="Ordres de maintenance"
  subtitle="Tous les work orders de la flotte : véhicules et remorques en réparation, inspection ou entretien préventif."
  count={orders.length}
>
  {#snippet actions()}
    <div class="w-44">
      <Select bind:value={statusFilter}>
        {#each STATUS_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </Select>
    </div>
    <ViewToggle bind:view views={['table', 'cards', 'kanban']} />
  {/snippet}
</PageHeader>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if orders.length === 0}
  <Card
    ><EmptyState
      message="Aucun ordre de maintenance. Génère-en un depuis un plan d'entretien ou la fiche d'un asset."
    /></Card
  >
{:else if view === 'table'}
  <Card padded={false}>
    <Table>
      {#snippet head()}
        <th>N°</th><th>Asset</th><th>Type</th><th>Statut</th><th>Ouvert</th><th>Échéance</th><th
          >Terminé</th
        ><th class="text-right">Actions</th>
      {/snippet}
      {#snippet body()}
        {#each orders as wo (wo.id)}
          <tr>
            <td class="font-mono text-xs text-ink-faint">{wo.id.slice(0, 8)}</td>
            <td>
              {#if assetHref(wo)}
                <a class="font-medium text-accent hover:underline" href={assetHref(wo)}>
                  {assetLabel(wo)}
                </a>
                <span class="ml-1 text-xs text-ink-faint">{assetKind(wo)}</span>
              {:else}
                <span class="text-ink-muted">—</span>
              {/if}
            </td>
            <td class="text-ink-muted">{typeLabel(wo.type)}</td>
            <td><Badge tone={statusTone(wo.status)}>{statusLabel(wo.status)}</Badge></td>
            <td class="text-ink-muted">{fmtDate(wo.openedAt)}</td>
            <td class="text-ink-muted">{fmtDate(wo.dueDate)}</td>
            <td class="text-ink-muted">{fmtDate(wo.completedAt)}</td>
            <td class="text-right">
              <div class="flex justify-end gap-1">
                {#if wo.status === 'OPEN'}
                  <Button
                    variant="secondary"
                    loading={busy === wo.id}
                    onclick={() => act(wo.id, 'start')}>Démarrer</Button
                  >
                {/if}
                {#if wo.status === 'OPEN' || wo.status === 'IN_PROGRESS'}
                  <Button
                    variant="primary"
                    loading={busy === wo.id}
                    onclick={() => act(wo.id, 'complete')}>Terminer</Button
                  >
                  <Button
                    variant="secondary"
                    loading={busy === wo.id}
                    onclick={() => act(wo.id, 'cancel')}>Annuler</Button
                  >
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      {/snippet}
    </Table>
  </Card>
{:else if view === 'cards'}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each orders as wo (wo.id)}
      <Card>
        <div class="flex items-start justify-between gap-2">
          {#if assetHref(wo)}
            <a class="font-semibold text-accent hover:underline" href={assetHref(wo)}>
              {assetLabel(wo)}
              <span class="text-xs font-normal text-ink-faint">{assetKind(wo)}</span>
            </a>
          {:else}
            <span class="font-semibold text-ink">—</span>
          {/if}
          <Badge tone={statusTone(wo.status)}>{statusLabel(wo.status)}</Badge>
        </div>
        <p class="mt-1 text-xs text-ink-faint">{typeLabel(wo.type)}</p>
        <p class="mt-1 line-clamp-2 text-sm text-ink-muted">{wo.description}</p>
        <div class="mt-2 space-y-0.5 text-xs text-ink-faint">
          <div>Ouvert : {fmtDate(wo.openedAt)}</div>
          {#if wo.dueDate}<div>Échéance : {fmtDate(wo.dueDate)}</div>{/if}
          {#if wo.completedAt}<div>Terminé : {fmtDate(wo.completedAt)}</div>{/if}
        </div>
        {#if wo.status === 'OPEN' || wo.status === 'IN_PROGRESS'}
          <div class="mt-2 flex flex-wrap gap-1">
            {#if wo.status === 'OPEN'}
              <Button
                variant="secondary"
                loading={busy === wo.id}
                onclick={() => act(wo.id, 'start')}>Démarrer</Button
              >
            {/if}
            <Button
              variant="primary"
              loading={busy === wo.id}
              onclick={() => act(wo.id, 'complete')}>Terminer</Button
            >
            <Button
              variant="secondary"
              loading={busy === wo.id}
              onclick={() => act(wo.id, 'cancel')}>Annuler</Button
            >
          </div>
        {/if}
      </Card>
    {/each}
  </div>
{:else if view === 'kanban'}
  <div class="flex gap-2 overflow-x-auto pb-2">
    {#each KANBAN_COLS as col (col.status)}
      {@const items = orders.filter((w) => w.status === col.status)}
      <div
        class="flex w-60 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
      >
        <div class="flex items-center justify-between px-3 py-2">
          <Badge tone={statusTone(col.status)}>{col.label}</Badge>
          <span class="font-mono text-xs text-ink-muted">{items.length}</span>
        </div>
        <div class="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
          {#if items.length === 0}
            <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
          {:else}
            {#each items as wo (wo.id)}
              <div class="rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm">
                {#if assetHref(wo)}
                  <a class="font-semibold text-sm text-accent hover:underline" href={assetHref(wo)}>
                    {assetLabel(wo)}
                    <span class="text-xs font-normal text-ink-faint">{assetKind(wo)}</span>
                  </a>
                {:else}
                  <div class="font-semibold text-sm text-ink">—</div>
                {/if}
                <div class="mt-0.5 text-[11px] text-ink-faint">{typeLabel(wo.type)}</div>
                <div class="mt-0.5 line-clamp-2 text-xs text-ink-muted">{wo.description}</div>
                <div class="mt-0.5 text-[11px] text-ink-faint">ouvert {fmtDate(wo.openedAt)}</div>
                {#if wo.status === 'OPEN' || wo.status === 'IN_PROGRESS'}
                  <div class="mt-1.5 flex flex-wrap gap-1">
                    {#if wo.status === 'OPEN'}
                      <button
                        class="rounded-md border border-edge px-2 py-0.5 text-[11px] font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50"
                        disabled={busy === wo.id}
                        onclick={() => act(wo.id, 'start')}>Démarrer</button
                      >
                    {/if}
                    <button
                      class="rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
                      disabled={busy === wo.id}
                      onclick={() => act(wo.id, 'complete')}>Terminer</button
                    >
                    <button
                      class="rounded-md px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                      disabled={busy === wo.id}
                      onclick={() => act(wo.id, 'cancel')}>Annuler</button
                    >
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
