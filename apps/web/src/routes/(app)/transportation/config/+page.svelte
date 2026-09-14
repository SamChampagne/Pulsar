<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
</script>

<PageHeader
  title="Configuration"
  eyebrow="Transport"
  subtitle="Réglages du module et personnalisation des données."
/>
<ModuleSettings module="transportation" />
<div class="mt-6">
  <CustomFieldsEditor module="transportation" />
</div>
