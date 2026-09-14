<script lang="ts">
  import { PERMISSIONS, type DossierRootType } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { Button } from '$lib/components/ui';
  import DossierPanel from './DossierPanel.svelte';
  let { entityType, entityId }: { entityType: DossierRootType; entityId: string } = $props();
  let open = $state(false);
  const visible = $derived(
    $auth?.tenant.enabledModules.includes('analytics') &&
      $auth.user.permissions.includes(PERMISSIONS.ANALYTICS.READ),
  );
</script>

{#if visible}<Button
    variant="secondary"
    onclick={() => {
      open = true;
    }}>Dossier connecté</Button
  ><DossierPanel bind:open {entityType} {entityId} />{/if}
