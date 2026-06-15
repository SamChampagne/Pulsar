<script lang="ts">
  import { Badge, Button, Card, toneFor, labelFor } from '$lib/components/ui';

  type ShipmentOnLoad = {
    id: string;
    shipmentNumber: string;
    status: string;
    weightKg?: number | null;
    volumeM3?: number | null;
    palletCount?: number | null;
  };

  type LoadStop = {
    id: string;
    sequence: number;
    type: string;
    location?: { name?: string | null; city?: string | null } | null;
    plannedArrivalEarly?: string | null;
    plannedArrivalLate?: string | null;
  };

  type LoadDetail = {
    id: string;
    loadNumber: string;
    status: string;
    estimatedCost?: string | number | null;
    costCurrency?: string | null;
    shipments?: ShipmentOnLoad[];
    route?: { stops?: LoadStop[] | null } | null;
  };

  type LoadOption = { id: string; loadNumber: string; status: string };

  let {
    selectedLoad,
    openLoads,
    selectedLoadId,
    hasSelection,
    busy,
    onSelectLoad,
    onConsolidate,
    onAddSelection,
    onRemoveShipment,
    canAddSelection = true,
    canRemoveShipment = true,
  }: {
    selectedLoad: LoadDetail | null;
    openLoads: LoadOption[];
    selectedLoadId: string | null;
    hasSelection: boolean;
    busy: boolean;
    onSelectLoad: (id: string) => void;
    onConsolidate: () => void;
    onAddSelection: () => void;
    onRemoveShipment: (shipmentId: string) => void;
    canAddSelection?: boolean;
    canRemoveShipment?: boolean;
  } = $props();

  const shipments = $derived(selectedLoad?.shipments ?? []);
  const stops = $derived([...(selectedLoad?.route?.stops ?? [])].sort((a, b) => a.sequence - b.sequence));

  /** Sum a numeric axis across assigned shipments (fields may be absent on the load payload). */
  function sumAxis(key: 'weightKg' | 'volumeM3' | 'palletCount'): number {
    return shipments.reduce((acc, s) => acc + (s[key] ?? 0), 0);
  }

  const usedWeight = $derived(sumAxis('weightKg'));
  const usedVolume = $derived(sumAxis('volumeM3'));
  const usedPallets = $derived(sumAxis('palletCount'));

  const fmtCost = $derived(
    selectedLoad?.estimatedCost != null && selectedLoad.estimatedCost !== ''
      ? `${Number(selectedLoad.estimatedCost).toLocaleString()} ${selectedLoad.costCurrency ?? ''}`.trim()
      : '—',
  );

  const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

  function handleSelect(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (value) onSelectLoad(value);
  }
</script>

<div class="flex flex-col overflow-hidden rounded-card border border-edge bg-surface">
  <!-- Top bar -->
  <div class="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
    <select
      value={selectedLoadId ?? ''}
      onchange={handleSelect}
      class="min-w-0 flex-1 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    >
      <option value="" disabled>Choisir un load…</option>
      {#each openLoads as l (l.id)}
        <option value={l.id}>{l.loadNumber} ({l.status})</option>
      {/each}
    </select>
    <Button
      variant="primary"
      disabled={!hasSelection || busy}
      loading={busy}
      onclick={onConsolidate}
    >
      Consolider en load
    </Button>
  </div>

  <div class="flex-1 overflow-y-auto p-3">
    {#if !selectedLoad}
      <p class="p-6 text-center text-sm text-ink-faint">
        Sélectionnez un load ou consolidez des shipments sélectionnés.
      </p>
    {:else}
      <!-- Header -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-ink">{selectedLoad.loadNumber}</span>
          <Badge tone={toneFor(selectedLoad.status)}>{labelFor(selectedLoad.status)}</Badge>
        </div>
        <span class="text-sm font-semibold text-ink">{fmtCost}</span>
      </div>

      <!-- Capacity (used totals; no per-axis maxima exposed on the load payload) -->
      <Card>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Capacité (utilisée)</h3>
        <div class="grid grid-cols-3 gap-3 text-center">
          <div>
            <div class="text-lg font-semibold text-ink">{usedWeight.toLocaleString()}</div>
            <div class="text-xs text-ink-muted">kg</div>
          </div>
          <div>
            <div class="text-lg font-semibold text-ink">{usedVolume.toLocaleString()}</div>
            <div class="text-xs text-ink-muted">m³</div>
          </div>
          <div>
            <div class="text-lg font-semibold text-ink">{usedPallets.toLocaleString()}</div>
            <div class="text-xs text-ink-muted">pal</div>
          </div>
        </div>
      </Card>

      <!-- Stops timeline -->
      <div class="mt-4">
        <Card>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Stops</h3>
          {#if stops.length === 0}
            <p class="text-sm text-ink-muted">Aucun stop (générez la route).</p>
          {:else}
            <ol class="flex flex-col gap-2">
              {#each stops as stop (stop.id)}
                <li class="flex items-center gap-2 border-b border-edge pb-2 text-sm last:border-0 last:pb-0">
                  <Badge tone={stop.type === 'PICKUP' ? 'info' : 'ok'}>{stop.type}</Badge>
                  <span class="min-w-0 flex-1 truncate text-ink">
                    {[stop.location?.name, stop.location?.city].filter(Boolean).join(', ') || '—'}
                  </span>
                  <span class="text-xs text-ink-muted whitespace-nowrap">{fmtTime(stop.plannedArrivalEarly)}</span>
                </li>
              {/each}
            </ol>
          {/if}
        </Card>
      </div>

      <!-- Assigned shipments -->
      <div class="mt-4">
        <Card>
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Shipments</h3>
            <Badge tone="neutral">{shipments.length}</Badge>
          </div>
          {#if shipments.length === 0}
            <p class="text-sm text-ink-muted">Aucun shipment assigné.</p>
          {:else}
            <ul class="flex flex-col gap-1.5">
              {#each shipments as s (s.id)}
                <li class="flex items-center justify-between gap-2 rounded-md border border-edge px-2 py-1.5 text-sm">
                  <span class="flex items-center gap-2">
                    <span class="font-medium text-ink">{s.shipmentNumber}</span>
                    <Badge tone={toneFor(s.status)}>{labelFor(s.status)}</Badge>
                  </span>
                  <button
                    type="button"
                    onclick={() => onRemoveShipment(s.id)}
                    disabled={busy || !canRemoveShipment}
                    aria-label={`Retirer ${s.shipmentNumber}`}
                    class="rounded px-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="mt-3">
            <Button
              variant="secondary"
              disabled={!hasSelection || busy || !canAddSelection}
              loading={busy}
              onclick={onAddSelection}
            >
              Ajouter la sélection
            </Button>
          </div>
        </Card>
      </div>
    {/if}
  </div>
</div>
