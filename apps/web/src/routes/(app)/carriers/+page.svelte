<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
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
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  interface CarrierRow {
    id: string;
    code: string;
    name: string;
    scacCode: string | null;
    contactName: string | null;
    phone: string | null;
    status: string;
  }

  let carriers = $state<CarrierRow[]>([]);
  let total = $state(0);
  let search = $state('');
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);
  let form = $state({ code: '', name: '', scacCode: '', contactName: '', phone: '' });

  const activeCount = $derived(carriers.filter((c) => c.status === 'ACTIVE').length);
  const scacCount = $derived(carriers.filter((c) => c.scacCode).length);
  const contactReadyCount = $derived(carriers.filter((c) => c.contactName || c.phone).length);

  async function load() {
    try {
      const result = await api<Paginated<CarrierRow>>('/transportation/carriers', {
        query: { search, pageSize: 50 },
      });
      carriers = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load carriers';
    } finally {
      loading = false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      await api('/transportation/carriers', {
        method: 'POST',
        body: {
          code: form.code,
          name: form.name,
          scacCode: form.scacCode || undefined,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
        },
      });
      showForm = false;
      form = { code: '', name: '', scacCode: '', contactName: '', phone: '' };
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to create carrier';
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Carriers"
  subtitle="Maintain the partner network used to tender and execute loads."
  count={total}
>
  {#snippet actions()}
    <Button onclick={() => { showForm = true; }}>New carrier</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{activeCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Active carriers</div><p class="mt-1 text-xs text-ink-faint">Available for tendering.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{scacCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">SCAC mapped</div><p class="mt-1 text-xs text-ink-faint">Ready for structured carrier exchange.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{contactReadyCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Contact-ready</div><p class="mt-1 text-xs text-ink-faint">Have a dispatcher contact or phone.</p></Card>
</div>

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Search name, code, SCAC…"
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
    <th>Code</th><th>Name</th><th>SCAC</th><th>Contact</th><th>Phone</th><th>Status</th>
  {/snippet}
  {#snippet body()}
    {#each carriers as carrier (carrier.id)}
      <tr>
        <td class="font-semibold">{carrier.code}</td>
        <td>{carrier.name}</td>
        <td>{carrier.scacCode ?? '—'}</td>
        <td>{carrier.contactName ?? '—'}</td>
        <td>{carrier.phone ?? '—'}</td>
        <td><Badge tone={toneFor(carrier.status)}>{labelFor(carrier.status)}</Badge></td>
      </tr>
    {:else}
      <tr><td colspan="6"><EmptyState title="No carriers yet" message="Add carriers before tendering loads or comparing execution partners.">
        {#snippet children()}<Button onclick={() => { showForm = true; }}>Add first carrier</Button>{/snippet}
      </EmptyState></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

<Modal bind:open={showForm} title="New carrier">
  {#snippet children()}
    <form onsubmit={create}>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Code">
          <Input bind:value={form.code} required placeholder="CARR-002" />
        </Field>
        <Field label="Name">
          <Input bind:value={form.name} required />
        </Field>
        <Field label="SCAC">
          <Input bind:value={form.scacCode} />
        </Field>
        <Field label="Contact">
          <Input bind:value={form.contactName} />
        </Field>
        <Field label="Phone">
          <Input bind:value={form.phone} />
        </Field>
      </div>
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
        <Button variant="primary" type="submit">Create</Button>
      </div>
    </form>
  {/snippet}
</Modal>
