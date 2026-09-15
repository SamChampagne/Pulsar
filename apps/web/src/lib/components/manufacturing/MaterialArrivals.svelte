<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { Badge, Button } from '$lib/components/ui';
  import type { MaterialPurchase } from './material-purchase-types';
  let { onselect }: { onselect: (id: string) => void } = $props();
  let rows = $state<(MaterialPurchase & { arrivalState: string })[]>([]),
    page = $state(1),
    total = $state(0),
    busy = $state(false),
    error = $state('');
  const labels: Record<string, string> = {
    LATE: 'En retard',
    THIS_WEEK: 'Sous 7 jours',
    UPCOMING: 'À venir',
    RECEIVED: 'Reçu en totalité',
    CLOSED: 'Reliquat clôturé',
  };
  async function load() {
    busy = true;
    error = '';
    try {
      const data = await api<{ items: typeof rows; total: number }>(
        '/manufacturing/material-purchases/workspace/arrivals',
        { query: { page, pageSize: 20 } },
      );
      rows = data.items;
      total = data.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Arrivages indisponibles.';
    } finally {
      busy = false;
    }
  }
  onMount(load);
</script>

<section aria-label="Arrivages fournisseurs" class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="font-semibold">Arrivages fournisseurs</h2>
      <p class="text-sm text-ink-muted">
        Promesses en dates UTC · aucune quantité brouillon ne compte comme stock.
      </p>
    </div>
    <a href="/manufacturing/materials" class="text-sm text-accent hover:underline"
      >Voir les impacts fabrication →</a
    ><Button variant="secondary" disabled={busy} onclick={load}>Actualiser les arrivages</Button>
  </div>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if busy}<p role="status" class="p-6 text-ink-muted">
      Lecture des arrivages…
    </p>{:else if !rows.length}<div class="rounded-md border border-dashed border-edge p-8">
      <h3 class="font-medium">Aucun arrivage confirmé</h3>
      <p class="mt-2 text-sm text-ink-muted">
        Confirmez un achat depuis les demandes pour suivre ici sa date promise et ses réceptions.
      </p>
    </div>{:else}
    <div class="divide-y divide-edge rounded-md border border-edge bg-surface">
      {#each rows as order}<button
          class="grid w-full gap-3 p-4 text-left transition-colors hover:bg-surface-muted sm:grid-cols-[8rem_1fr_auto]"
          onclick={() => onselect(order.preparation.id)}
        >
          <div
            class="border-l-2 pl-3"
            class:border-danger={order.arrivalState === 'LATE'}
            class:border-edge={order.arrivalState !== 'LATE'}
          >
            <p class="font-mono text-sm">{order.expectedDate.slice(0, 10)}</p>
            <Badge tone={order.arrivalState === 'LATE' ? 'danger' : 'neutral'}
              >{labels[order.arrivalState]}</Badge
            >
          </div>
          <div>
            <p class="font-medium">{order.preparation.item.name}</p>
            <p class="text-xs text-ink-muted">
              {order.number} · {order.supplier.name} · {order.preparation.location.name}
            </p>
            <p class="mt-2 text-xs">
              {order.received} reçus / {order.preparation.quantity}
              {order.preparation.unitSnapshot}{#if order.closedAt}
                · {order.closedQuantity} abandonnés{/if}
            </p>
            <progress
              aria-label={`Progression reçue ${order.number}`}
              class="mt-1 h-1.5 w-full max-w-xs accent-accent"
              max={Number(order.preparation.quantity)}
              value={Number(order.received)}
            ></progress>
          </div>
          <div class="text-sm">
            <p class="font-mono">{order.remaining} {order.preparation.unitSnapshot}</p>
            <p class="text-xs text-ink-muted">encore attendus</p>
          </div>
        </button>{/each}
    </div>
  {/if}
  <div class="flex items-center justify-between gap-3 text-sm">
    <Button
      variant="secondary"
      disabled={busy || page === 1}
      onclick={() => {
        page--;
        void load();
      }}>Précédent</Button
    ><span>{total} achats · page {page}</span><Button
      variant="secondary"
      disabled={busy || page * 20 >= total}
      onclick={() => {
        page++;
        void load();
      }}>Suivant</Button
    >
  </div>
</section>
