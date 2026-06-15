<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
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
  let saving = $state(false);
  let form = $state({ code: '', name: '', scacCode: '', contactName: '', phone: '' });

  async function load() {
    try {
      const result = await api<Paginated<CarrierRow>>('/transportation/carriers', {
        query: { search, pageSize: 50 },
      });
      carriers = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des transporteurs';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    form = { code: '', name: '', scacCode: '', contactName: '', phone: '' };
    error = '';
    showForm = true;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
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
      toast.success('Transporteur créé');
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création du transporteur';
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

<PageHeader title="Transporteurs" count={total}>
  {#snippet actions()}
    <Button onclick={openNew}>Nouveau transporteur</Button>
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Rechercher nom, code, SCAC…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if carriers.length === 0}
  <Card>
    <EmptyState message="Aucun transporteur pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Nouveau transporteur</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>SCAC</th><th>Contact</th><th>Téléphone</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each carriers as carrier (carrier.id)}
        <tr>
          <td class="font-mono font-semibold text-ink">{carrier.code}</td>
          <td>{carrier.name}</td>
          <td class="font-mono text-ink-muted">{carrier.scacCode ?? '—'}</td>
          <td>{carrier.contactName ?? '—'}</td>
          <td class="font-mono text-ink-muted">{carrier.phone ?? '—'}</td>
          <td><Badge tone={toneFor(carrier.status)}>{labelFor(carrier.status)}</Badge></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Panel bind:open={showForm} title="Nouveau transporteur">
  {#snippet children()}
    <form onsubmit={create} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Code">
        <Input bind:value={form.code} required placeholder="CARR-002" />
      </Field>
      <Field label="Nom">
        <Input bind:value={form.name} required />
      </Field>
      <Field label="SCAC">
        <Input bind:value={form.scacCode} />
      </Field>
      <Field label="Contact">
        <Input bind:value={form.contactName} />
      </Field>
      <Field label="Téléphone">
        <Input bind:value={form.phone} />
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Annuler</Button>
        <Button variant="primary" type="submit" loading={saving}>Créer</Button>
      </div>
    </form>
  {/snippet}
</Panel>
