<script lang="ts">
  import { page } from '$app/state';
  import { sessionClient } from '$lib/portal/client';
  import ChangeRequestsPanel from '$lib/portal/components/ChangeRequestsPanel.svelte';
  import { portalView } from '$lib/portal/session';

  const client = sessionClient();
</script>

<svelte:head><title>Demandes — Portail client</title></svelte:head>

{#if $portalView}
  <ChangeRequestsPanel
    {client}
    view={$portalView}
    initialOrderId={page.url.searchParams.get('orderId') ?? ''}
    initialShipmentId={page.url.searchParams.get('shipmentId') ?? ''}
  />
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
