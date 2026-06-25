<script lang="ts">
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
  import ModesOfPayment from '$lib/components/billing/ModesOfPayment.svelte';
</script>

<h1 class="mb-4 text-xl font-semibold text-ink">Configuration</h1>
<ModuleSettings module="billing" />
<div class="mt-6">
  <CustomFieldsEditor module="billing" />
</div>
<div class="mt-6"><ModesOfPayment /></div>
