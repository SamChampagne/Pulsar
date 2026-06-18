<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Card,
    Table,
    EmptyState,
    Skeleton,
  } from '$lib/components/ui';
  import { laneLabel, formatDate } from '$lib/procurement/helpers';
  import type { LaneEndpoint, EndpointType } from '$lib/procurement/helpers';

  // ─── Types ────────────────────────────────────────────────────────────────────

  interface Lane {
    id: string;
    name: string | null;
    originType: EndpointType;
    originCity: string | null;
    originState: string | null;
    originCountry: string | null;
    originLocation: LaneEndpoint | null;
    destinationType: EndpointType;
    destinationCity: string | null;
    destinationState: string | null;
    destinationCountry: string | null;
    destinationLocation: LaneEndpoint | null;
  }

  interface RfpLaneRef {
    id: string;
    laneId: string;
    rfpId: string;
    lane: Lane;
  }

  interface RateRef {
    id: string;
    name: string;
    baseAmount: string | number;
    currency: string;
  }

  interface RoutingEntry {
    rfpLaneId: string;
    carrierId: string;
    bidId: string | null;
    rateId: string | null;
    awardedAt: string;
    carrier: { id: string; code: string; name: string };
    rfpLane: RfpLaneRef;
    rate?: RateRef | null;
  }

  // ─── Data ─────────────────────────────────────────────────────────────────────
  let entries = $state<RoutingEntry[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      entries = await api<RoutingEntry[]>('/procurement/routing-guide');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du guide de routage';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Guide de routage" count={entries.length} />

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if entries.length === 0}
  <Card>
    <EmptyState message="Aucune attribution dans le guide de routage. Attribuez des bids depuis un appel d'offres." />
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Lane</th>
      <th>Transporteur</th>
      <th>Tarif</th>
      <th>Date d'attribution</th>
    {/snippet}
    {#snippet body()}
      {#each entries as entry (entry.rfpLaneId + '-' + entry.carrierId)}
        <tr>
          <td class="text-sm text-ink">{laneLabel(entry.rfpLane.lane)}</td>
          <td class="font-semibold text-ink">{entry.carrier.name}</td>
          <td class="text-sm text-ink-muted">
            {#if entry.rate}
              {entry.rate.name} — {entry.rate.baseAmount} {entry.rate.currency}
            {:else}
              —
            {/if}
          </td>
          <td class="text-sm text-ink-muted">{formatDate(entry.awardedAt)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}
