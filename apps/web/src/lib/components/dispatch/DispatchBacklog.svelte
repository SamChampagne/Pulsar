<script lang="ts">
  import { Badge } from '$lib/components/ui';

  type ShipmentRow = {
    id: string; shipmentNumber: string; status: string;
    plannedPickupEarly: string | null; plannedDeliveryEarly: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
    weightKg?: number | null; volumeM3?: number | null; palletCount?: number | null;
  };

  let {
    backlog,
    backlogLoading,
    selectedIds,
    onToggle,
  }: {
    backlog: ShipmentRow[];
    backlogLoading: boolean;
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
  } = $props();

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const isLate = (d: string | null) => !!d && new Date(d).getTime() < Date.now();
</script>

<div class="flex flex-col overflow-hidden rounded-card border border-edge bg-surface">
  <div class="flex items-center justify-between border-b border-edge px-3 py-2">
    <span class="text-sm font-semibold text-ink">Backlog</span>
    <Badge tone="neutral">{backlog.length}</Badge>
  </div>
  <div class="flex-1 space-y-1.5 overflow-y-auto p-2">
    {#if backlogLoading}
      <p class="p-3 text-center text-xs text-ink-faint">Chargement…</p>
    {:else if backlog.length === 0}
      <p class="p-3 text-center text-xs text-ink-faint">Aucun shipment non planifié.</p>
    {:else}
      {#each backlog as s (s.id)}
        <button
          type="button"
          onclick={() => onToggle(s.id)}
          aria-pressed={selectedIds.has(s.id)}
          class={`w-full rounded-md border p-2 text-left text-xs transition ${selectedIds.has(s.id) ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-edge hover:border-accent'}`}
        >
          <div class="flex items-center justify-between">
            <span class="font-semibold text-ink">{s.shipmentNumber}</span>
            <span class="text-ink-faint">{s.transportOrder.orderNumber}</span>
          </div>
          <div class="mt-1 text-ink-muted">{s.originLocation.city} → {s.destinationLocation.city}</div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge tone={isLate(s.plannedPickupEarly) ? 'danger' : 'neutral'}>{fmt(s.plannedPickupEarly)} → {fmt(s.plannedDeliveryEarly)}</Badge>
            {#if s.weightKg}<Badge tone="neutral">{s.weightKg} kg</Badge>{/if}
            {#if s.volumeM3}<Badge tone="neutral">{s.volumeM3} m³</Badge>{/if}
            {#if s.palletCount}<Badge tone="neutral">{s.palletCount} pal</Badge>{/if}
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>
