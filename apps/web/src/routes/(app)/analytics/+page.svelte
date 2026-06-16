<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Button,
    ErrorNotice,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  interface Scorecard {
    carrierId: string;
    code: string;
    name: string;
    loadsCompleted: number;
    loadsActive: number;
    tendersSent: number;
    tendersAccepted: number;
    acceptanceRatePct: number | null;
    onTimeDeliveryPct: number | null;
    totalEstimatedCost: number;
  }

  let rows = $state<Scorecard[]>([]);
  let error = $state('');
  let loading = $state(true);

  const completedLoads = $derived(rows.reduce((sum, row) => sum + row.loadsCompleted, 0));
  const activeLoads = $derived(rows.reduce((sum, row) => sum + row.loadsActive, 0));
  const tenderedCarriers = $derived(rows.filter((row) => row.tendersSent > 0).length);

  function pct(value: number | null): string {
    return value === null ? '—' : `${value} %`;
  }

  $effect(() => {
    api<Scorecard[]>('/transportation/analytics/carriers')
      .then((r) => {
        rows = r;
        loading = false;
      })
      .catch((e) => {
        error = e instanceof ApiError ? e.message : 'Failed to load analytics';
        loading = false;
      });
  });
</script>

<PageHeader
  title="Carrier scorecard"
  subtitle="Compare carrier acceptance, on-time execution, active load exposure, and estimated spend."
/>

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{completedLoads}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Completed loads</div><p class="mt-1 text-xs text-ink-faint">Delivered loads feeding scorecard quality.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{activeLoads}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Active exposure</div><p class="mt-1 text-xs text-ink-faint">Current loads still moving.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{tenderedCarriers}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Tendered carriers</div><p class="mt-1 text-xs text-ink-faint">Carriers with acceptance data.</p></Card>
</div>

<ErrorNotice message={error} onretry={() => location.reload()} />

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Carrier</th>
    <th>Loads completed</th>
    <th>Active</th>
    <th>Tenders (sent / accepted)</th>
    <th>Acceptance</th>
    <th>On-time delivery</th>
    <th class="text-right">Est. spend</th>
  {/snippet}
  {#snippet body()}
    {#each rows as row (row.carrierId)}
      <tr>
        <td>
          <span class="font-semibold text-ink">{row.name}</span>
          <span class="ml-1 text-xs text-ink-muted">({row.code})</span>
        </td>
        <td>{row.loadsCompleted}</td>
        <td>{row.loadsActive}</td>
        <td>{row.tendersSent} / {row.tendersAccepted}</td>
        <td>{pct(row.acceptanceRatePct)}</td>
        <td>{pct(row.onTimeDeliveryPct)}</td>
        <td class="text-right">{row.totalEstimatedCost.toLocaleString()}</td>
      </tr>
    {:else}
      <tr><td colspan="7"><EmptyState title="No carrier activity yet" message="Dispatch and complete loads to build acceptance, on-time, and spend history for the carrier scorecard.">
        {#snippet children()}<Button variant="secondary" href="/dispatch">Open Dispatch</Button><Button href="/carriers">Review carriers</Button>{/snippet}
      </EmptyState></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}
