<script lang="ts">
  let { rows = 3 } = $props();
</script>

<div class="animate-pulse space-y-2 p-4">
  {#each Array(rows) as _, i (i)}
    <div class="h-4 rounded bg-edge-soft"></div>
  {/each}
</div>
