<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  type Status = 'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  type Firmness = 'FIRM' | 'FORECAST' | 'TENTATIVE';

  interface Operation {
    id: string;
    sequence: number;
    name: string;
    durationMinutes: number;
    setupMinutes: number;
    eligibleWorkCenterIds: string[];
    status: string;
  }

  interface Order {
    id: string;
    number: string;
    name: string;
    productRef: string;
    quantity: number;
    dueDate?: string | null;
    releaseDate?: string | null;
    priority: Priority;
    status: Status;
    firmness: Firmness;
    operations: Operation[];
  }

  interface WorkCenter {
    id: string;
    name: string;
  }

  interface Routing {
    id: string;
    name: string;
  }

  const STATUS_LABELS: Record<Status, string> = {
    DRAFT: 'Brouillon',
    RELEASED: 'Libéré',
    IN_PROGRESS: 'En cours',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  };
  const PRIORITY_LABELS: Record<Priority, string> = {
    LOW: 'Basse',
    NORMAL: 'Normale',
    HIGH: 'Haute',
    URGENT: 'Urgente',
  };
  const FIRMNESS_LABELS: Record<Firmness, string> = {
    FIRM: 'Ferme',
    FORECAST: 'Prévision',
    TENTATIVE: 'Provisoire',
  };

  function statusTone(s: Status): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
    return s === 'COMPLETED'
      ? 'ok'
      : s === 'RELEASED'
        ? 'info'
        : s === 'IN_PROGRESS'
          ? 'warn'
          : s === 'CANCELLED'
            ? 'danger'
            : 'neutral';
  }

  function priorityTone(p: Priority): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
    return p === 'URGENT' ? 'danger' : p === 'HIGH' ? 'warn' : p === 'LOW' ? 'neutral' : 'info';
  }

  function fmtDate(d?: string | null): string {
    if (!d) return '—';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-CA');
  }

  const orderId = $derived(page.params.id as string);

  let order = $state<Order | null>(null);
  let loading = $state(true);
  let error = $state('');
  let acting = $state(false);

  let workCenters = $state<WorkCenter[]>([]);
  let wcById = $derived(new Map(workCenters.map((w) => [w.id, w.name])));
  let routings = $state<Routing[]>([]);

  const status = $derived(order?.status);
  const canEditOps = $derived(status === 'DRAFT' || status === 'RELEASED');
  const isTerminal = $derived(status === 'COMPLETED' || status === 'CANCELLED');

  // Add-operation modal
  let opOpen = $state(false);
  let opSequence = $state('');
  let opName = $state('');
  let opDuration = $state('');
  let opSetup = $state('');
  let opWorkCenters = $state<Record<string, boolean>>({});
  let opSaving = $state(false);

  // Import-from-routing modal
  let routingOpen = $state(false);
  let routingId = $state('');
  let routingSaving = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      order = await api<Order>(`/manufacturing/orders/${orderId}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Échec du chargement de l'ordre";
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  async function loadWorkCenters() {
    try {
      const res = await api<WorkCenter[] | Paginated<WorkCenter>>('/manufacturing/work-centers', {
        query: { pageSize: 100 },
      });
      workCenters = Array.isArray(res) ? res : res.items;
    } catch {
      // best-effort
    }
  }

  async function loadRoutings() {
    try {
      const res = await api<Paginated<Routing>>('/manufacturing/routings', {
        query: { pageSize: 100 },
      });
      routings = res.items;
    } catch {
      // best-effort
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    void loadWorkCenters();
    void loadRoutings();
  });

  async function lifecycle(verb: 'release' | 'start' | 'complete' | 'cancel') {
    acting = true;
    try {
      await api(`/manufacturing/orders/${orderId}/${verb}`, { method: 'POST' });
      toast.success('Ordre mis à jour');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'action");
    } finally {
      acting = false;
    }
  }

  function openAddOp() {
    opSequence = order ? String((order.operations.length + 1) * 10) : '10';
    opName = '';
    opDuration = '';
    opSetup = '';
    opWorkCenters = {};
    opOpen = true;
  }

  async function submitOp() {
    if (!opName.trim()) {
      toast.error("Nom de l'opération requis");
      return;
    }
    const seq = Number(opSequence);
    const dur = Number(opDuration);
    if (Number.isNaN(seq)) {
      toast.error('Séquence invalide');
      return;
    }
    if (opDuration === '' || Number.isNaN(dur) || dur < 0) {
      toast.error('Durée invalide');
      return;
    }
    opSaving = true;
    try {
      const eligibleWorkCenterIds = Object.entries(opWorkCenters)
        .filter(([, on]) => on)
        .map(([id]) => id);
      const body = {
        sequence: seq,
        name: opName.trim(),
        durationMinutes: dur,
        setupMinutes: opSetup !== '' ? Number(opSetup) : undefined,
        eligibleWorkCenterIds: eligibleWorkCenterIds.length > 0 ? eligibleWorkCenterIds : undefined,
      };
      await api(`/manufacturing/orders/${orderId}/operations`, { method: 'POST', body });
      toast.success('Opération ajoutée');
      opOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout");
    } finally {
      opSaving = false;
    }
  }

  async function removeOp(op: Operation) {
    try {
      await api(`/manufacturing/orders/${orderId}/operations/${op.id}`, { method: 'DELETE' });
      toast.success('Opération supprimée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    }
  }

  function openRouting() {
    routingId = routings[0]?.id ?? '';
    routingOpen = true;
  }

  async function submitRouting() {
    if (!routingId) {
      toast.error('Sélectionnez une gamme');
      return;
    }
    routingSaving = true;
    try {
      await api(`/manufacturing/orders/${orderId}/operations/from-routing`, {
        method: 'POST',
        body: { routingId },
      });
      toast.success('Opérations importées');
      routingOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'import");
    } finally {
      routingSaving = false;
    }
  }
</script>

{#if loading}
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if error || !order}
  <Card><p class="text-sm text-danger">{error || 'Ordre introuvable'}</p></Card>
{:else}
  <PageHeader eyebrow={order.number} title={order.name}>
    {#snippet actions()}
      {#if status === 'DRAFT'}
        <Button loading={acting} onclick={() => lifecycle('release')}>Libérer</Button>
      {/if}
      {#if status === 'RELEASED'}
        <Button loading={acting} onclick={() => lifecycle('start')}>Démarrer</Button>
      {/if}
      {#if status === 'IN_PROGRESS'}
        <Button loading={acting} onclick={() => lifecycle('complete')}>Terminer</Button>
      {/if}
      {#if !isTerminal}
        <Button variant="secondary" loading={acting} onclick={() => lifecycle('cancel')}
          >Annuler</Button
        >
      {/if}
    {/snippet}
  </PageHeader>

  <Card>
    <div class="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
      <div>
        <div class="text-xs text-ink-faint">Statut</div>
        <div class="mt-1"><Badge tone={statusTone(order.status)}>{STATUS_LABELS[order.status]}</Badge></div>
      </div>
      <div>
        <div class="text-xs text-ink-faint">Priorité</div>
        <div class="mt-1"><Badge tone={priorityTone(order.priority)}>{PRIORITY_LABELS[order.priority]}</Badge></div>
      </div>
      <div>
        <div class="text-xs text-ink-faint">Fermeté</div>
        <div class="mt-1 text-ink">{FIRMNESS_LABELS[order.firmness]}</div>
      </div>
      <div>
        <div class="text-xs text-ink-faint">Produit</div>
        <div class="mt-1 text-ink">{order.productRef}</div>
      </div>
      <div>
        <div class="text-xs text-ink-faint">Quantité</div>
        <div class="mt-1 text-ink">{order.quantity}</div>
      </div>
      <div>
        <div class="text-xs text-ink-faint">Libération</div>
        <div class="mt-1 text-ink">{fmtDate(order.releaseDate)}</div>
      </div>
      <div>
        <div class="text-xs text-ink-faint">Échéance</div>
        <div class="mt-1 text-ink">{fmtDate(order.dueDate)}</div>
      </div>
    </div>
  </Card>

  <div class="mt-5 mb-3 flex items-center justify-between">
    <h2 class="text-lg font-semibold text-ink">Opérations</h2>
    {#if canEditOps}
      <div class="flex gap-2">
        {#if status === 'DRAFT'}
          <Button variant="secondary" onclick={openRouting}>Importer depuis une gamme</Button>
        {/if}
        <Button onclick={openAddOp}>Ajouter une opération</Button>
      </div>
    {/if}
  </div>

  {#if order.operations.length === 0}
    <Card>
      <EmptyState message="Aucune opération.">
        {#snippet children()}
          {#if canEditOps}
            <Button onclick={openAddOp}>Ajouter une opération</Button>
          {/if}
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <Table>
      {#snippet head()}
        <th class="text-right">Séq.</th><th>Nom</th><th class="text-right">Durée (min)</th
        ><th class="text-right">Setup (min)</th><th class="text-right">Postes éligibles</th
        ><th>Statut</th><th></th>
      {/snippet}
      {#snippet body()}
        {#each order!.operations as op (op.id)}
          <tr>
            <td class="text-right font-mono text-ink">{op.sequence}</td>
            <td class="text-ink">{op.name}</td>
            <td class="text-right text-ink-muted">{op.durationMinutes}</td>
            <td class="text-right text-ink-muted">{op.setupMinutes}</td>
            <td class="text-right text-ink-muted">{op.eligibleWorkCenterIds?.length ?? 0}</td>
            <td><Badge tone="neutral">{op.status}</Badge></td>
            <td class="text-right">
              {#if canEditOps}
                <Button variant="ghost" onclick={() => removeOp(op)}>Retirer</Button>
              {/if}
            </td>
          </tr>
        {/each}
      {/snippet}
    </Table>
  {/if}
{/if}

<Modal bind:open={opOpen} title="Ajouter une opération" size="md">
  {#snippet children()}
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <Field label="Séquence">
          <Input bind:value={opSequence} type="number" step="any" placeholder="10" />
        </Field>
        <Field label="Nom">
          <Input bind:value={opName} placeholder="Désignation" />
        </Field>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Durée (min)">
          <Input bind:value={opDuration} type="number" min="0" step="any" placeholder="ex. 30" />
        </Field>
        <Field label="Setup (min)">
          <Input bind:value={opSetup} type="number" min="0" step="any" placeholder="Optionnel" />
        </Field>
      </div>
      <Field label="Postes éligibles">
        {#if workCenters.length === 0}
          <p class="text-xs text-ink-faint">Aucun poste de charge disponible.</p>
        {:else}
          <div class="flex flex-wrap gap-2">
            {#each workCenters as wc (wc.id)}
              <label class="flex items-center gap-1.5 rounded-md border border-edge px-2 py-1 text-sm text-ink">
                <input type="checkbox" bind:checked={opWorkCenters[wc.id]} />
                {wc.name}
              </label>
            {/each}
          </div>
        {/if}
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            opOpen = false;
          }}>Annuler</Button
        >
        <Button variant="primary" loading={opSaving} onclick={submitOp}>Ajouter</Button>
      </div>
    </div>
  {/snippet}
</Modal>

<Modal bind:open={routingOpen} title="Importer depuis une gamme" size="md">
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Gamme">
        <Select bind:value={routingId}>
          <option value="">— Sélectionner —</option>
          {#each routings as r (r.id)}
            <option value={r.id}>{r.name}</option>
          {/each}
        </Select>
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            routingOpen = false;
          }}>Annuler</Button
        >
        <Button variant="primary" loading={routingSaving} onclick={submitRouting}>Importer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
