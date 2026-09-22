<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  onMount(() => {
    void goto('/personalize', { replaceState: true });
  });
</script>

<p class="text-sm text-ink-muted">
  L’apparence est maintenant dans <a class="text-accent underline" href="/personalize"
    >Personnalisation</a
  >.
</p>
