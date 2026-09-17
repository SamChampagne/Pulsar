<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card } from '$lib/components/ui';
  import LoadMap from '$lib/components/LoadMap.svelte';
  import { toast } from '$lib/stores/toast';

  interface LoadDetail {
    id: string;
    loadNumber: string;
    status: string;
    // The dispatch container types route loosely; the real payload carries route.id.
    route?: { id?: string; stops?: unknown[] | null } | null;
    [key: string]: unknown;
  }

  interface RouteStop {
    id: string;
    sequence: number;
    type: string;
    locationId: string;
  }
  interface RouteDetail {
    id: string;
    geometry: unknown;
    stops: RouteStop[];
  }

  interface RateOption {
    rateId: string;
    rateName: string;
    currency: string;
    carrier: { id: string; code: string; name: string } | null;
    laneSpecificity: { originType: string; destinationType: string; total: number } | null;
    breakdown: {
      lines: { type: string; code?: string; label: string; amount: number }[];
      total: number;
      appliedBreak: { upToKg: number; amount: number; asIfApplied: boolean } | null;
      missingAccessorials: string[];
    };
    missingAccessorials: string[];
  }

  let { selectedLoad, onChanged }: { selectedLoad: LoadDetail | null; onChanged: () => void } =
    $props();

  let route = $state<RouteDetail | null>(null);
  let mapStops = $state<{ sequence: number; locationId: string; type: string }[]>([]);

  let rateOptions = $state<RateOption[]>([]);
  let rateLoading = $state(false);
  let rateError = $state('');
  let expandedRateId = $state<string | null>(null);
  let tenderingId = $state<string | null>(null);

  // Best option per currency: first complete option (no missing accessorials).
  const bestRateIds = $derived.by(() => {
    const seen = new Set<string>();
    const best = new Set<string>();
    for (const opt of rateOptions) {
      if (opt.missingAccessorials.length === 0 && !seen.has(opt.currency)) {
        seen.add(opt.currency);
        best.add(opt.rateId);
      }
    }
    return best;
  });

  // Fetch route (for the map) + rate options whenever the selected load changes.
  $effect(() => {
    const load = selectedLoad;
    if (!load) {
      route = null;
      mapStops = [];
      rateOptions = [];
      rateError = '';
      expandedRateId = null;
      return;
    }

    let cancelled = false;
    void (async () => {
      // Map: fetch the route detail (the dispatch load only carries route.id).
      route = null;
      mapStops = [];
      if (load.route?.id) {
        try {
          const r = await api<RouteDetail>(`/transportation/routes/${load.route.id}`);
          if (cancelled) return;
          route = r;
          mapStops = r.stops.map((s) => ({
            sequence: s.sequence,
            locationId: s.locationId,
            type: s.type,
          }));
        } catch {
          if (!cancelled) {
            route = null;
            mapStops = [];
          }
        }
      }

      // Rate options.
      rateLoading = true;
      rateError = '';
      expandedRateId = null;
      try {
        const res = await api<{ referenceDate: string; options: RateOption[] }>(
          `/transportation/loads/${load.id}/rate-options`,
        );
        if (cancelled) return;
        rateOptions = res.options;
      } catch (e) {
        if (cancelled) return;
        rateOptions = [];
        rateError = e instanceof ApiError ? e.message : 'Échec du chargement des rates.';
      } finally {
        if (!cancelled) rateLoading = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  async function tender(opt: RateOption) {
    if (!selectedLoad || !opt.carrier) return;
    tenderingId = opt.rateId;
    try {
      const t = await api<{ emailedTo: string | null }>(
        `/transportation/loads/${selectedLoad.id}/tender`,
        { method: 'POST', body: { carrierId: opt.carrier.id } },
      );
      toast.success(
        t.emailedTo
          ? `Tender envoyé à ${opt.carrier.name} (${t.emailedTo})`
          : `Tender envoyé à ${opt.carrier.name}`,
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du tender.');
    } finally {
      tenderingId = null;
    }
  }
</script>

{#if !selectedLoad}
  <div class="rounded-card border border-edge bg-surface p-4 text-sm text-ink-faint">
    Sélectionnez un load pour voir la carte et les rates.
  </div>
{:else}
  <div class="flex flex-col gap-3">
    <!-- Route map -->
    <Card>
      <h2 class="mb-2 font-semibold text-ink">Carte</h2>
      {#if mapStops.length > 0}
        <LoadMap stops={mapStops} loadId={selectedLoad.id} geometry={route?.geometry ?? null} />
      {:else}
        <p class="text-sm text-ink-muted">Pas de route — aucun tracé à afficher.</p>
      {/if}
    </Card>

    <!-- Rate options + tender -->
    <Card>
      <h2 class="mb-3 font-semibold text-ink">Rate options</h2>
      {#if rateLoading}
        <p class="text-sm text-ink-muted">Chargement…</p>
      {:else if rateError}
        <p class="text-sm text-danger">{rateError}</p>
      {:else if rateOptions.length === 0}
        <p class="text-sm text-ink-muted">Aucune option de rate.</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each rateOptions as opt (opt.rateId)}
            <div class="rounded-md border border-edge bg-surface p-2">
              <div
                class="cursor-pointer"
                role="button"
                tabindex="0"
                onclick={() => {
                  expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter')
                    expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId;
                }}
              >
                <div class="flex items-center justify-between gap-2 text-sm">
                  <div class="flex flex-wrap items-center gap-1">
                    <span class="font-medium">{opt.rateName}</span>
                    {#if bestRateIds.has(opt.rateId)}
                      <Badge tone="ok">meilleur</Badge>
                    {/if}
                    {#if opt.missingAccessorials.length > 0}
                      <Badge tone="warn">manquants: {opt.missingAccessorials.length}</Badge>
                    {/if}
                  </div>
                  <span class="font-semibold whitespace-nowrap">
                    {opt.breakdown.total.toLocaleString('fr-CA')}
                    {opt.currency}
                  </span>
                </div>
                <div class="mt-0.5 text-xs text-ink-muted">
                  {opt.carrier?.name ?? '—'} ·
                  {opt.laneSpecificity
                    ? `${opt.laneSpecificity.originType}→${opt.laneSpecificity.destinationType} (spécificité ${opt.laneSpecificity.total})`
                    : 'catch-all'}
                </div>
              </div>

              {#if expandedRateId === opt.rateId}
                <table class="mt-2 w-full text-xs">
                  <tbody>
                    {#each opt.breakdown.lines as line (line.label)}
                      <tr>
                        <td class="py-0.5 text-ink-muted">{line.label}</td>
                        <td class="py-0.5 text-right"
                          >{line.amount.toLocaleString('fr-CA')} {opt.currency}</td
                        >
                      </tr>
                    {/each}
                  </tbody>
                </table>
                {#if opt.breakdown.appliedBreak}
                  {@const br = opt.breakdown.appliedBreak}
                  <p class="mt-1 text-xs text-ink-muted">
                    Break: ≤ {br.upToKg} kg @ {br.amount}
                    {#if br.asIfApplied}<Badge tone="warn">as-if</Badge>{/if}
                  </p>
                {/if}
                {#if opt.missingAccessorials.length > 0}
                  <p class="mt-1 text-xs text-danger">
                    Accessoriaux manquants: {opt.missingAccessorials.join(', ')}
                  </p>
                {/if}
              {/if}

              <div class="mt-2">
                <Button
                  variant="primary"
                  disabled={!opt.carrier || tenderingId !== null}
                  loading={tenderingId === opt.rateId}
                  onclick={() => tender(opt)}
                >
                  Tender
                </Button>
                {#if !opt.carrier}
                  <span class="ml-2 text-xs text-ink-muted">aucun transporteur sur ce rate</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{/if}
