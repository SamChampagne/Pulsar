<script lang="ts">
  import '../app.css';
  import Toasts from '$lib/components/Toasts.svelte';
  import ConfirmationHost from '$lib/components/ui/ConfirmationHost.svelte';

  let { children } = $props();
</script>

{@render children()}
<Toasts />
<ConfirmationHost />
