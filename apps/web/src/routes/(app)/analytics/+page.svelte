<script lang="ts">
  import { api, ApiError } from '$lib/api/client';

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

  function pct(value: number | null): string {
    return value === null ? '—' : `${value} %`;
  }

  $effect(() => {
    api<Scorecard[]>('/transportation/analytics/carriers')
      .then((r) => (rows = r))
      .catch((e) => (error = e instanceof ApiError ? e.message : 'Failed to load analytics'));
  });
</script>

<div class="page-header">
  <h1>Carrier scorecard</h1>
</div>

<p class="muted">
  On-time = delivered on or before the planned delivery date. Acceptance = accepted tenders over
  responded tenders.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Carrier</th>
        <th>Loads completed</th>
        <th>Active</th>
        <th>Tenders (sent / accepted)</th>
        <th>Acceptance</th>
        <th>On-time delivery</th>
        <th>Est. spend</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.carrierId)}
        <tr>
          <td><strong>{row.name}</strong> <span class="muted">({row.code})</span></td>
          <td>{row.loadsCompleted}</td>
          <td>{row.loadsActive}</td>
          <td>{row.tendersSent} / {row.tendersAccepted}</td>
          <td>{pct(row.acceptanceRatePct)}</td>
          <td>{pct(row.onTimeDeliveryPct)}</td>
          <td>{row.totalEstimatedCost.toLocaleString()}</td>
        </tr>
      {:else}
        <tr><td colspan="7" class="muted">No carrier activity yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
