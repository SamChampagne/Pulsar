<script lang="ts">
  let { title = '', message = "Rien à afficher pour l'instant.", children = undefined } = $props();
</script>

<div class="flex flex-col items-center gap-2 py-10 text-center">
  {#if title}<div class="text-sm font-semibold text-ink">{title}</div>{/if}
  <p class="max-w-xl text-sm text-ink-faint">{message}</p>
  {#if children}<div class="mt-2 flex flex-wrap justify-center gap-2">{@render children()}</div>{/if}
</div>
