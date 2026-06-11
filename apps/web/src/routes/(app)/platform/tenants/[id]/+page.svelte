<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface ModuleRow {
    key: string;
    name: string;
    isCore: boolean;
    available: boolean;
    enabled: boolean;
  }
  interface TenantDetail {
    id: string;
    slug: string;
    name: string;
    status: string;
    createdAt: string;
    userCount: number;
    modules: ModuleRow[];
  }

  const id = $derived(page.params.id);
  let tenant = $state<TenantDetail | null>(null);
  let error = $state('');
  let renaming = $state(false);
  let newName = $state('');

  async function load() {
    try {
      tenant = await api<TenantDetail>(`/platform/tenants/${id}`);
      newName = tenant.name;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load tenant';
    }
  }

  async function setStatus(action: 'suspend' | 'activate') {
    try {
      tenant = await api<TenantDetail>(`/platform/tenants/${id}/${action}`, { method: 'POST' });
      toast.success(`Tenant ${action === 'suspend' ? 'suspended' : 'activated'}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action failed');
    }
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    try {
      tenant = await api<TenantDetail>(`/platform/tenants/${id}`, {
        method: 'PATCH',
        body: { name: newName },
      });
      renaming = false;
      toast.success('Tenant renamed');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Rename failed');
    }
  }

  async function toggleModule(mod: ModuleRow) {
    try {
      tenant = await api<TenantDetail>(`/platform/tenants/${id}/modules/${mod.key}`, {
        method: 'PATCH',
        body: { enabled: !mod.enabled },
      });
      toast.success(`${mod.name} ${mod.enabled ? 'disabled' : 'enabled'}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    }
  }

  $effect(() => {
    if (id) void load();
  });
</script>

<p><a href="/platform/tenants">← Tenants</a></p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if tenant}
  <div class="page-header">
    <div>
      <h1 style="margin-bottom: 4px;">{tenant.name}</h1>
      <span class="muted"
        >{tenant.slug} · {tenant.userCount} users · created {new Date(
          tenant.createdAt,
        ).toLocaleDateString()}</span
      >
    </div>
    <StatusBadge status={tenant.status} />
  </div>

  <div class="card" style="margin-bottom: 18px;">
    <h2 style="margin-top: 0;">Lifecycle</h2>
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      {#if tenant.status === 'SUSPENDED'}
        <button class="btn" onclick={() => setStatus('activate')}>Activate</button>
        <span class="muted">Suspended tenants cannot sign in.</span>
      {:else}
        <button class="btn btn-danger" onclick={() => setStatus('suspend')}>Suspend</button>
        <span class="muted">Blocks all logins for this tenant immediately.</span>
      {/if}
    </div>

    <div style="margin-top: 14px;">
      {#if renaming}
        <form style="display: flex; gap: 8px; align-items: center;" onsubmit={rename}>
          <input bind:value={newName} required minlength="2" />
          <button class="btn btn-sm" type="submit">Save</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick={() => (renaming = false)}>
            Cancel
          </button>
        </form>
      {:else}
        <button class="btn btn-secondary btn-sm" onclick={() => (renaming = true)}>Rename</button>
      {/if}
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top: 0;">Modules</h2>
    <table>
      <thead>
        <tr><th>Module</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        {#each tenant.modules as mod (mod.key)}
          <tr>
            <td><strong>{mod.name}</strong></td>
            <td>
              {#if mod.isCore}
                <span class="badge badge-muted">CORE</span>
              {:else if mod.enabled}
                <span class="badge badge-success">ENABLED</span>
              {:else if mod.available}
                <span class="badge badge-muted">DISABLED</span>
              {:else}
                <span class="badge badge-warning">PLANNED</span>
              {/if}
            </td>
            <td style="text-align: right;">
              {#if !mod.isCore && mod.available}
                <button class="btn btn-secondary btn-sm" onclick={() => toggleModule(mod)}>
                  {mod.enabled ? 'Disable' : 'Enable'}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
