<script lang="ts">
  import { Button, PageHeader } from '$lib/components/ui';
  import { sessionClient } from '$lib/portal/client';
  import OrdersTable from '$lib/portal/components/OrdersTable.svelte';
  import { portalView } from '$lib/portal/session';
  import type { PortalView } from '$lib/portal/types';

  const client = sessionClient();

  let createOpen = $state(false);
  let total = $state(0);

  // A new order changes the shared view (dashboard tiles, change-request
  // pickers), so refresh the layout's copy alongside the table.
  async function reloadView() {
    portalView.set(await client.get<PortalView>('/view'));
  }
</script>

<PageHeader
  title="Commandes"
  subtitle="Suivez vos demandes de transport, leurs expéditions et leur avancement."
  count={total}
>
  {#snippet actions()}
    <Button
      onclick={() => {
        createOpen = true;
      }}>Nouvelle demande de transport</Button
    >
  {/snippet}
</PageHeader>

{#if $portalView}
  <OrdersTable {client} view={$portalView} bind:createOpen bind:total onOrderCreated={reloadView} />
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
