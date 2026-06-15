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
    Panel,
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
  let saving = $state(false);
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
      toast.success(`Lien portail de ${customer.name} copié`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création du lien portail');
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
      error = e instanceof ApiError ? e.message : 'Échec du chargement des clients';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    form = { code: '', name: '', contactName: '', email: '' };
    error = '';
    showForm = true;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
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
      toast.success('Client créé');
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création du client';
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Clients" count={total}>
  {#snippet actions()}
    <Button onclick={openNew}>Nouveau client</Button>
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Rechercher nom ou code…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if customers.length === 0}
  <Card>
    <EmptyState message="Aucun client pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Nouveau client</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Contact</th><th>Courriel</th><th>Actif</th>
      {#if hasPortal}<th></th>{/if}
    {/snippet}
    {#snippet body()}
      {#each customers as customer (customer.id)}
        <tr>
          <td class="font-mono font-semibold text-ink">{customer.code}</td>
          <td>{customer.name}</td>
          <td>{customer.contactName ?? '—'}</td>
          <td class="text-ink-muted">{customer.email ?? '—'}</td>
          <td>
            <Badge tone={customer.isActive ? 'ok' : 'danger'}>
              {customer.isActive ? 'Actif' : 'Inactif'}
            </Badge>
          </td>
          {#if hasPortal}
            <td class="text-right">
              <Button variant="secondary" onclick={() => portalLink(customer)}>
                Lien portail
              </Button>
            </td>
          {/if}
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Panel bind:open={showForm} title="Nouveau client">
  {#snippet children()}
    <form onsubmit={create} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Code">
        <Input bind:value={form.code} required placeholder="CUST-002" />
      </Field>
      <Field label="Nom">
        <Input bind:value={form.name} required />
      </Field>
      <Field label="Contact">
        <Input bind:value={form.contactName} />
      </Field>
      <Field label="Courriel">
        <Input type="email" bind:value={form.email} />
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Annuler</Button>
        <Button variant="primary" type="submit" loading={saving}>Créer</Button>
      </div>
    </form>
  {/snippet}
</Panel>
