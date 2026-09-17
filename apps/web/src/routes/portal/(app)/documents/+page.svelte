<script lang="ts">
  import { sessionClient } from '$lib/portal/client';
  import DocumentsPanel from '$lib/portal/components/DocumentsPanel.svelte';
  import { portalView } from '$lib/portal/session';

  const client = sessionClient();
</script>

{#if $portalView}
  <DocumentsPanel {client} view={$portalView} />
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
