<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { goto } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Badge,
    Skeleton,
    ErrorNotice,
  } from '$lib/components/ui';

  // ----- Types ---------------------------------------------------------------

  interface Deal {
    id: string;
    title: string;
    companyName: string | null;
    amount: number | null;
    currency: string;
    ownerUserId: string | null;
    lastActivityAt: string | null;
    expectedCloseDate: string | null;
    ageDays: number;
    stale: boolean;
  }

  interface Column {
    stage: string;
    deals: Deal[];
  }

  // ----- State ---------------------------------------------------------------

  let columns = $state<Column[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Track which card is being dragged: { id, from }
  let dragging = $state<{ id: string; from: string } | null>(null);
  // Track which column is the current drop target (for visual feedback)
  let dragOverStage = $state<string | null>(null);

  // ----- Stage metadata ──────────────────────────────────────────────────────

  const STAGES: { key: string; label: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'danger' }[] = [
    { key: 'LEAD',      label: 'Prospect',    tone: 'neutral' },
    { key: 'QUALIFIED', label: 'Qualifié',    tone: 'info'    },
    { key: 'PROPOSAL',  label: 'Proposition', tone: 'warn'    },
    { key: 'WON',       label: 'Gagné',       tone: 'ok'      },
    { key: 'LOST',      label: 'Perdu',       tone: 'danger'  },
  ];

  // Terminal stages: cards are not draggable out of them
  const TERMINAL = new Set(['WON', 'LOST']);

  // ----- Data loading ────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      // API returns Array<{ stage, deals[] }>; coerce Decimal amounts (string over wire)
      const raw = await api<Array<{ stage: string; deals: Array<Omit<Deal, 'amount'> & { amount: string | number | null }> }>>(
        '/crm/pipeline',
      );
      // Preserve server ordering; coerce amount to number
      columns = raw.map((col) => ({
        stage: col.stage,
        deals: col.deals.map((d) => ({
          ...d,
          amount: d.amount == null ? null : Number(d.amount),
        })),
      }));
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

  // ----- Drag & drop ─────────────────────────────────────────────────────────

  function onDragStart(e: DragEvent, deal: Deal, fromStage: string) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ id: deal.id, from: fromStage }));
    dragging = { id: deal.id, from: fromStage };
  }

  function onDragEnd() {
    dragging = null;
    dragOverStage = null;
  }

  function onDragOver(e: DragEvent, toStage: string) {
    if (!dragging) return;
    if (dragging.from === toStage) return; // same column — no visual hint
    e.preventDefault();
    dragOverStage = toStage;
  }

  function onDragLeave(e: DragEvent) {
    // Only clear when leaving the column entirely (not a child element)
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as Node;
    if (!related || !current.contains(related)) {
      dragOverStage = null;
    }
  }

  async function onDrop(e: DragEvent, toStage: string) {
    e.preventDefault();
    dragOverStage = null;
    dragging = null;

    let payload: { id: string; from: string };
    try {
      payload = JSON.parse(e.dataTransfer?.getData('application/json') ?? '');
    } catch {
      return;
    }
    if (!payload?.id || payload.from === toStage) return;

    // Find source column + deal
    const srcCol = columns.find((c) => c.stage === payload.from);
    const dstCol = columns.find((c) => c.stage === toStage);
    if (!srcCol || !dstCol) return;
    const card = srcCol.deals.find((d) => d.id === payload.id);
    if (!card) return;

    // Snapshot for revert
    const snapshot = columns.map((c) => ({ ...c, deals: [...c.deals] }));

    // Optimistic move: remove from source, prepend to destination
    columns = columns.map((c) => {
      if (c.stage === payload.from) return { ...c, deals: c.deals.filter((d) => d.id !== payload.id) };
      if (c.stage === toStage)      return { ...c, deals: [card, ...c.deals] };
      return c;
    });

    try {
      await api(`/crm/deals/${payload.id}/advance`, {
        method: 'POST',
        body: { stage: toStage },
      });
      error = '';
    } catch (e) {
      // Revert to pre-optimistic state on error (e.g. terminal stage 400)
      columns = snapshot;
      const msg = e instanceof ApiError ? e.message : 'Transition impossible';
      error = msg;
      toast.error(msg);
    }
  }

  // ----- Formatting helpers ──────────────────────────────────────────────────

  function formatAmount(amount: number | null, currency: string): string {
    if (amount == null) return '—';
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currency || 'CAD',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function colTotal(col: Column): number {
    return col.deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  }

  /** Currency used for the column total: first non-null deal currency, or CAD */
  function colCurrency(col: Column): string {
    return col.deals.find((d) => d.currency)?.currency ?? 'CAD';
  }
</script>

<PageHeader
  title="Pipeline CRM"
  subtitle="Glissez les opportunités entre les colonnes pour faire avancer les affaires."
/>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="flex gap-4 overflow-x-auto pb-4">
    {#each STAGES as s (s.key)}
      <div class="w-64 shrink-0 space-y-3">
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
      {@const col = columns.find((c) => c.stage === stage.key) ?? { stage: stage.key, deals: [] }}
      {@const total = colTotal(col)}
      {@const currency = colCurrency(col)}
      {@const isTarget = dragOverStage === stage.key}
      {@const isTerminal = TERMINAL.has(stage.key)}

      <!-- Column drop zone -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
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
            <span class="text-xs font-semibold text-ink-muted">{col.deals.length}</span>
          </div>
          {#if total > 0}
            <span class="text-[11px] font-medium text-ink-faint">{formatAmount(total, currency)}</span>
          {/if}
        </div>

        <!-- Deal cards -->
        <div class="flex min-h-[4rem] flex-col gap-2 p-2">
          {#if col.deals.length === 0}
            <div
              class={`flex-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-ink-faint ${
                isTarget ? 'border-accent' : 'border-edge'
              }`}
            >
              {isTarget ? 'Déposer ici' : 'Aucune affaire'}
            </div>
          {:else}
            {#each col.deals as deal (deal.id)}
              {@const isDragged = dragging?.id === deal.id}
              <div
                class={`group relative rounded-lg border bg-surface shadow-sm transition-all ${
                  isTerminal
                    ? 'opacity-90'
                    : 'hover:shadow-md'
                } ${isDragged ? 'opacity-40 ring-2 ring-accent' : ''}`}
              >
                <!-- Draggable + clickable card body -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  draggable={!isTerminal}
                  ondragstart={(e) => onDragStart(e, deal, stage.key)}
                  ondragend={onDragEnd}
                  onclick={() => void goto('/crm/deals')}
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') void goto('/crm/deals'); }}
                  role="button"
                  tabindex="0"
                  class={`px-3 pt-2.5 pb-2 ${
                    isTerminal ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                  }`}
                >
                  <!-- Title row -->
                  <div class="truncate pr-6 text-sm font-semibold text-ink">{deal.title}</div>

                  <!-- Company -->
                  {#if deal.companyName}
                    <div class="mt-0.5 truncate text-xs text-ink-muted">{deal.companyName}</div>
                  {/if}

                  <!-- Amount + age row -->
                  <div class="mt-1.5 flex items-center justify-between gap-2">
                    <span class={`text-xs font-semibold ${deal.amount != null ? 'text-accent' : 'text-ink-faint'}`}>
                      {formatAmount(deal.amount, deal.currency)}
                    </span>
                    <div class="flex items-center gap-1">
                      {#if deal.stale}
                        <span class="text-[10px] font-semibold text-warn" title="Opportunité sans activité récente">⚠ Inactif</span>
                      {/if}
                      <span class="text-[10px] text-ink-faint">{deal.ageDays}j</span>
                    </div>
                  </div>

                  <!-- Owner row -->
                  <div class="mt-1 text-[10px] text-ink-faint truncate">
                    {deal.ownerUserId ?? '—'}
                  </div>
                </div>

                <!-- 🧠 Coach button — stop propagation so card click doesn't also fire -->
                <a
                  href={`/crm/coach?dealId=${deal.id}`}
                  class="absolute right-2 top-2 rounded p-0.5 text-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-muted"
                  title="Coach IA"
                  onclick={(e) => e.stopPropagation()}
                >🧠</a>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
