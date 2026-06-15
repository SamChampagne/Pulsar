<script lang="ts">
  import { Badge } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';

  interface OccupyingVisit {
    id: string;
    visitNumber: string;
    direction: string;
    trailerRef: string | null;
    checkInAt: string | null;
    trailer: { unitNumber: string; plate: string | null } | null;
    carrier: { name: string } | null;
  }

  interface PlanSpot {
    id: string;
    code: string;
    type: string;
    isActive: boolean;
    posX: number | null;
    posY: number | null;
    occupyingVisit: OccupyingVisit | null;
  }

  let {
    spots = [] as PlanSpot[],
    unassigned = [] as OccupyingVisit[],
    editing = false,
    onAssign,
    onMove,
    onOpenSpot,
    onLayoutChange,
  }: {
    spots: PlanSpot[];
    unassigned: OccupyingVisit[];
    editing?: boolean;
    onAssign: (visitId: string, spotId: string) => void;
    onMove: (visitId: string, spotId: string) => void;
    onOpenSpot: (spot: PlanSpot) => void;
    onLayoutChange: (positions: { id: string; posX: number; posY: number }[]) => void;
  } = $props();

  const cols = $derived(Math.max(6, ...spots.map((s) => (s.posX ?? 0) + 1)));
  const rows = $derived(Math.max(4, ...spots.map((s) => (s.posY ?? 0) + 1)));

  const placed = $derived(spots.filter((s) => s.posX != null && s.posY != null));
  const unplaced = $derived(spots.filter((s) => s.posX == null || s.posY == null));

  // Edit-mode: all cells [0..cols)×[0..rows) are drop targets.
  const cells = $derived(
    editing
      ? Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ col: c, row: r }))).flat()
      : [],
  );

  function formatDwell(ms: number): string {
    if (ms < 0) ms = 0;
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  }

  // Tick once a minute so dwell stays roughly live.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  function dwellOf(occ: OccupyingVisit): string | null {
    if (!occ.checkInAt) return null;
    return formatDwell(now - new Date(occ.checkInAt).getTime());
  }

  function trailerLabel(occ: OccupyingVisit | null): string {
    if (!occ) return '—';
    return occ.trailer?.unitNumber ?? occ.trailer?.plate ?? occ.trailerRef ?? '—';
  }

  function directionTone(direction: string): Tone {
    switch (direction) {
      case 'INBOUND':
        return 'info';
      case 'OUTBOUND':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  function typeLabel(type: string): string {
    switch (type) {
      case 'DOCK_DOOR':
        return 'Quai';
      case 'PARKING':
        return 'Parc';
      case 'STAGING':
        return 'Staging';
      default:
        return type;
    }
  }

  // --- Operation-mode drag payloads ---
  function dragVisitFromSpot(e: DragEvent, spot: PlanSpot) {
    if (!spot.occupyingVisit || !e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ visitId: spot.occupyingVisit.id, fromSpotId: spot.id }),
    );
  }

  function dragUnassigned(e: DragEvent, v: OccupyingVisit) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ visitId: v.id, fromSpotId: null }));
  }

  function allowDropOnFree(e: DragEvent, spot: PlanSpot) {
    if (!spot.occupyingVisit && spot.isActive) e.preventDefault();
  }

  function dropOnSpot(e: DragEvent, spot: PlanSpot) {
    e.preventDefault();
    if (spot.occupyingVisit || !e.dataTransfer) return;
    let payload: { visitId: string; fromSpotId: string | null };
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json'));
    } catch {
      return;
    }
    if (!payload?.visitId) return;
    if (payload.fromSpotId) onMove(payload.visitId, spot.id);
    else onAssign(payload.visitId, spot.id);
  }

  // --- Edit-mode drag payloads (move spots around the grid) ---
  function dragSpotLayout(e: DragEvent, spot: PlanSpot) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ spotId: spot.id }));
  }

  function allowDropCell(e: DragEvent) {
    e.preventDefault();
  }

  function dropOnCell(e: DragEvent, col: number, row: number) {
    e.preventDefault();
    if (!e.dataTransfer) return;
    let payload: { spotId: string };
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json'));
    } catch {
      return;
    }
    if (!payload?.spotId) return;
    const posX = col;
    const posY = row;
    // Build updated positions array from current placed spots, replacing/inserting
    // the dragged spot's coords.
    const map = new Map<string, { id: string; posX: number; posY: number }>();
    for (const s of placed) {
      if (s.id === payload.spotId) continue; // skip — will re-add below
      map.set(s.id, { id: s.id, posX: s.posX as number, posY: s.posY as number });
    }
    // If the target cell is occupied by another placed spot, don't clobber it.
    const occupied = [...map.values()].some((p) => p.posX === posX && p.posY === posY);
    if (occupied) return;
    map.set(payload.spotId, { id: payload.spotId, posX, posY });
    onLayoutChange([...map.values()]);
  }
</script>

