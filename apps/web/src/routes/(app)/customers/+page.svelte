<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { MODULE_KEYS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';

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

<div class="page-header">
  <h1>Customers <span class="muted">({total})</span></h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>New customer</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={create}>
    <h2 style="margin-top: 0;">New customer</h2>
    <div class="form-grid">
      <div class="field">
        <label for="code">Code</label>
        <input id="code" bind:value={form.code} required placeholder="CUST-002" />
      </div>
      <div class="field">
        <label for="name">Name</label>
        <input id="name" bind:value={form.name} required />
      </div>
      <div class="field">
        <label for="contact">Contact</label>
        <input id="contact" bind:value={form.contactName} />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" bind:value={form.email} />
      </div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" type="submit">Create</button>
      <button class="btn btn-secondary" type="button" onclick={() => (showForm = false)}>
        Cancel
      </button>
    </div>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <div style="padding: 14px 12px;">
    <input
      placeholder="Search name or code…"
      bind:value={search}
      onkeydown={(e) => e.key === 'Enter' && load()}
      style="max-width: 320px;"
    />
  </div>
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>Contact</th>
        <th>Email</th>
        <th>Active</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each customers as customer (customer.id)}
        <tr>
          <td><strong>{customer.code}</strong></td>
          <td>{customer.name}</td>
          <td>{customer.contactName ?? '—'}</td>
          <td>{customer.email ?? '—'}</td>
          <td>
            <span class="badge {customer.isActive ? 'badge-success' : 'badge-danger'}">
              {customer.isActive ? 'YES' : 'NO'}
            </span>
          </td>
          <td style="text-align: right;">
            {#if hasPortal}
              <button class="btn btn-secondary btn-sm" onclick={() => portalLink(customer)}>
                Portal link
              </button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No customers yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;
  }
</style>
