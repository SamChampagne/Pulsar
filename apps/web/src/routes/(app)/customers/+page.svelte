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
    ErrorNotice,
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
  const activeCount = $derived(customers.filter((c) => c.isActive).length);
  const portalReadyCount = $derived(customers.filter((c) => c.email).length);

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

<PageHeader
  title="Customers"
  subtitle="Maintain shipper accounts, contacts, and portal links used by transport orders."
  count={total}
>
  {#snippet actions()}
    <Button onclick={() => { showForm = true; }}>New customer</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{activeCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Active customers</div><p class="mt-1 text-xs text-ink-faint">Available for new transport orders.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{portalReadyCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Portal-ready</div><p class="mt-1 text-xs text-ink-faint">Have email/contact context for sharing.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{hasPortal ? 'On' : 'Off'}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Customer portal</div><p class="mt-1 text-xs text-ink-faint">Controls whether portal links are available.</p></Card>
</div>

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
          <EmptyState title="No customers yet" message="Add a customer before creating transport orders or sharing customer portal links.">
            {#snippet children()}<Button onclick={() => { showForm = true; }}>Add first customer</Button>{/snippet}
          </EmptyState>
        </td>
      </tr>
    {/each}
  {/snippet}
</Table>
{/if}

<Modal bind:open={showForm} title="New customer">
  {#snippet children()}
    <form onsubmit={create}>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Code">
          <Input bind:value={form.code} required placeholder="CUST-002" />
        </Field>
        <Field label="Name">
          <Input bind:value={form.name} required />
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
