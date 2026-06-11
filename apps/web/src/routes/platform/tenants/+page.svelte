<script lang="ts">
  import { goto } from '$app/navigation';
  import { getPlatformToken, platformApi, PlatformApiError } from '$lib/api/platform';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface TenantRow {
    id: string;
    slug: string;
    name: string;
    status: string;
    userCount: number;
    enabledModules: string[];
  }

  let tenants = $state<TenantRow[]>([]);
  let error = $state('');
  let inviteUrl = $state('');
  let showForm = $state(false);

  let slug = $state('');
  let name = $state('');
  let adminEmail = $state('');
  let adminFirstName = $state('');
  let adminLastName = $state('');
  let modules = $state<string[]>(['transportation']);
  const availableModules = ['transportation', 'customer-portal', 'billing'];

  async function load() {
    if (!getPlatformToken()) {
      void goto('/platform/login');
      return;
    }
    try {
      tenants = await platformApi<TenantRow[]>('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to load tenants';
    }
  }

  async function createTenant(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const created = await platformApi<TenantRow & { inviteUrl: string }>('/platform/tenants', {
        method: 'POST',
        body: {
          slug,
          name,
          modules,
          admin: { email: adminEmail, firstName: adminFirstName, lastName: adminLastName },
        },
      });
      inviteUrl = created.inviteUrl;
      showForm = false;
      slug = '';
      name = '';
      adminEmail = '';
      adminFirstName = '';
      adminLastName = '';
      modules = ['transportation'];
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to create tenant';
    }
  }

  async function setStatus(tenant: TenantRow, action: 'suspend' | 'reactivate') {
    error = '';
    try {
      await platformApi(`/platform/tenants/${tenant.id}/${action}`, { method: 'POST' });
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : `Failed to ${action}`;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Tenants</h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>
    {showForm ? 'Cancel' : 'New tenant'}
  </button>
</div>

{#if error}<p class="error-text">{error}</p>{/if}
{#if inviteUrl}
  <div class="card" style="padding: 12px; margin-bottom: 16px;">
    <strong>Tenant created.</strong> Admin invitation link (also emailed):
    <code style="word-break: break-all;">{inviteUrl}</code>
  </div>
{/if}

{#if showForm}
  <form class="card" style="padding: 16px; margin-bottom: 16px;" onsubmit={createTenant}>
    <label>Slug <input bind:value={slug} required pattern="[a-z0-9-]+" /></label>
    <label>Name <input bind:value={name} required /></label>
    <fieldset>
      <legend>Modules</legend>
      {#each availableModules as key (key)}
        <label style="display: inline-flex; gap: 4px; margin-right: 12px;">
          <input type="checkbox" value={key} bind:group={modules} />{key}
        </label>
      {/each}
    </fieldset>
    <label>Admin email <input type="email" bind:value={adminEmail} required /></label>
    <label>Admin first name <input bind:value={adminFirstName} required /></label>
    <label>Admin last name <input bind:value={adminLastName} required /></label>
    <button class="btn" type="submit">Create</button>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr><th>Slug</th><th>Name</th><th>Status</th><th>Users</th><th>Modules</th><th></th></tr>
    </thead>
    <tbody>
      {#each tenants as tenant (tenant.id)}
        <tr>
          <td><strong>{tenant.slug}</strong></td>
          <td>{tenant.name}</td>
          <td><StatusBadge status={tenant.status} /></td>
          <td>{tenant.userCount}</td>
          <td>{tenant.enabledModules.join(', ')}</td>
          <td style="text-align: right;">
            {#if tenant.status === 'SUSPENDED'}
              <button class="btn btn-sm" onclick={() => setStatus(tenant, 'reactivate')}>
                Reactivate
              </button>
            {:else}
              <button class="btn btn-sm" onclick={() => setStatus(tenant, 'suspend')}>
                Suspend
              </button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No tenants.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
