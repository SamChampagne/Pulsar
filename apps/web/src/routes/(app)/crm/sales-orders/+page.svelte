<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate, formatMoney } from '$lib/format';
  import {
    PageHeader,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    Button,
    type Tone,
  } from '$lib/components/ui';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'INVOICED' | 'CANCELLED';

  interface SalesOrderRow {
    id: string;
    number: string;
    status: SalesOrderStatus;
    company: { id: string; name: string };
    totalAmount: number | string;
    currency: string;
    createdAt: string;
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  let orders = $state<SalesOrderRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let statusFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<SalesOrderRow>>('/crm/sales-orders', {
        query: {
          search: search || undefined,
          status: statusFilter || undefined,
          page,
          pageSize,
        },
      });
      orders = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les commandes';
    } finally {
      loading = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const STATUS_LABELS: Record<SalesOrderStatus, string> = {
    DRAFT: 'Brouillon',
    CONFIRMED: 'Confirmée',
    FULFILLED: 'Exécutée',
    INVOICED: 'Facturée',
    CANCELLED: 'Annulée',
  };

  const STATUS_TONES: Record<SalesOrderStatus, Tone> = {
    DRAFT: 'neutral',
    CONFIRMED: 'info',
    FULFILLED: 'ok',
    INVOICED: 'purple',
    CANCELLED: 'danger',
  };

  function statusLabel(status: SalesOrderStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusTone(status: SalesOrderStatus): Tone {
    return STATUS_TONES[status] ?? 'neutral';
  }

  // ── Reactive load ─────────────────────────────────────────────────────────────

  $effect(() => {
    const _s = search;
    const _sf = statusFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<PageHeader
  title="Commandes"
  subtitle="Suivez vos commandes de vente par société et statut."
  count={total}
/>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-64">
    <input
      placeholder="Rechercher par numéro…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-48">
    <Select bind:value={statusFilter}>
      <option value="">Tous les statuts</option>
      <option value="DRAFT">Brouillon</option>
      <option value="CONFIRMED">Confirmée</option>
      <option value="FULFILLED">Exécutée</option>
      <option value="INVOICED">Facturée</option>
      <option value="CANCELLED">Annulée</option>
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if orders.length === 0}
  <Card>
    <EmptyState message="Aucune commande pour le moment." />
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Numéro</th><th>Société</th><th>Statut</th><th>Montant total</th><th>Créé le</th>
    {/snippet}
    {#snippet body()}
      {#each orders as order (order.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <tr
          class="cursor-pointer transition-colors hover:bg-surface-muted"
          onclick={() => goto(`/crm/sales-orders/${order.id}`)}
        >
          <td class="font-mono text-sm font-semibold text-ink">{order.number}</td>
          <td class="text-ink">{order.company.name}</td>
          <td>
            <Badge tone={statusTone(order.status)}>
              {statusLabel(order.status)}
            </Badge>
          </td>
          <td class="text-ink">{formatMoney(order.totalAmount, order.currency)}</td>
          <td class="text-ink-muted">{formatDate(order.createdAt)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>

  {#if total > pageSize}
    <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
      <span class="font-mono text-xs">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onclick={() => { page = Math.max(1, page - 1); void load(); }}
        >Précédent</Button>
        <span class="font-mono text-xs">Page {page} / {totalPages}</span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onclick={() => { page = Math.min(totalPages, page + 1); void load(); }}
        >Suivant</Button>
      </div>
    </div>
  {/if}
{/if}
