<script lang="ts">
  import type { Snippet } from 'svelte';
  let { id, label, children }: { id: string; label: string; children: Snippet } = $props();
</script>

<section
  {id}
  aria-label={label}
  tabindex="-1"
  class="min-w-0 scroll-mt-20 space-y-4 focus:outline-none"
>
  {@render children()}
</section>
