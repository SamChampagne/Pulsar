<script lang="ts">
  import { goto } from '$app/navigation';
  import { getPlatformToken, platformApi, PlatformApiError } from '$lib/api/platform';
  import {
    Badge,
    Button,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Skeleton,
    Table,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

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
  let loadingData = $state(true);

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
    loadingData = true;
    try {
      tenants = await platformApi<TenantRow[]>('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to load tenants';
    } finally {
      loadingData = false;
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

<!-- Platform context marker: thin danger top border -->
<div class="border-t-4 border-danger">
  <div class="mx-auto max-w-4xl px-6 py-6">
    <!-- Platform identity header -->
    <div class="mb-6 flex items-center gap-3 border-b border-edge pb-4">
      <span class="text-xl font-bold text-ink">
        <span class="text-accent">⬢</span> PULSAR
      </span>
      <Badge tone="danger">Platform admin</Badge>
    </div>

    <PageHeader title="Tenants" count={loadingData ? undefined : tenants.length}>
      {#snippet actions()}
        <Button variant="primary" onclick={() => { showForm = true; }}>New tenant</Button>
      {/snippet}
    </PageHeader>

    {#if error}
      <p class="mb-4 text-sm text-danger">{error}</p>
    {/if}

    {#if inviteUrl}
      <div class="mb-4 rounded-card border border-ok bg-ok-soft p-4">
        <p class="mb-1 text-sm font-semibold text-ok">Tenant created. Admin invitation link (also emailed):</p>
        <code class="break-all text-xs text-ink">{inviteUrl}</code>
      </div>
    {/if}

    {#if loadingData}
      <Skeleton rows={5} />
    {:else}
      <Table>
        {#snippet head()}
          <th>Slug</th>
          <th>Name</th>
          <th>Status</th>
          <th>Users</th>
          <th>Modules</th>
          <th></th>
        {/snippet}
        {#snippet body()}
          {#each tenants as tenant (tenant.id)}
            <tr>
              <td><span class="font-mono text-xs font-semibold text-ink">{tenant.slug}</span></td>
              <td class="font-medium text-ink">{tenant.name}</td>
              <td><Badge tone={toneFor(tenant.status)}>{labelFor(tenant.status)}</Badge></td>
              <td class="text-ink-muted">{tenant.userCount}</td>
              <td class="text-xs text-ink-muted">{tenant.enabledModules.join(', ')}</td>
              <td class="text-right">
                {#if tenant.status === 'SUSPENDED'}
                  <Button variant="secondary" onclick={() => setStatus(tenant, 'reactivate')}>
                    Reactivate
                  </Button>
                {:else}
                  <Button variant="danger" onclick={() => setStatus(tenant, 'suspend')}>
                    Suspend
                  </Button>
                {/if}
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="6">
                <EmptyState message="No tenants yet. Create the first one." />
              </td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}
  </div>
</div>

<!-- Create tenant modal -->
<Modal bind:open={showForm} title="New tenant">
  <form onsubmit={createTenant} class="space-y-4">
    <Field label="Slug">
      <Input bind:value={slug} required placeholder="acme" />
    </Field>
    <Field label="Name">
      <Input bind:value={name} required placeholder="Acme Corp" />
    </Field>

    <fieldset class="space-y-2">
      <legend class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Modules</legend>
      <div class="flex flex-wrap gap-3">
        {#each availableModules as key (key)}
          <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" value={key} bind:group={modules} class="rounded border-edge accent-accent" />
            {key}
          </label>
        {/each}
      </div>
    </fieldset>

    <Field label="Admin email">
      <Input type="email" bind:value={adminEmail} required placeholder="admin@acme.com" />
    </Field>
    <Field label="Admin first name">
      <Input bind:value={adminFirstName} required placeholder="Jane" />
    </Field>
    <Field label="Admin last name">
      <Input bind:value={adminLastName} required placeholder="Doe" />
    </Field>

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
      <Button type="submit" variant="primary">Create tenant</Button>
    </div>
  </form>
</Modal>
