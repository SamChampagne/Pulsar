<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
  import ModesOfPayment from '$lib/components/billing/ModesOfPayment.svelte';
  import TaxTemplates from '$lib/components/billing/TaxTemplates.svelte';
</script>

<PageHeader
  title="Configuration"
  eyebrow="Facturation"
  subtitle="Réglages du module et personnalisation des données."
/>
<ModuleSettings module="billing" />
<div class="mt-6">
  <CustomFieldsEditor module="billing" />
</div>
<div class="mt-6"><ModesOfPayment /></div>
<div class="mt-6"><TaxTemplates /></div>
