<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { MODULE_KEYS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    FilterBar,
    Field,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Modal,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  interface CustomerRow {
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    isActive: boolean;
  }

  let customers = $state<CustomerRow[]>([]);
  let total = $state(0);
  let search = $state('');
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);
  let form = $state({ code: '', name: '', contactName: '', email: '' });

  const hasPortal = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.CUSTOMER_PORTAL) ?? false,
  );

  async function portalLink(customer: CustomerRow) {
    try {
      const { url } = await api<{ url: string }>(
        `/customer-portal/customers/${customer.id}/portal-link`,
        { method: 'POST' },
      );
      await navigator.clipboard.writeText(url);
      toast.success(`Portal link for ${customer.name} copied`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create portal link');
    }
  }

  async function load() {
    try {
      const result = await api<Paginated<CustomerRow>>('/transportation/customers', {
        query: { search, pageSize: 50 },
      });
      customers = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load customers';
    } finally {
      loading = false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      await api('/transportation/customers', {
        method: 'POST',
        body: {
          code: form.code,
          name: form.name,
          contactName: form.contactName || undefined,
          email: form.email || undefined,
        },
      });
      showForm = false;
      form = { code: '', name: '', contactName: '', email: '' };
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to create customer';
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Customers" count={total}>
  {#snippet actions()}
    <Button onclick={() => { showForm = true; }}>New customer</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Search name or code…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Code</th><th>Name</th><th>Contact</th><th>Email</th><th>Active</th>
    {#if hasPortal}<th></th>{/if}
  {/snippet}
  {#snippet body()}
    {#each customers as customer (customer.id)}
      <tr>
        <td class="font-semibold">{customer.code}</td>
        <td>{customer.name}</td>
        <td>{customer.contactName ?? '—'}</td>
        <td>{customer.email ?? '—'}</td>
        <td>
          <Badge tone={customer.isActive ? 'ok' : 'danger'}>
            {customer.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </td>
        {#if hasPortal}
          <td class="text-right">
            <Button variant="secondary" onclick={() => portalLink(customer)}>
              Portal link
            </Button>
          </td>
        {/if}
      </tr>
    {:else}
      <tr>
        <td colspan={hasPortal ? 6 : 5}>
          <EmptyState message="No customers yet." />
        </td>
      </tr>
    {/each}
  {/snippet}
</Table>
{/if}

<Modal bind:open={showForm} title="New customer">
  {#snippet children()}
    <form id="customer-form" onsubmit={create}>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Code">
          <input
            bind:value={form.code}
            required
            placeholder="CUST-002"
            class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </Field>
        <Field label="Name">
          <input
            bind:value={form.name}
            required
            class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </Field>
        <Field label="Contact">
          <Input bind:value={form.contactName} />
        </Field>
        <Field label="Email">
          <Input type="email" bind:value={form.email} />
        </Field>
      </div>
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
        <Button variant="primary" type="submit">Create</Button>
      </div>
    </form>
  {/snippet}
</Modal>
