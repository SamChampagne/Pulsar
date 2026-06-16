<script lang="ts">
  let { padded = true, children } = $props();
</script>

<div class={`rounded-card border border-edge-soft bg-surface shadow-sm ${padded ? 'p-4' : ''}`}>
  {@render children()}
</div>
