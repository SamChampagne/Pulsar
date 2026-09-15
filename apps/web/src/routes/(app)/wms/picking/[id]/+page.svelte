<script lang="ts">
  import { page } from '$app/state';
  import WarehouseDocument from '$lib/components/wms/WarehouseDocument.svelte';
</script>

{#if page.params.id}<WarehouseDocument kind="pick-order" id={page.params.id} />{/if}
