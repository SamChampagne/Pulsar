<script lang="ts">
  import type { DossierRootType, WorkflowDossier } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Drawer, ErrorNotice, Skeleton } from '$lib/components/ui';
  import DossierContent from './DossierContent.svelte';
  let {
    open = $bindable(false),
    entityType,
    entityId,
  }: { open?: boolean; entityType: DossierRootType; entityId: string } = $props();
  let data = $state<WorkflowDossier | null>(null);
  let error = $state('');
  let loading = $state(false);
  let revision = $state(0);
  $effect(() => {
    if (!open || !entityId) return;
    revision;
    let active = true;
    data = null;
    loading = true;
    error = '';
    void api<WorkflowDossier>('/analytics/flow/dossier', { query: { entityType, entityId } })
      .then((value) => {
        if (active) data = value;
      })
      .catch((e) => {
        if (active)
          error = e instanceof ApiError ? e.message : 'Impossible de charger le dossier connecté.';
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });
</script>

<Drawer bind:open title="Dossier intermodule" width="xl"
  ><ErrorNotice
    message={error}
    onretry={() => {
      revision++;
    }}
  />{#if loading}<Skeleton rows={7} />{:else if data}<DossierContent {data} />{/if}</Drawer
>
