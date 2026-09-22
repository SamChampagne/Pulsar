<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { Badge, Button, Drawer, Field, Input, PageHeader, Select } from '$lib/components/ui';
  type Component = {
    itemId: string;
    sku: string;
    name: string;
    unit: string;
    quantity: string;
    shortage: string;
    sources: { purchaseId: string | null; date: string; quantity: string }[];
  };
  type Impact = {
    id: string;
    number: string;
    name: string;
    status: string;
    state: string;
    targetDate: string;
    readyDate: string | null;
    delayDays: number | null;
    hasActuals: boolean;
    components: Component[];
  };
  type View = {
    site: { id: string; name: string };
    asOf: string;
    baselineId: string | null;
    orders: Impact[];
    unassessedOrders: { id: string; number: string; reason: string }[];
    arrivals: { id: string; preparationId: string; number: string; expectedDate: string }[];
    guidance: string;
  };
  let sites = $state<{ id: string; name: string }[]>([]),
    site = $state(''),
    search = $state(''),
    siteTotal = $state(0);
  let data = $state<View | null>(null),
    busy = $state(false),
    error = $state(''),
    selected = $state<Impact | null>(null),
    open = $state(false),
    filter = $state('ALL');
  const labels: Record<string, string> = {
    READY: 'Matières disponibles',
    WAITING: 'En attente d’arrivage',
    SHORTAGE: 'Manque non couvert',
  };
  const visible = $derived(
    data?.orders.filter((o) => filter === 'ALL' || o.state === filter) ?? [],
  );
  async function choices() {
    busy = true;
    error = '';
    try {
      const result = await api<{ items: typeof sites; total: number }>('/wms/sites', {
        query: { pageSize: 100, search },
      });
      sites = result.items;
      siteTotal = result.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Sites indisponibles.';
    } finally {
      busy = false;
    }
  }
  async function load() {
    data = null;
    selected = null;
    open = false;
    busy = true;
    error = '';
    try {
      data = await api<View>('/manufacturing/scheduling/material-impact', {
        query: { locationId: site },
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Impacts indisponibles.';
    } finally {
      busy = false;
    }
  }
  onMount(choices);
</script>

<PageHeader
  eyebrow="Fabrication · Matières et capacité"
  title="Impacts fabrication"
  subtitle="Comprendre ce qui peut avancer et ce qui attend une matière, avant de recalculer le planning."
>
  {#snippet actions()}<Button href="/manufacturing/purchasing" variant="secondary"
      >Achats matières</Button
    ><Button href="/manufacturing/scheduling" variant="secondary">Simuler dans l’APS</Button
    >{/snippet}
</PageHeader>
<section
  class="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-edge bg-surface p-4"
  aria-label="Site de fabrication"
>
  <Field label="Rechercher un site"><Input bind:value={search} disabled={busy} /></Field><Button
    variant="secondary"
    disabled={busy}
    onclick={choices}>Rechercher</Button
  >
  <Field label="Entrepôt de fabrication"
    ><Select
      bind:value={site}
      disabled={busy}
      onchange={() => {
        data = null;
      }}
      ><option value="">Choisir un site…</option>{#each sites as s}<option value={s.id}
          >{s.name}</option
        >{/each}</Select
    ></Field
  ><Button disabled={busy || !site} onclick={load}>Analyser les impacts</Button
  >{#if siteTotal > 100}<p class="text-xs text-ink-muted">
      Précisez la recherche : {siteTotal} sites.
    </p>{/if}
</section>
{#if error}<p role="alert" class="mb-4 text-sm text-danger">{error}</p>{/if}
{#if busy}<p role="status" class="p-6 text-ink-muted">
    Lecture des matières et du planning…
  </p>{:else if data}
  <p class="mb-4 max-w-4xl text-sm text-ink-muted">{data.guidance}</p>
  <nav aria-label="État matières des ordres" class="mb-5 flex flex-wrap gap-2">
    {#each ['ALL', 'READY', 'WAITING', 'SHORTAGE'] as state}<Button
        variant={filter === state ? 'primary' : 'secondary'}
        onclick={() => {
          filter = state;
        }}
        >{state === 'ALL' ? 'Tous les OF' : labels[state]} · {state === 'ALL'
          ? data.orders.length
          : data.orders.filter((o) => o.state === state).length}</Button
      >{/each}
  </nav>
  {#if !visible.length}<div
      class="rounded-md border border-dashed border-edge p-8 text-sm text-ink-muted"
    >
      Aucun OF dans cette vue. Les OF libérés avec une définition matières figée sont analysés ici.
    </div>{:else}<div class="divide-y divide-edge rounded-md border border-edge bg-surface">
      {#each visible as order}<button
          class="flex w-full flex-wrap items-center gap-4 p-4 text-left transition-colors hover:bg-surface-muted"
          onclick={() => {
            selected = order;
            open = true;
          }}
          ><div class="min-w-0 flex-1 basis-64">
            <p class="font-mono text-xs text-ink-muted">{order.number}</p>
            <h2 class="mt-1 font-medium">{order.name}</h2>
            <p class="mt-1 text-xs text-ink-muted">
              Début de référence : {order.targetDate}{#if order.hasActuals}
                · production partiellement déclarée{/if}
            </p>
          </div>
          <div class="text-sm">
            <Badge
              tone={order.state === 'SHORTAGE' ? 'danger' : order.state === 'READY' ? 'ok' : 'warn'}
              >{labels[order.state]}</Badge
            >
            <p class="mt-2 font-mono">
              {order.readyDate
                ? `Disponibilité : ${order.readyDate}`
                : 'Date indéterminée'}{#if order.delayDays}
                · +{order.delayDays} j{/if}
            </p>
          </div></button
        >{/each}
    </div>{/if}
  {#each data.unassessedOrders as order}<p class="mt-3 text-sm text-warn">
      <a class="underline" href={`/manufacturing/orders/${order.id}`}>{order.number}</a> : {order.reason}
    </p>{/each}
{:else if !error}<div class="rounded-md border border-dashed border-edge p-8">
    <h2 class="font-medium">Une lecture par site, sans mélanger les stocks</h2>
    <p class="mt-2 max-w-2xl text-sm text-ink-muted">
      Choisissez le site pour voir les besoins restants des OF, les arrivages qui les couvrent et
      les manques à traiter.
    </p>
  </div>{/if}
<Drawer bind:open title={selected ? `${selected.number} · Matières` : 'Matières'} width="lg"
  >{#snippet children()}{#if selected && data}<div class="space-y-4">
        <p class="text-sm text-ink-muted">
          Allocation simulée selon les échéances, sans réservation. Les consommations réelles déjà
          déclarées sont déduites du besoin théorique.
        </p>
        {#each selected.components as line}<article class="rounded-md border border-edge p-4">
            <h3 class="font-medium">{line.name}</h3>
            <p class="text-xs font-mono text-ink-muted">{line.sku}</p>
            <p class="mt-2 text-sm">
              Besoin restant : {line.quantity}
              {line.unit} · manque non couvert : {line.shortage}
              {line.unit}
            </p>
            {#each line.sources as source}<p class="mt-2 text-sm">
                {source.quantity}
                {line.unit} · {source.date} · {#if source.purchaseId}{@const purchase =
                    data.arrivals.find((a) => a.id === source.purchaseId)}<a
                    class="text-accent hover:underline"
                    href={`/manufacturing/purchasing?preparationId=${purchase?.preparationId}`}
                    >{purchase?.number ?? 'Achat'}</a
                  >{:else}stock physique{/if}
              </p>{/each}
          </article>{/each}<Button href={`/manufacturing/orders/${selected.id}`}
          >Ouvrir l’OF et l’atelier</Button
        ><Button href="/manufacturing/scheduling" variant="secondary"
          >Calculer un scénario APS</Button
        >
      </div>{/if}{/snippet}</Drawer
>
