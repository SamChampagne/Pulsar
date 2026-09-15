<script lang="ts">
  import type { Snippet } from 'svelte';
  import MoveRecovery from '$lib/components/wms/MoveRecovery.svelte';
  let { children }: { children: Snippet } = $props();
</script>

<MoveRecovery />
{@render children()}
