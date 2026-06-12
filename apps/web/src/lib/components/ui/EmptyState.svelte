<script lang="ts">
  let { message = 'Nothing here yet.', children = undefined } = $props();
</script>

<div class="flex flex-col items-center gap-2 py-10 text-center">
  <p class="text-sm text-ink-faint">{message}</p>
  {#if children}{@render children()}{/if}
</div>
