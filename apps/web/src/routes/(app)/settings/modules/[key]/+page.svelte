<script lang="ts">
  import { page } from '$app/state';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';

  const key = $derived(page.params.key as string);
</script>

<h1 class="mb-4 text-xl font-semibold text-ink">Configuration</h1>
<ModuleSettings module={key} />
