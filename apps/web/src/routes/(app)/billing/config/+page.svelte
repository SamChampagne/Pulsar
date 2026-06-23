<script lang="ts">
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
</script>

<h1 class="mb-4 text-xl font-semibold text-ink">Configuration</h1>
<ModuleSettings module="billing" />
<div class="mt-6">
  <CustomFieldsEditor module="billing" />
</div>