<div class="flex flex-col gap-4 lg:flex-row lg:items-start">
  {#if !editing}
    <!-- À placer column (operation mode) -->
    <aside class="lg:w-64 lg:shrink-0">
      <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
        À placer ({unassigned.length})
      </h3>
      <div class="flex flex-col gap-2">
        {#if unassigned.length === 0}
          <p class="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-ink-faint">
            Aucune visite à placer
          </p>
        {:else}
          {#each unassigned as v (v.id)}
            <div
              role="button"
              tabindex="0"
              draggable="true"
              ondragstart={(e) => dragUnassigned(e, v)}
              class="cursor-grab rounded-md border border-info/40 bg-info-soft/60 px-3 py-2 shadow-sm transition-shadow hover:shadow active:cursor-grabbing"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-ink">{v.visitNumber}</span>
                <Badge tone={directionTone(v.direction)}>{v.direction}</Badge>
              </div>
              <div class="mt-0.5 truncate text-xs text-ink-muted">{trailerLabel(v)}</div>
              {#if v.carrier}<div class="truncate text-xs text-ink-faint">{v.carrier.name}</div>{/if}
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  {:else if unplaced.length > 0}
    <!-- Spots non placés bac (edit mode) -->
    <aside class="lg:w-56 lg:shrink-0">
      <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Spots non placés</h3>
      <div class="flex flex-wrap gap-2 rounded-md border border-dashed border-edge p-2">
        {#each unplaced as s (s.id)}
          <div
            role="button"
            tabindex="0"
            draggable="true"
            ondragstart={(e) => dragSpotLayout(e, s)}
            class="cursor-grab rounded-md border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink shadow-sm active:cursor-grabbing"
          >
            {s.code}
            <span class="ml-1 text-xs text-ink-faint">{typeLabel(s.type)}</span>
          </div>
        {/each}
      </div>
    </aside>
  {/if}

  <!-- The plan grid -->
  <div class="min-w-0 flex-1 overflow-x-auto">
    <div
      class="relative rounded-lg border border-edge bg-surface-muted/40 p-3"
      style={`display:grid; grid-template-columns: repeat(${cols}, minmax(130px, 1fr)); grid-auto-rows: 92px; gap: 8px;`}
    >
      {#if editing}
        <!-- Empty droppable cells underneath -->
        {#each cells as cell (cell.row + '-' + cell.col)}
          <div
            role="gridcell"
            tabindex="-1"
            aria-label={`Cellule ${cell.col + 1},${cell.row + 1}`}
            data-col={cell.col}
            data-row={cell.row}
            ondragover={allowDropCell}
            ondrop={(e) => dropOnCell(e, cell.col, cell.row)}
            style={`grid-column:${cell.col + 1}; grid-row:${cell.row + 1};`}
            class="rounded-md border border-dashed border-edge/60"
          ></div>
        {/each}
      {/if}

      {#each placed as spot (spot.id)}
        {@const occ = spot.occupyingVisit}
        {#if editing}
          <!-- Edit mode: tile is draggable for layout, overlaid on its cell -->
          <div
            role="button"
            tabindex="0"
            draggable="true"
            ondragstart={(e) => dragSpotLayout(e, spot)}
            ondragover={allowDropCell}
            ondrop={(e) => dropOnCell(e, (spot.posX as number), (spot.posY as number))}
            style={`grid-column:${(spot.posX as number) + 1}; grid-row:${(spot.posY as number) + 1};`}
            class="flex cursor-grab flex-col rounded-md border-2 border-dashed border-accent/50 bg-surface px-2 py-1.5 shadow-sm active:cursor-grabbing"
          >
            <div class="flex items-center justify-between gap-1">
              <span class="truncate text-sm font-bold text-ink">{spot.code}</span>
              <span class="text-[10px] font-medium text-ink-faint">{typeLabel(spot.type)}</span>
            </div>
            {#if occ}
              <div class="mt-1 truncate text-xs text-ink-muted">{occ.visitNumber}</div>
            {:else}
              <div class="mt-1 text-xs text-ink-faint">Libre</div>
            {/if}
          </div>
        {:else}
          <!-- Operation mode -->
          <div
            role="button"
            tabindex="0"
            draggable={occ ? true : false}
            ondragstart={(e) => dragVisitFromSpot(e, spot)}
            ondragover={(e) => allowDropOnFree(e, spot)}
            ondrop={(e) => dropOnSpot(e, spot)}
            onclick={() => { if (occ) onOpenSpot(spot); }}
            onkeydown={(e) => { if (occ && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenSpot(spot); } }}
            style={`grid-column:${(spot.posX as number) + 1}; grid-row:${(spot.posY as number) + 1};`}
            class={`flex flex-col rounded-md border px-2 py-1.5 text-left shadow-sm transition-shadow ${
              !spot.isActive
                ? 'border-edge bg-surface-muted/60 opacity-60'
                : occ
                  ? 'cursor-grab border-warn/50 bg-warn-soft/70 hover:shadow active:cursor-grabbing'
                  : 'border-dashed border-edge bg-surface hover:border-accent/50'
            }`}
          >
            <div class="flex items-center justify-between gap-1">
              <span class="truncate text-sm font-bold text-ink">{spot.code}</span>
              <span class="shrink-0 text-[10px] font-medium text-ink-faint">{typeLabel(spot.type)}</span>
            </div>

            {#if !spot.isActive}
              <div class="mt-1 text-xs text-ink-faint">inactif</div>
            {:else if occ}
              <div class="mt-0.5 flex min-w-0 items-center gap-1">
                <span class="truncate text-xs font-semibold text-ink">{occ.visitNumber}</span>
                <Badge tone={directionTone(occ.direction)}>{occ.direction === 'INBOUND' ? 'IN' : occ.direction === 'OUTBOUND' ? 'OUT' : occ.direction}</Badge>
              </div>
              <div class="truncate text-xs text-ink-muted">{trailerLabel(occ)}</div>
              {#if dwellOf(occ)}
                <div class="mt-auto pt-0.5 text-[11px] font-medium text-warn">⏱ {dwellOf(occ)}</div>
              {/if}
            {:else}
              <div class="mt-auto text-xs text-ink-faint">Libre</div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>
