<script lang="ts">
  import { api, ApiError } from '$lib/api/client';

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

  async function load() {
    try {
      modules = await api<ModuleRow[]>('/modules');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load modules';
    }
  }

  async function toggle(module: ModuleRow) {
    error = '';
    try {
      await api(`/modules/${module.key}`, {
        method: 'PATCH',
        body: { enabled: !module.enabled },
      });
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to toggle module';
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Modules</h1>
</div>

<p class="muted">
  Modules can be enabled or disabled per tenant. Changes to the navigation take effect at next
  sign-in.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<div class="modules-grid">
  {#each modules as module (module.key)}
    <div class="card module-card" class:dimmed={!module.available && !module.isCore}>
      <div class="module-head">
        <h2 style="margin: 0;">{module.name}</h2>
        {#if module.isCore}
          <span class="badge badge-muted">CORE</span>
        {:else if module.enabled}
          <span class="badge badge-success">ENABLED</span>
        {:else if module.available}
          <span class="badge badge-muted">DISABLED</span>
        {:else}
          <span class="badge badge-warning">PLANNED</span>
        {/if}
      </div>
      <p class="muted">{module.description}</p>
      {#if !module.isCore && module.available}
        <button class="btn btn-secondary btn-sm" onclick={() => toggle(module)}>
          {module.enabled ? 'Disable' : 'Enable'}
        </button>
      {/if}
    </div>
  {/each}
</div>

{#if modules.length === 0 && !error}
  <p class="muted">Loading modules…</p>
{/if}

<style>
  .modules-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .module-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .dimmed {
    opacity: 0.65;
  }
</style>
