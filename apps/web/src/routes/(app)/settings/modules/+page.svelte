<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Badge,
    Card,
    Skeleton,
    EmptyState,
  } from '$lib/components/ui';

  interface ModuleRow {
    key: string;
    name: string;
    description: string;
    isCore: boolean;
    available: boolean;
    enabled: boolean;
  }

  let modules = $state<ModuleRow[]>([]);
  let error = $state('');
  let loading = $state(true);

  async function load() {
    try {
      modules = await api<ModuleRow[]>('/modules');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des modules';
    } finally {
      loading = false;
    }
  }

  async function toggle(module: ModuleRow) {
    error = '';
    try {
      await api(`/modules/${module.key}`, {
        method: 'PATCH',
        body: { enabled: !module.enabled },
      });
      toast.success(module.enabled ? `${module.name} désactivé` : `${module.name} activé`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la modification du module';
      error = msg;
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Modules" count={modules.length} />

<p class="mb-4 text-sm text-ink-muted">
  Les modules s'activent ou se désactivent par tenant. Les changements de navigation prennent
  effet à la prochaine connexion.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2">
    {#each Array(4) as _, i (i)}
      <Card padded={false}><Skeleton rows={3} /></Card>
    {/each}
  </div>
{:else if modules.length === 0}
  <Card>
    <EmptyState message="Aucun module disponible." />
  </Card>
{:else}
  <div class="grid gap-3 sm:grid-cols-2">
    {#each modules as module (module.key)}
      <Card>
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <div class="mb-1 flex items-center gap-2">
              <span class="font-semibold text-ink">{module.name}</span>
              {#if module.isCore}
                <Badge tone="neutral">Cœur</Badge>
              {:else if module.enabled}
                <Badge tone="ok">Activé</Badge>
              {:else if module.available}
                <Badge tone="neutral">Désactivé</Badge>
              {:else}
                <Badge tone="warn">Planifié</Badge>
              {/if}
            </div>
            <p class="text-sm text-ink-muted">{module.description}</p>
          </div>
          {#if !module.isCore && module.available}
            <Button
              variant={module.enabled ? 'secondary' : 'primary'}
              onclick={() => void toggle(module)}
            >{module.enabled ? 'Désactiver' : 'Activer'}</Button>
          {/if}
        </div>
      </Card>
    {/each}
  </div>
{/if}
