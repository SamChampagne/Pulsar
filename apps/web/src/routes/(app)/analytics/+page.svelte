<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
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

<PageHeader title="Carrier scorecard" />

<p class="mb-4 text-sm text-ink-muted">
  On-time = delivered on or before the planned delivery date. Acceptance = accepted tenders over
  responded tenders.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

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
      <tr><td colspan="7"><EmptyState message="No carrier activity yet." /></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}
