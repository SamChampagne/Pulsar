<script lang="ts">
  import { page } from '$app/state';
  import FleetAssetDetail from '$lib/components/fleet/FleetAssetDetail.svelte';

  const id = $derived(page.params.id ?? '');
</script>

{#key id}
  <FleetAssetDetail assetKind="VEHICLE" assetId={id} />
{/key}
