<!--
  Orders section of the capability-link plane (`/portal/:token`), which has no
  sub-routes and therefore no page header of its own: it supplies the
  « Nouvelle demande de transport » button and delegates everything else to
  `OrdersTable`, the single implementation shared with the session workspace.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import type { PortalClient } from '../client';
  import type { PortalView } from '../types';
  import OrdersTable from './OrdersTable.svelte';

  let {
    client,
    view,
    onOrderCreated,
    active,
  }: {
    client: PortalClient;
    view: PortalView;
    onOrderCreated: () => void | Promise<void>;
    active: boolean;
  } = $props();

  let createOpen = $state(false);
</script>

<div class="mb-4 flex items-center justify-end">
  <Button
    onclick={() => {
      createOpen = true;
    }}>Nouvelle demande de transport</Button
  >
</div>

<OrdersTable {client} {view} bind:createOpen {onOrderCreated} {active} />
