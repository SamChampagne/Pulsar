<script lang="ts">
  import { page } from '$app/state';
  import FleetDriverDetail from '$lib/components/fleet/FleetDriverDetail.svelte';

  const id = $derived(page.params.id ?? '');
</script>

{#key id}
  <FleetDriverDetail driverId={id} />
{/key}
