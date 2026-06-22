<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  // ----- Types ---------------------------------------------------------------

  interface Deal {
    id: string;
    title: string;
    stage: string;
    amount: number | null;
    companyName: string | null;
    ownerName: string | null;
  }

  interface Pipeline {
    LEAD: Deal[];
    QUALIFIED: Deal[];
    PROPOSAL: Deal[];
    WON: Deal[];
    LOST: Deal[];
  }

  // ----- State ---------------------------------------------------------------

  let pipeline = $state<Pipeline>({ LEAD: [], QUALIFIED: [], PROPOSAL: [], WON: [], LOST: [] });
  let loading = $state(true);
  let error = $state('');

  // Track which card is being dragged: { dealId, fromStage }
  let dragging = $state<{ dealId: string; fromStage: string } | null>(null);
  // Track which column is the current drop target (for visual feedback)
  let dragOverStage = $state<string | null>(null);

  // ----- Stage metadata ──────────────────────────────────────────────────────

  const STAGES: { key: string; label: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'danger' }[] = [
    { key: 'LEAD', label: 'Prospect', tone: 'neutral' },
    { key: 'QUALIFIED', label: 'Qualifié', tone: 'info' },
    { key: 'PROPOSAL', label: 'Proposition', tone: 'warn' },
    { key: 'WON', label: 'Gagné', tone: 'ok' },
    { key: 'LOST', label: 'Perdu', tone: 'danger' },
  ];

  // Terminal stages cannot receive drops (server rejects them if the deal is already terminal,
  // but we also skip the no-op of dragging to the same stage).
  const TERMINAL = new Set(['WON', 'LOST']);

  // ----- Data loading ────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      pipeline = await api<Pipeline>('/crm/pipeline');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger le pipeline';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // ----- Drag & drop helpers ─────────────────────────────────────────────────

  function onDragStart(e: DragEvent, deal: Deal, fromStage: string) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ dealId: deal.id, fromStage }));
    dragging = { dealId: deal.id, fromStage };
  }

  function onDragEnd() {
    dragging = null;
    dragOverStage = null;
  }

  function onDragOver(e: DragEvent, toStage: string) {
    if (!dragging) return;
    if (dragging.fromStage === toStage) return; // same column — no-op
    e.preventDefault();
    dragOverStage = toStage;
  }

  function onDragLeave() {
    dragOverStage = null;
  }

  async function onDrop(e: DragEvent, toStage: string) {
    e.preventDefault();
    dragOverStage = null;
    dragging = null;

    let payload: { dealId: string; fromStage: string };
    try {
      payload = JSON.parse(e.dataTransfer?.getData('application/json') ?? '');
    } catch {
      return;
    }
    if (!payload?.dealId || payload.fromStage === toStage) return;

    // Find the deal in the source column
    const fromCol = pipeline[payload.fromStage as keyof Pipeline];
    const dealIdx = fromCol.findIndex((d) => d.id === payload.dealId);
    if (dealIdx === -1) return;
    const deal = fromCol[dealIdx];

    // Optimistic update: remove from source, append to target
    pipeline = {
      ...pipeline,
      [payload.fromStage]: fromCol.filter((d) => d.id !== payload.dealId),
      [toStage]: [...pipeline[toStage as keyof Pipeline], { ...deal, stage: toStage }],
    };

    try {
      await api(`/crm/deals/${payload.dealId}/advance`, {
        method: 'POST',
        body: { stage: toStage },
      });
    } catch (e) {
      // Revert optimistic update
      pipeline = {
        ...pipeline,
        [toStage]: pipeline[toStage as keyof Pipeline].filter((d) => d.id !== payload.dealId),
        [payload.fromStage]: [...pipeline[payload.fromStage as keyof Pipeline], deal],
      };
      const msg = e instanceof ApiError ? e.message : 'Transition impossible';
      toast.error(msg);
    }
  }

  // ----- Formatting helpers ──────────────────────────────────────────────────

  function formatAmount(amount: number | null): string {
    if (amount == null) return '—';
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amount);
  }

  function colTotal(stage: string): number {
    return pipeline[stage as keyof Pipeline].reduce((sum, d) => sum + (d.amount ?? 0), 0);
  }
</script>

<PageHeader title="Pipeline CRM" subtitle="Glissez les opportunités entre les colonnes pour faire avancer les affaires." />

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="flex gap-4 overflow-x-auto pb-4">
    {#each STAGES as s (s.key)}
      <div class="w-56 shrink-0 space-y-3">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    {/each}
  </div>
{:else}
  <!-- Kanban board — one column per stage, horizontal scroll on small screens -->
  <div class="flex gap-4 overflow-x-auto pb-4 items-start">
    {#each STAGES as stage (stage.key)}
      {@const deals = pipeline[stage.key as keyof Pipeline]}
      {@const total = colTotal(stage.key)}
      {@const isTarget = dragOverStage === stage.key}
      {@const isTerminal = TERMINAL.has(stage.key)}

      <!-- Column drop zone -->
      <div
        role="region"
        aria-label={`Colonne ${stage.label}`}
        class={`flex w-64 shrink-0 flex-col rounded-xl border transition-colors ${
          isTarget
            ? 'border-accent bg-accent-soft/30'
            : 'border-edge bg-surface-muted/40'
        }`}
        ondragover={(e) => onDragOver(e, stage.key)}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, stage.key)}
      >
        <!-- Column header -->
        <div class="flex items-center justify-between gap-2 border-b border-edge px-3 py-2.5">
          <div class="flex items-center gap-2">
            <Badge tone={stage.tone}>{stage.label}</Badge>
            <span class="text-xs font-semibold text-ink-muted">{deals.length}</span>
          </div>
          {#if total > 0}
            <span class="text-[11px] font-medium text-ink-faint">{formatAmount(total)}</span>
          {/if}
        </div>

        <!-- Deal cards -->
        <div class="flex min-h-[4rem] flex-col gap-2 p-2">
          {#if deals.length === 0}
            <div
              class={`flex-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-ink-faint ${
                isTarget ? 'border-accent' : 'border-edge'
              }`}
            >
              {isTarget ? 'Déposer ici' : 'Aucune affaire'}
            </div>
          {:else}
            {#each deals as deal (deal.id)}
              {@const isDragged = dragging?.dealId === deal.id}
              <div
                role="button"
                tabindex="0"
                draggable={!isTerminal}
                ondragstart={(e) => onDragStart(e, deal, stage.key)}
                ondragend={onDragEnd}
                class={`rounded-lg border bg-surface px-3 py-2.5 shadow-sm transition-all ${
                  isTerminal
                    ? 'cursor-default opacity-90'
                    : 'cursor-grab hover:shadow-md active:cursor-grabbing'
                } ${isDragged ? 'opacity-40 ring-2 ring-accent' : ''}`}
              >
                <!-- Deal title -->
                <div class="truncate text-sm font-semibold text-ink">{deal.title}</div>

                <!-- Company -->
                {#if deal.companyName}
                  <div class="mt-0.5 truncate text-xs text-ink-muted">{deal.companyName}</div>
                {/if}

                <!-- Amount + owner row -->
                <div class="mt-1.5 flex items-center justify-between gap-2">
                  {#if deal.amount != null}
                    <span class="text-xs font-semibold text-accent">{formatAmount(deal.amount)}</span>
                  {:else}
                    <span class="text-xs text-ink-faint">—</span>
                  {/if}
                  {#if deal.ownerName}
                    <span class="truncate text-[10px] text-ink-faint">{deal.ownerName}</span>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
