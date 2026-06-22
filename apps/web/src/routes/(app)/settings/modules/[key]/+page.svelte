<script lang="ts">
  import { page } from '$app/state';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';

  const key = $derived(page.params.key as string);
</script>

<h1 class="mb-4 text-xl font-semibold text-ink">Configuration</h1>
<ModuleSettings module={key} />

{#if key === 'transportation'}
  <div class="mt-6">
    <CustomFieldsEditor />
  </div>
{:else if key === 'billing'}
  <div class="mt-6">
    <CustomFieldsEditor module="billing" />
  </div>
{:else if key === 'wms'}
  <div class="mt-6">
    <CustomFieldsEditor module="wms" />
  </div>
{:else if key === 'yard'}
  <div class="mt-6">
    <CustomFieldsEditor module="yard" />
  </div>
{:else if key === 'fleet'}
  <div class="mt-6">
    <CustomFieldsEditor module="fleet" />
  </div>
{/if}
