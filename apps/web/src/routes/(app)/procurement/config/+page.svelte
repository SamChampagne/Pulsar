<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
</script>

<PageHeader
  title="Configuration"
  eyebrow="Achats"
  subtitle="Réglages du module et personnalisation des données."
/>
<ModuleSettings module="procurement" />
<div class="mt-6">
  <CustomFieldsEditor module="procurement" />
</div>
