<script lang="ts">
  let { title = '', subtitle = '', maxWidth = 'max-w-md', children } = $props();
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-canvas p-4">
  <div class="mb-6 flex items-center gap-2 text-xl font-bold text-ink">
    <span class="text-accent">⬢</span> PULSAR
  </div>
  <div class={`w-full ${maxWidth} rounded-card border border-edge bg-surface p-6 shadow-pop`}>
    {#if title}<h1 class="mb-1 text-lg font-bold text-ink">{title}</h1>{/if}
    {#if subtitle}<p class="mb-4 text-sm text-ink-muted">{subtitle}</p>{/if}
    {@render children()}
  </div>
</div>
