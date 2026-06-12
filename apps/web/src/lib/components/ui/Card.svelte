<script lang="ts">
  let { padded = true, children } = $props();
</script>

<div class={`rounded-card border border-edge bg-surface ${padded ? 'p-4' : ''}`}>
  {@render children()}
</div>
