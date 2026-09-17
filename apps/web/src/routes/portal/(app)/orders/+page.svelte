<script lang="ts">
  import { sessionClient } from '$lib/portal/client';
  import OrdersPanel from '$lib/portal/components/OrdersPanel.svelte';
  import { portalView } from '$lib/portal/session';
  import type { PortalView } from '$lib/portal/types';

  const client = sessionClient();

  // A new order changes the shared view, so refresh the layout's copy.
  async function reload() {
    portalView.set(await client.get<PortalView>('/view'));
  }
</script>

{#if $portalView}
  <OrdersPanel {client} view={$portalView} onOrderCreated={reload} />
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
