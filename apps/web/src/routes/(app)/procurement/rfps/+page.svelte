<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Badge,
    Card,
    Table,
    EmptyState,
    Skeleton,
    Modal,
    Field,
    Input,
    Textarea,
    toneFor,
    labelFor,
  } from '$lib/components/ui';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    required: boolean;
    options?: { value: string; label: string }[];
  }

  interface Rfp {
    id: string;
    rfpNumber: string;
    title: string;
    description: string | null;
    status: string;
    deadline: string | null;
    createdAt: string;
    updatedAt: string;
    rfpLanes?: { id: string }[];
    bids?: { id: string }[];
    _count?: { rfpLanes?: number; bids?: number };
  }

  // ─── Data ─────────────────────────────────────────────────────────────────────
  let rfps = $state<Rfp[]>([]);
  let total = $state(0);
  let error = $state('');
  let loading = $state(true);

  // ─── Create panel ─────────────────────────────────────────────────────────────
  let showForm = $state(false);
  let formTitle = $state('');
  let formDescription = $state('');
  let formDeadline = $state('');
  let rfpFieldDefs = $state<CustomFieldDef[]>([]);
  let customData = $state<Record<string, unknown>>({});

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function formatDate(val: string | null | undefined): string {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('fr-CA');
  }

  function lanesCount(rfp: Rfp): string {
    if (rfp._count?.rfpLanes !== undefined) return String(rfp._count.rfpLanes);
    if (rfp.rfpLanes) return String(rfp.rfpLanes.length);
    return '—';
  }

  function bidsCount(rfp: Rfp): string {
    if (rfp._count?.bids !== undefined) return String(rfp._count.bids);
    if (rfp.bids) return String(rfp.bids.length);
    return '—';
  }

  // ─── Load ─────────────────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    try {
      const res = await api<Paginated<Rfp>>('/procurement/rfps');
      rfps = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des appels d\'offres';
    } finally {
      loading = false;
    }
  }

  // ─── Create RFP ───────────────────────────────────────────────────────────────
  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const body: Record<string, unknown> = { title: formTitle.trim() };
      if (formDescription.trim()) body.description = formDescription.trim();
      if (formDeadline) body.deadline = formDeadline;
      if (Object.keys(customData).length > 0) body.customData = customData;
      await api('/procurement/rfps', { method: 'POST', body });
      toast.success('Appel d\'offres créé');
      resetForm();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création';
      toast.error(msg);
    }
  }

  async function openCreateForm() {
    formTitle = '';
    formDescription = '';
    formDeadline = '';
    customData = {};
    rfpFieldDefs = await api<CustomFieldDef[]>('/procurement/custom-fields', { query: { entityType: 'RFP' } }).catch(() => []);
    showForm = true;
  }

  function resetForm() {
    formTitle = '';
    formDescription = '';
    formDeadline = '';
    customData = {};
    showForm = false;
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Appels d'offres" count={total}>
  {#snippet actions()}
    <Button onclick={openCreateForm}>Créer un RFP</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if rfps.length === 0}
  <Card>
    <EmptyState message="Aucun appel d'offres pour le moment.">
      {#snippet children()}
        <Button onclick={openCreateForm}>Créer un RFP</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>RFP #</th>
      <th>Titre</th>
      <th>Statut</th>
      <th>Deadline</th>
      <th>#Lanes</th>
      <th>#Bids</th>
    {/snippet}
    {#snippet body()}
      {#each rfps as rfp (rfp.id)}
        <tr class="cursor-pointer" onclick={() => goto('/procurement/rfps/' + rfp.id)}>
          <td><span class="font-mono text-sm text-ink">{rfp.rfpNumber}</span></td>
          <td><span class="font-semibold text-ink">{rfp.title}</span></td>
          <td><Badge tone={toneFor(rfp.status)}>{labelFor(rfp.status)}</Badge></td>
          <td class="text-sm text-ink-muted">{formatDate(rfp.deadline)}</td>
          <td class="text-sm text-ink-muted">{lanesCount(rfp)}</td>
          <td class="text-sm text-ink-muted">{bidsCount(rfp)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<!-- ─── Create RFP Modal ──────────────────────────────────────────────────────── -->
<Modal bind:open={showForm} title="Créer un appel d'offres" size="md">
  {#snippet children()}
    <form onsubmit={create} class="space-y-4">
      <Field label="Titre">
        <Input bind:value={formTitle} placeholder="ex. Appel d'offres Q3 — Corridor MTL-TOR" required />
      </Field>
      <Field label="Description (optionnel)">
        <Textarea bind:value={formDescription} placeholder="Contexte, volumes attendus, exigences..." rows={3} />
      </Field>
      <Field label="Deadline (optionnel)">
        <Input type="date" bind:value={formDeadline} />
      </Field>
      {#if rfpFieldDefs.length > 0}
        <CustomFieldInputs definitions={rfpFieldDefs} bind:data={customData} />
      {/if}
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={resetForm}>Annuler</Button>
        <Button variant="primary" type="submit">Créer</Button>
      </div>
    </form>
  {/snippet}
</Modal>
