<script lang="ts">
  import { MODULE_CATALOG, type Paginated, type PlatformTenantSummary } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface Overview {
    tenants: number;
    active: number;
    suspended: number;
    users: number;
    enabledModules: number;
  }

  // Business modules a tenant can be provisioned with (core is always on).
  const selectableModules = MODULE_CATALOG.filter((m) => m.available && !m.isCore);

  let tenants = $state<PlatformTenantSummary[]>([]);
  let overview = $state<Overview | null>(null);
  let error = $state('');
  let showForm = $state(false);
  let inviteUrl = $state('');
  let form = $state({
    slug: '',
    name: '',
    status: 'TRIAL',
    modules: [] as string[],
    adminEmail: '',
    adminFirstName: '',
    adminLastName: '',
    adminPassword: '',
  });

  async function load() {
    try {
      const [list, stats] = await Promise.all([
        api<Paginated<PlatformTenantSummary>>('/platform/tenants', { query: { pageSize: 100 } }),
        api<Overview>('/platform/overview'),
      ]);
      tenants = list.items;
      overview = stats;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load tenants';
    }
  }

  function toggleModule(key: string) {
    form.modules = form.modules.includes(key)
      ? form.modules.filter((m) => m !== key)
      : [...form.modules, key];
  }

  async function createTenant(event: SubmitEvent) {
    event.preventDefault();
    try {
      const created = await api<PlatformTenantSummary & { inviteUrl?: string }>(
        '/platform/tenants',
        {
          method: 'POST',
          body: {
            slug: form.slug,
            name: form.name,
            status: form.status,
            modules: form.modules.length > 0 ? form.modules : undefined,
            admin: {
              email: form.adminEmail,
              firstName: form.adminFirstName,
              lastName: form.adminLastName,
              password: form.adminPassword ? form.adminPassword : undefined,
            },
          },
        },
      );
      inviteUrl = created.inviteUrl ?? '';
      toast.success(`Tenant "${form.name}" created`);
      form = {
        slug: '',
        name: '',
        status: 'TRIAL',
        modules: [],
        adminEmail: '',
        adminFirstName: '',
        adminLastName: '',
        adminPassword: '',
      };
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create tenant');
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success('Activation link copied');
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Tenants</h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>Create tenant</button>
</div>

<p class="muted">
  Cross-tenant administration. Provision new workspaces, suspend access and toggle modules without
  touching the seed.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if overview}
  <div class="stats">
    <div class="card stat"><span class="stat-num">{overview.tenants}</span> tenants</div>
    <div class="card stat"><span class="stat-num">{overview.active}</span> active</div>
    <div class="card stat"><span class="stat-num">{overview.suspended}</span> suspended</div>
    <div class="card stat"><span class="stat-num">{overview.users}</span> users</div>
  </div>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={createTenant}>
    <h2 style="margin-top: 0;">Create a tenant</h2>
    <p class="muted">
      Provisions the workspace, an <code>admin</code> role with full access, and the initial administrator.
      Leave the password blank to email them a one-shot activation link instead.
    </p>
    <div class="form-grid">
      <div class="field">
        <label for="slug">Slug</label>
        <input id="slug" bind:value={form.slug} placeholder="acme-eu" required />
      </div>
      <div class="field">
        <label for="name">Name</label>
        <input id="name" bind:value={form.name} placeholder="Acme Europe" required />
      </div>
      <div class="field">
        <label for="status">Status</label>
        <select id="status" bind:value={form.status}>
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>
    </div>

    <div class="field">
      <span class="muted" style="font-size: 12px; font-weight: 550;">Modules</span>
      <div class="modules-row">
        {#each selectableModules as mod (mod.key)}
          <label class="mod-check">
            <input
              type="checkbox"
              checked={form.modules.includes(mod.key)}
              onchange={() => toggleModule(mod.key)}
            />
            {mod.name}
          </label>
        {/each}
      </div>
    </div>

    <h3 style="margin-bottom: 6px;">Initial administrator</h3>
    <div class="form-grid">
      <div class="field">
        <label for="adminEmail">Email</label>
        <input id="adminEmail" type="email" bind:value={form.adminEmail} required />
      </div>
      <div class="field">
        <label for="adminFirstName">First name</label>
        <input id="adminFirstName" bind:value={form.adminFirstName} required />
      </div>
      <div class="field">
        <label for="adminLastName">Last name</label>
        <input id="adminLastName" bind:value={form.adminLastName} required />
      </div>
    </div>
    <div class="field">
      <label for="adminPassword"
        >Password <span class="muted">(optional — invite if blank)</span></label
      >
      <input id="adminPassword" type="password" bind:value={form.adminPassword} minlength="8" />
    </div>

    <div style="display: flex; gap: 8px;">
      <button class="btn" type="submit">Create tenant</button>
      <button class="btn btn-secondary" type="button" onclick={() => (showForm = false)}>
        Close
      </button>
    </div>
    {#if inviteUrl}
      <p style="margin-bottom: 0;">
        <button class="btn btn-secondary btn-sm" type="button" onclick={copyInvite}>
          Copy activation link
        </button>
      </p>
    {/if}
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Slug</th>
        <th>Name</th>
        <th>Status</th>
        <th>Modules</th>
        <th>Users</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody>
      {#each tenants as tenant (tenant.id)}
        <tr>
          <td>
            <a href={`/platform/tenants/${tenant.id}`}><strong>{tenant.slug}</strong></a>
          </td>
          <td>{tenant.name}</td>
          <td><StatusBadge status={tenant.status} /></td>
          <td>{tenant.enabledModules.filter((m) => m !== 'core').join(', ') || '—'}</td>
          <td>{tenant.userCount}</td>
          <td>{new Date(tenant.createdAt).toLocaleDateString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .stats {
    display: flex;
    gap: 12px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }

  .stat {
    flex: 1;
    min-width: 120px;
    font-size: 13px;
    color: var(--color-text-muted, #64748b);
  }

  .stat-num {
    display: block;
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--color-text, #0f172a);
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 16px;
  }

  .modules-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .mod-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  .mod-check input {
    width: auto;
  }
</style>
