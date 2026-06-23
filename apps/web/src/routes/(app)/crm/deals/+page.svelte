<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { goto } from '$app/navigation';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    Card,
    Skeleton,
    EmptyState,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface DealRow {
    id: string;
    title: string;
    companyId: string;
    stage: string;
    /** Decimal arrives as string from Prisma — coerce with Number() before use */
    amount: string | null;
    currency: string;
    ownerUserId: string | null;
    expectedCloseDate: string | null;
    lastActivityAt: string | null;
    company: { id: string; name: string };
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let deals = $state<DealRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let stageFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<DealRow>>('/crm/deals', {
        query: { search: search || undefined, stage: stageFilter || undefined, page, pageSize },
      });
      deals = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les affaires';
    } finally {
      loading = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function stageTone(stage: string): Tone {
    switch (stage) {
      case 'WON':       return 'ok';
      case 'LOST':      return 'danger';
      case 'PROPOSAL':  return 'warn';
      case 'QUALIFIED': return 'info';
      default:          return 'neutral';
    }
  }

  function stageLabel(stage: string): string {
    switch (stage) {
      case 'LEAD':      return 'Prospect';
      case 'QUALIFIED': return 'Qualifié';
      case 'PROPOSAL':  return 'Proposition';
      case 'WON':       return 'Gagné';
      case 'LOST':      return 'Perdu';
      default:          return stage;
    }
  }

  function formatAmount(amount: string | null, currency: string): string {
    if (amount == null) return '—';
    // Decimal arrives as string — coerce to Number before formatting
    const n = Number(amount);
    if (isNaN(n)) return '—';
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  }

  // ── Reactive load ─────────────────────────────────────────────────────────────
  // Single effect: tracks filters, resets to page 1, fires exactly one load.
  // Pagination buttons call load() directly and are not tracked here.
  $effect(() => {
    const _s = search;
    const _sf = stageFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<PageHeader title="Affaires" subtitle="Suivez vos opportunités commerciales." count={total} />

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-64">
    <input
      placeholder="Rechercher par titre…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-44">
    <Select bind:value={stageFilter}>
      <option value="">Toutes les étapes</option>
      <option value="LEAD">Prospect</option>
      <option value="QUALIFIED">Qualifié</option>
      <option value="PROPOSAL">Proposition</option>
      <option value="WON">Gagné</option>
      <option value="LOST">Perdu</option>
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if deals.length === 0}
  <Card>
    <EmptyState message="Aucune affaire pour le moment." />
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Titre</th><th>Société</th><th>Étape</th><th>Montant</th><th>Clôture prévue</th>
    {/snippet}
    {#snippet body()}
      {#each deals as deal (deal.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <tr
          class="cursor-pointer transition-colors hover:bg-surface-muted"
          onclick={() => void goto(`/crm/companies/${deal.company.id}`)}
        >
          <td class="font-semibold text-ink">{deal.title}</td>
          <td class="text-ink-muted">{deal.company.name}</td>
          <td><Badge tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</Badge></td>
          <td class="text-ink-muted">{formatAmount(deal.amount, deal.currency)}</td>
          <td class="text-ink-muted">{formatDate(deal.expectedCloseDate)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

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
