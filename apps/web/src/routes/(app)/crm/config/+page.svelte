<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
</script>

<PageHeader title="Configuration" eyebrow="CRM" />
<p class="mb-5 text-sm text-ink-muted">
  Les colonnes et leurs automatisations se configurent directement dans le <a
    class="text-accent hover:underline"
    href="/crm/pipeline">pipeline CRM</a
  >. Les comptes externes sont regroupés dans
  <a class="text-accent hover:underline" href="/connect">Connexions</a>.
</p>

<ModuleSettings module="crm" />
<div class="mt-6">
  <CustomFieldsEditor module="crm" />
</div>
