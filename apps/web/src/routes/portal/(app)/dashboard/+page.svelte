<script lang="ts">
  import { sessionClient } from '$lib/portal/client';
  import DashboardPanel from '$lib/portal/components/DashboardPanel.svelte';
  import { portalView } from '$lib/portal/session';

  const client = sessionClient();

  // Orders come from the layout's single `/view` load — no second round-trip here.
</script>

{#if $portalView}
  <DashboardPanel
    {client}
    view={$portalView}
    hrefs={{
      orders: '/portal/orders',
      invoices: '/portal/invoices',
      requests: '/portal/requests',
    }}
  />
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
