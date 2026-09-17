<script lang="ts">
  import { sessionClient } from '$lib/portal/client';
  import ChangeRequestForm from '$lib/portal/components/ChangeRequestForm.svelte';
  import { portalView } from '$lib/portal/session';

  const client = sessionClient();
</script>

{#if $portalView}
  <ChangeRequestForm {client} view={$portalView} />
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
