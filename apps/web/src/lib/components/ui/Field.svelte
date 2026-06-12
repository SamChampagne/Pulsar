<script lang="ts">
  let { label, error = '', children } = $props();
</script>

<label class="block">
  <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</span>
  {@render children()}
  {#if error}<span class="mt-1 block text-xs text-danger">{error}</span>{/if}
</label>
