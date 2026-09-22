<script lang="ts">
  import { PageHeader, Button } from '$lib/components/ui';
  import TimeWorkspace from '$lib/components/business/TimeWorkspace.svelte';
  import { page } from '$app/state';
</script>

<svelte:head><title>Temps de travail | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl">
  <PageHeader
    title="Feuilles de temps"
    subtitle="Les heures réellement déclarées, reliées aux interventions et aux projets."
  >
    {#snippet actions()}<Button variant="secondary" href="/services/interventions"
        >Ouvrir les interventions</Button
      >{/snippet}
  </PageHeader>
  <TimeWorkspace projectId={page.url.searchParams.get('projectId') ?? undefined} />
</div>
