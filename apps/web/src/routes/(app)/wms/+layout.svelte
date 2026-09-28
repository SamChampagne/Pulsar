<script lang="ts">
  import type { Snippet } from 'svelte';
  import MoveRecovery from '$lib/components/wms/MoveRecovery.svelte';
  import AdjustRecovery from '$lib/components/wms/AdjustRecovery.svelte';
  let { children }: { children: Snippet } = $props();
</script>

<MoveRecovery />
<AdjustRecovery />
{@render children()}
