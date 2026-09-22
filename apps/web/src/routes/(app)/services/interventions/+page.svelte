<script lang="ts">
  import { PageHeader } from '$lib/components/ui';
  import JobsWorkspace from '$lib/components/business/JobsWorkspace.svelte';
</script>

<svelte:head><title>Interventions | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl">
  <PageHeader
    title="Interventions"
    subtitle="Le travail planifié, les équipes et les comptes rendus de tous vos projets."
  /><JobsWorkspace />
</div>
