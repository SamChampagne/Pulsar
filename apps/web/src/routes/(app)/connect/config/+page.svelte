<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
</script>

<PageHeader
  title="Configuration"
  eyebrow="Connexions"
  subtitle="Réglages du module et personnalisation des données."
/>
<ModuleSettings module="connect" />
