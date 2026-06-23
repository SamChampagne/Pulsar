<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
</script>

<PageHeader title="Configuration" eyebrow="CRM" />

<CustomFieldsEditor module="crm" />
