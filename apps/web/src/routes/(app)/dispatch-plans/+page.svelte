<script lang="ts">
  // Dispatch Plans — Continuous Planning v1.
  // Versioned propose → diff → commit of load consolidations. A plan is a set of
  // consolidation items (each = a group of shipments to merge into one load).
  // DRAFT → propose → PROPOSED → commit → COMMITTED ; discard from DRAFT/PROPOSED.
  // The diff endpoint tells us, per shipment, whether the commit is still safe
  // (found, not already assigned). All backend; this page only orchestrates.
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { goto } from '$app/navigation';
  import type { Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Skeleton,
    Modal,
    Input,
    toneFor,
    type Tone,
  } from '$lib/components/ui';

  type PlanStatus = 'DRAFT' | 'PROPOSED' | 'COMMITTED' | 'DISCARDED';

  interface PlanItem {
    id: string;
    shipmentIds: string[];
    resultLoadId: string | null;
    error: string | null;
  }
  interface Plan {
    id: string;
    planNumber: string;
    status: PlanStatus;
    engine: string;
    note: string | null;
    committedAt: string | null;
    createdAt: string;
    items: PlanItem[];
  }
  interface DiffShipment {
    shipmentId: string;
    shipmentNumber: string | null;
    found: boolean;
    status: string | null;
    alreadyAssigned: boolean;
    committable: boolean;
  }
  interface DiffItem {
    itemId: string;
    resultLoadId: string | null;
    error: string | null;
    committable: boolean;
    shipments: DiffShipment[];
  }
  interface DiffResult {
    planId: string;
    status: string;
    committable: boolean;
    items: DiffItem[];
  }
  interface UnassignedShipment {
    id: string;
    shipmentNumber: string;
    status: string;
  }

  // --- list state -------------------------------------------------------------
  let plans = $state<Plan[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');

  // --- detail state -----------------------------------------------------------
  let selectedId = $state<string | null>(null);
  let detail = $state<Plan | null>(null);
  let diff = $state<DiffResult | null>(null);
  let detailLoading = $state(false);
  let actionBusy = $state(false);
  let actionError = $state('');

  // --- create modal state -----------------------------------------------------
  let createOpen = $state(false);
  let createBusy = $state(false);
  let createError = $state('');
  let unassigned = $state<UnassignedShipment[]>([]);
  let unassignedLoading = $state(false);
  let checked = $state<Set<string>>(new Set());
  let note = $state('');

  // --- derived KPIs -----------------------------------------------------------
  const draftCount = $derived(plans.filter((p) => p.status === 'DRAFT').length);
  const proposedCount = $derived(plans.filter((p) => p.status === 'PROPOSED').length);
  const committedCount = $derived(plans.filter((p) => p.status === 'COMMITTED').length);

  const canPropose = $derived(detail?.status === 'DRAFT');
  const canCommit = $derived(detail?.status === 'PROPOSED');
  const canDiscard = $derived(detail?.status === 'DRAFT' || detail?.status === 'PROPOSED');
  const isTerminal = $derived(detail?.status === 'COMMITTED' || detail?.status === 'DISCARDED');
  const checkedCount = $derived(checked.size);

  function planTone(status: PlanStatus): Tone {
    return {
      DRAFT: 'neutral',
      PROPOSED: 'info',
      COMMITTED: 'ok',
      DISCARDED: 'neutral',
    }[status] as Tone;
  }
  function planLabel(status: PlanStatus): string {
    return {
      DRAFT: 'Brouillon',
      PROPOSED: 'Proposé',
      COMMITTED: 'Committé',
      DISCARDED: 'Abandonné',
    }[status];
  }
  function fmtDateTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString('fr-CA') : '—';
  }
  function diffForItem(itemId: string): DiffItem | undefined {
    return diff?.items.find((i) => i.itemId === itemId);
  }
  function shipTone(s: DiffShipment): Tone {
    if (s.committable) return 'ok';
    if (s.alreadyAssigned || !s.found) return 'danger';
    return 'warn';
  }
  function shipDetail(s: DiffShipment): string {
    if (!s.found) return 'introuvable';
    if (s.alreadyAssigned) return 'déjà assigné';
    return (s.status ?? '').replaceAll('_', ' ').toLowerCase();
  }

  // --- data loading -----------------------------------------------------------
  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Plan>>('/transportation/dispatch-plans', {
        query: { page: 1, pageSize: 25 },
      });
      plans = res.items;
      total = res.total;
      // Keep the selection in sync, or pick the first plan on first load.
      if (selectedId && plans.some((p) => p.id === selectedId)) {
        // refresh detail of the still-selected plan
      } else if (plans.length > 0 && !selectedId) {
        await select(plans[0].id);
      }
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement des plans impossible.';
    } finally {
      loading = false;
    }
  }

  async function loadDetail(id: string) {
    detailLoading = true;
    actionError = '';
    try {
      const [p, d] = await Promise.all([
        api<Plan>(`/transportation/dispatch-plans/${id}`),
        api<DiffResult>(`/transportation/dispatch-plans/${id}/diff`),
      ]);
      detail = p;
      diff = d;
    } catch (e) {
      actionError = e instanceof ApiError ? e.message : 'Chargement du plan impossible.';
    } finally {
      detailLoading = false;
    }
  }

  async function select(id: string) {
    selectedId = id;
    detail = null;
    diff = null;
    await loadDetail(id);
  }

  // --- governed actions -------------------------------------------------------
  async function runAction(verb: 'propose' | 'commit' | 'discard') {
    if (!selectedId) return;
    actionBusy = true;
    actionError = '';
    try {
      await api<Plan>(`/transportation/dispatch-plans/${selectedId}/${verb}`, { method: 'POST' });
      await Promise.all([loadDetail(selectedId), load()]);
    } catch (e) {
      actionError = e instanceof ApiError ? e.message : `Action « ${verb} » impossible.`;
    } finally {
      actionBusy = false;
    }
  }

  // --- create modal -----------------------------------------------------------
  async function openCreate() {
    createOpen = true;
    createError = '';
    checked = new Set();
    note = '';
    unassignedLoading = true;
    try {
      const res = await api<Paginated<UnassignedShipment>>('/transportation/shipments', {
        query: { unassigned: 'true', pageSize: 100 },
      });
      unassigned = res.items;
    } catch (e) {
      createError = e instanceof ApiError ? e.message : 'Chargement des shipments impossible.';
    } finally {
      unassignedLoading = false;
    }
  }

  function toggleShipment(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    checked = next;
  }

  async function createPlan() {
    if (checked.size === 0) return;
    createBusy = true;
    createError = '';
    try {
      const created = await api<Plan>('/transportation/dispatch-plans', {
        method: 'POST',
        body: {
          items: [{ shipmentIds: [...checked] }],
          note: note.trim() || undefined,
        },
      });
      createOpen = false;
      await load();
      await select(created.id);
    } catch (e) {
      createError = e instanceof ApiError ? e.message : 'Création du plan impossible.';
    } finally {
      createBusy = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<PageHeader
  title="Dispatch Plans"
  eyebrow="Transport / Operations"
  subtitle="Proposez une consolidation, voyez son diff, puis committez-la en un geste gouverné et tracé."
  count={total}
>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau plan</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card><Skeleton /></Card>
{:else}
  <!-- KPI strip -->
  <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Card>
      <p class="text-xs text-ink-muted">Plans totaux</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{total}</p>
    </Card>
    <Card>
      <p class="text-xs text-ink-muted">Brouillons</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{draftCount}</p>
    </Card>
    <Card>
      <p class="text-xs text-ink-muted">Proposés</p>
      <p class="mt-1 text-2xl font-semibold {proposedCount > 0 ? 'text-accent' : 'text-ink'}">
        {proposedCount}
      </p>
    </Card>
    <Card>
      <p class="text-xs text-ink-muted">Committés</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{committedCount}</p>
    </Card>
  </div>

  {#if plans.length === 0}
    <Card>
      <EmptyState
        title="Aucun plan de dispatch"
        message="Créez un plan versionné: regroupez des shipments non assignés, proposez la consolidation, puis committez-la."
      >
        {#snippet children()}
          <Button onclick={openCreate}>Nouveau plan</Button>
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <!-- LIST -->
      <div class="space-y-2">
        {#each plans as p (p.id)}
          <button
            type="button"
            onclick={() => select(p.id)}
            class={`w-full rounded-card border bg-surface p-3 text-left shadow-sm transition hover:bg-surface-muted ${
              selectedId === p.id ? 'border-accent ring-1 ring-accent' : 'border-edge'
            }`}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-ink">{p.planNumber}</span>
              <Badge tone={planTone(p.status)}>{planLabel(p.status)}</Badge>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span>{p.items.length} item(s)</span>
              <span class="text-ink-faint">·</span>
              <span>{fmtDateTime(p.createdAt)}</span>
            </div>
            {#if p.note}
              <p class="mt-1 truncate text-xs text-ink-faint">{p.note}</p>
            {/if}
          </button>
        {/each}
      </div>

      <!-- DETAIL -->
      <div>
        {#if detailLoading}
          <Card><Skeleton /></Card>
        {:else if !detail}
          <Card>
            <EmptyState
              title="Sélectionnez un plan"
              message="Choisissez un plan à gauche pour voir son diff et ses actions."
            />
          </Card>
        {:else}
          <Card>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-lg font-semibold text-ink">{detail.planNumber}</h2>
                  <Badge tone={planTone(detail.status)}>{planLabel(detail.status)}</Badge>
                </div>
                <p class="mt-1 text-xs text-ink-muted">
                  Moteur: <span class="font-medium text-ink">{detail.engine}</span>
                  {#if detail.committedAt}
                    <span class="text-ink-faint"> · committé le {fmtDateTime(detail.committedAt)}</span>
                  {/if}
                </p>
                {#if detail.note}
                  <p class="mt-1 text-sm text-ink-muted">{detail.note}</p>
                {/if}
              </div>

              <!-- status-gated actions -->
              <div class="flex flex-wrap gap-2">
                {#if canPropose}
                  <Button onclick={() => runAction('propose')} loading={actionBusy} disabled={actionBusy}>
                    Proposer
                  </Button>
                {/if}
                {#if canCommit}
                  <Button
                    onclick={() => runAction('commit')}
                    loading={actionBusy}
                    disabled={actionBusy || !diff?.committable}
                  >
                    Committer
                  </Button>
                {/if}
                {#if canDiscard}
                  <Button
                    variant="danger"
                    onclick={() => runAction('discard')}
                    loading={actionBusy}
                    disabled={actionBusy}
                  >
                    Abandonner
                  </Button>
                {/if}
              </div>
            </div>

            {#if actionError}
              <p class="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-sm text-danger">
                {actionError}
              </p>
            {/if}

            {#if canCommit && diff && !diff.committable}
              <p class="mt-3 rounded-inner bg-warn-soft px-3 py-2 text-sm text-ink">
                Diff non committable: au moins un shipment a changé d'état ou est déjà assigné.
                Le commit est bloqué tant que le conflit n'est pas résolu.
              </p>
            {/if}

            {#if isTerminal}
              <p class="mt-3 text-xs text-ink-faint">Plan terminal — aucune action disponible.</p>
            {/if}

            <!-- items + per-shipment diff -->
            <div class="mt-4 space-y-3">
              {#each detail.items as item, idx (item.id)}
                {@const di = diffForItem(item.id)}
                <div class="rounded-inner border border-edge-soft bg-surface-muted p-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-sm font-semibold text-ink">
                      Consolidation #{idx + 1}
                      <span class="font-normal text-ink-muted">
                        ({item.shipmentIds.length} shipment(s))
                      </span>
                    </span>
                    {#if item.resultLoadId}
                      <a
                        class="text-xs font-semibold text-accent hover:underline"
                        href={`/loads/${item.resultLoadId}`}
                        onclick={(e) => {
                          e.preventDefault();
                          void goto(`/loads/${item.resultLoadId}`);
                        }}
                      >
                        Load créé →
                      </a>
                    {:else if di && !di.committable && di.shipments.length > 0}
                      <Badge tone="danger">Non committable</Badge>
                    {/if}
                  </div>

                  {#if item.error}
                    <p class="mt-2 rounded-inner bg-danger-soft px-2 py-1 text-xs text-danger">
                      {item.error}
                    </p>
                  {/if}

                  <div class="mt-2 flex flex-wrap gap-1.5">
                    {#if di}
                      {#each di.shipments as s (s.shipmentId)}
                        <span
                          class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            shipTone(s) === 'ok'
                              ? 'bg-ok-soft text-ok'
                              : shipTone(s) === 'danger'
                                ? 'bg-danger-soft text-danger'
                                : 'bg-warn-soft text-ink'
                          }`}
                          title={shipDetail(s)}
                        >
                          {s.shipmentNumber ?? s.shipmentId.slice(0, 8)}
                          <span class="text-[10px] font-normal opacity-80">· {shipDetail(s)}</span>
                        </span>
                      {/each}
                    {:else}
                      {#each item.shipmentIds as sid (sid)}
                        <span
                          class="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-xs font-semibold text-neutral"
                        >
                          {sid.slice(0, 8)}
                        </span>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </Card>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<!-- CREATE MODAL -->
<Modal bind:open={createOpen} title="Nouveau plan de dispatch" size="lg">
  {#snippet children()}
    <p class="mb-3 text-sm text-ink-muted">
      Cochez les shipments non assignés à regrouper en une consolidation. Le plan est créé en
      <span class="font-medium text-ink">brouillon</span>: vous le proposerez, puis le committerez.
    </p>

    {#if createError}
      <p class="mb-3 rounded-inner bg-danger-soft px-3 py-2 text-sm text-danger">{createError}</p>
    {/if}

    {#if unassignedLoading}
      <Skeleton />
    {:else if unassigned.length === 0}
      <EmptyState
        title="Aucun shipment non assigné"
        message="Tous les shipments sont déjà rattachés à un load."
      />
    {:else}
      <div class="max-h-72 space-y-1 overflow-y-auto rounded-inner border border-edge-soft p-1">
        {#each unassigned as s (s.id)}
          <label
            class={`flex cursor-pointer items-center justify-between gap-2 rounded-inner px-2 py-1.5 text-sm transition hover:bg-surface-muted ${
              checked.has(s.id) ? 'bg-surface-muted' : ''
            }`}
          >
            <span class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checked.has(s.id)}
                onchange={() => toggleShipment(s.id)}
                class="size-4 rounded border-edge text-accent focus:ring-accent"
              />
              <span class="font-medium text-ink">{s.shipmentNumber}</span>
            </span>
            <Badge tone={toneFor(s.status)}>{s.status}</Badge>
          </label>
        {/each}
      </div>

      <div class="mt-4">
        <span class="mb-1 block text-xs font-semibold text-ink-muted">Note (optionnel)</span>
        <Input bind:value={note} placeholder="Pourquoi cette consolidation ?" maxlength={500} />
      </div>
    {/if}
  {/snippet}
  {#snippet footer()}
    <span class="mr-auto text-xs text-ink-muted">{checkedCount} sélectionné(s)</span>
    <Button variant="secondary" onclick={() => { createOpen = false; }}>Annuler</Button>
    <Button onclick={createPlan} loading={createBusy} disabled={createBusy || checkedCount === 0}>
      Créer le plan
    </Button>
  {/snippet}
</Modal>
