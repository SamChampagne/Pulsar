<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
</script>

<PageHeader title="Configuration" eyebrow="CRM" />

<ModuleSettings module="crm" />
<div class="mt-6">
  <CustomFieldsEditor module="crm" />
</div>
