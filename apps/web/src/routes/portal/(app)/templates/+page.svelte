<script lang="ts">
  import { Card, EmptyState, PageHeader } from '$lib/components/ui';
  import { sessionClient } from '$lib/portal/client';
  import TemplatesPanel from '$lib/portal/components/TemplatesPanel.svelte';
  import type { Template } from '$lib/portal/types';

  const client = sessionClient();

  // `TemplatesPanel` owns the load; binding lets the page decide between the
  // panel and an empty state without a second round-trip.
  let templates = $state<Template[]>([]);
</script>

<PageHeader
  title="Modèles de demande"
  subtitle="Vos itinéraires récurrents, pré-remplis au moment de créer une demande de transport."
  count={templates.length}
/>

<Card>
  <TemplatesPanel {client} bind:templates />
  {#if templates.length === 0}
    <EmptyState
      title="Aucun modèle"
      message="Créez une demande de transport, puis « Enregistrer comme modèle » pour la rejouer en un clic."
    >
      <a href="/portal/orders" class="text-sm font-medium text-accent hover:underline"
        >Aller aux commandes</a
      >
    </EmptyState>
  {/if}
</Card>
