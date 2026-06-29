<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatMoney, formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    Field,
    Input,
    Select,
  } from '$lib/components/ui';

  type EndpointType = 'LOCATION' | 'CITY' | 'STATE' | 'COUNTRY';

  const ENDPOINT_LABELS: Record<EndpointType, string> = {
    LOCATION: 'Site',
    CITY: 'Ville',
    STATE: 'Province / État',
    COUNTRY: 'Pays',
  };

  // ─── Option lists ──────────────────────────────────────────────────────────────
  interface LaneOption {
    id: string;
    name: string | null;
    originType: string;
    destinationType: string;
  }
  interface LocationOption {
    id: string;
    code: string;
    name: string;
    city: string;
  }
  interface CarrierOption {
    id: string;
    code: string;
    name: string;
  }
  interface AccessorialOpt {
    id: string;
    name: string;
    code: string;
    unit: string;
  }

  // ─── Simulate response shapes (mirror RatingService.shopRates / CostBreakdown) ───
  interface CostLine {
    type: string;
    code?: string;
    label: string;
    amount: number;
  }
  interface AppliedBreak {
    upToKg: number;
    amount: number;
    asIfApplied: boolean;
    asIfWeightKg?: number;
  }
  interface Breakdown {
    lines: CostLine[];
    base: number;
    fuelSurcharge: number;
    accessorialsTotal: number;
    total: number;
    appliedBreak: AppliedBreak | null;
    missingAccessorials: string[];
  }
  interface FuelResolution {
    pct: number;
    source: 'TABLE' | 'STATIC' | 'NONE';
    tableId?: string;
    effectiveFrom?: string;
  }
  interface RateOption {
    rateId: string;
    rateName: string;
    currency: string;
    carrier: { id: string; code: string; name: string } | null;
    laneSpecificity: { originType: string; destinationType: string; total: number } | null;
    breakdown: Breakdown;
    fuel: FuelResolution;
    missingAccessorials: string[];
  }
  interface SimulateResult {
    referenceDate: string;
    resolved: { originKey: string; destinationKey: string };
    options: RateOption[];
  }

  // ─── Option data ─────────────────────────────────────────────────────────────
  let lanes = $state<LaneOption[]>([]);
  let locations = $state<LocationOption[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let accessorials = $state<AccessorialOpt[]>([]);
  let loadingOptions = $state(true);
  let optionsError = $state('');

  // ─── Form state ────────────────────────────────────────────────────────────────
  let inputMode = $state<'lane' | 'manual'>('lane');
  let laneId = $state('');

  let originType = $state<EndpointType>('LOCATION');
  let originLocationId = $state('');
  let originCity = $state('');
  let originState = $state('');
  let originCountry = $state('');

  let destinationType = $state<EndpointType>('LOCATION');
  let destinationLocationId = $state('');
  let destinationCity = $state('');
  let destinationState = $state('');
  let destinationCountry = $state('');

  let weightKg = $state<number | null>(null);
  let distanceKm = $state<number | null>(null);
  let palletCount = $state<number | null>(null);
  let referenceDate = $state('');
  let simMode = $state<string>('');
  let selectedAccessorials = $state<string[]>([]);
  let selectedCarriers = $state<string[]>([]);

  // ─── Results state ───────────────────────────────────────────────────────────
  let result = $state<SimulateResult | null>(null);
  let simulating = $state(false);
  let simError = $state('');
  let expanded = $state<Record<string, boolean>>({});

  // ─── Matrice des tarifs (heatmap lane × transporteur, baseAmount) ───────────────
  interface MatrixRate {
    id: string;
    name: string;
    rateType: string;
    baseAmount: number;
    currency: string | null;
    mode: string | null;
    carrier: { id: string; code: string; name: string } | null;
    lane: { id: string; name: string | null; originType: string; destinationType: string } | null;
  }
  let matrixRates = $state<MatrixRate[]>([]);
  let loadingMatrix = $state(true);
  let matrixError = $state('');

  async function loadMatrix() {
    loadingMatrix = true;
    matrixError = '';
    try {
      const res = await api<Paginated<MatrixRate>>('/transportation/rates', {
        query: { pageSize: 100 },
      });
      matrixRates = res.items;
    } catch (e) {
      matrixError = e instanceof ApiError ? e.message : 'Échec du chargement des tarifs';
    } finally {
      loadingMatrix = false;
    }
  }

  const GENERIC_LANE_ID = '__generic__';
  const GENERIC_CARRIER_ID = '__generic__';

  function laneRowLabel(lane: MatrixRate['lane']): string {
    if (!lane) return 'Voie générique';
    return lane.name ?? `${lane.originType} → ${lane.destinationType}`;
  }

  // Rows = lanes (incl. a generic bucket), columns = carriers (incl. a generic bucket).
  // A cell holds the cheapest base rate for that (lane, carrier) pair.
  const matrix = $derived.by(() => {
    const rowMap = new Map<string, { id: string; label: string }>();
    const colMap = new Map<string, { id: string; label: string }>();
    const cells = new Map<string, { amount: number; currency: string | null; count: number }>();

    let min = Infinity;
    let max = -Infinity;

    for (const r of matrixRates) {
      const rowId = r.lane?.id ?? GENERIC_LANE_ID;
      const colId = r.carrier?.id ?? GENERIC_CARRIER_ID;
      if (!rowMap.has(rowId)) rowMap.set(rowId, { id: rowId, label: laneRowLabel(r.lane) });
      if (!colMap.has(colId))
        colMap.set(colId, { id: colId, label: r.carrier?.name ?? 'Générique' });

      // baseAmount arrives as a string (Prisma Decimal) — coerce to Number so
      // comparisons are numeric, not lexicographic ("25" vs "1450").
      const amt = Number(r.baseAmount);
      const key = `${rowId}::${colId}`;
      const existing = cells.get(key);
      if (!existing) {
        cells.set(key, { amount: amt, currency: r.currency, count: 1 });
      } else {
        existing.count += 1;
        if (amt < existing.amount) {
          existing.amount = amt;
          existing.currency = r.currency;
        }
      }
      if (amt < min) min = amt;
      if (amt > max) max = amt;
    }

    return {
      rows: [...rowMap.values()],
      cols: [...colMap.values()],
      cells,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      currency: matrixRates.find((r) => r.currency)?.currency ?? 'CAD',
    };
  });

  // Green (cheap) → amber → red (expensive) heat, via an hsl hue ramp on the normalized value.
  function heatColor(amount: number, min: number, max: number): string {
    const t = max > min ? (amount - min) / (max - min) : 0;
    const hue = 140 - t * 140; // 140 = vert, 0 = rouge
    return `hsl(${hue}, 70%, 88%)`;
  }
  function heatText(amount: number, min: number, max: number): string {
    const t = max > min ? (amount - min) / (max - min) : 0;
    const hue = 140 - t * 140;
    return `hsl(${hue}, 80%, 26%)`;
  }

  function laneLabel(lane: LaneOption): string {
    return lane.name ?? `${lane.originType} → ${lane.destinationType}`;
  }

  function buildEndpointBody(
    type: EndpointType,
    locationId: string,
    city: string,
    state: string,
    country: string,
  ): Record<string, string> {
    switch (type) {
      case 'LOCATION':
        return { locationId };
      case 'CITY':
        return { city, state, country };
      case 'STATE':
        return { state, country };
      case 'COUNTRY':
        return { country };
    }
  }

  function toggle(arr: string[], id: string): string[] {
    return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  }

  function fuelLabel(fuel: FuelResolution): string {
    const src =
      fuel.source === 'TABLE' ? 'table' : fuel.source === 'STATIC' ? 'fixe' : 'aucune';
    return `${fuel.pct}% (${src})`;
  }

  async function loadOptions() {
    try {
      const [lanesRes, locsRes, carriersRes, accsRes] = await Promise.all([
        api<Paginated<LaneOption>>('/transportation/lanes', { query: { pageSize: 100 } }),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
        api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
        api<Paginated<AccessorialOpt>>('/transportation/accessorials', { query: { pageSize: 100 } }),
      ]);
      lanes = lanesRes.items;
      locations = locsRes.items;
      carriers = carriersRes.items;
      accessorials = accsRes.items;
    } catch (e) {
      optionsError = e instanceof ApiError ? e.message : 'Échec du chargement des données';
    } finally {
      loadingOptions = false;
    }
  }

  async function simulate(event: SubmitEvent) {
    event.preventDefault();
    simError = '';
    simulating = true;
    expanded = {};
    try {
      const body: Record<string, unknown> = {};

      if (inputMode === 'lane') {
        if (!laneId) {
          simError = 'Sélectionnez une voie.';
          simulating = false;
          return;
        }
        body.laneId = laneId;
      } else {
        body.originType = originType;
        body.origin = buildEndpointBody(
          originType,
          originLocationId,
          originCity,
          originState,
          originCountry,
        );
        body.destinationType = destinationType;
        body.destination = buildEndpointBody(
          destinationType,
          destinationLocationId,
          destinationCity,
          destinationState,
          destinationCountry,
        );
      }

      if (weightKg !== null) body.weightKg = Number(weightKg);
      if (distanceKm !== null) body.distanceKm = Number(distanceKm);
      if (palletCount !== null) body.palletCount = Number(palletCount);
      if (referenceDate) body.referenceDate = new Date(referenceDate).toISOString();
      if (simMode) body.mode = simMode;
      if (selectedAccessorials.length > 0) body.accessorialCodes = selectedAccessorials;
      if (selectedCarriers.length > 0) body.carrierIds = selectedCarriers;

      result = await api<SimulateResult>('/transportation/rating/simulate', {
        method: 'POST',
        body,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la simulation';
      simError = msg;
      toast.error(msg);
    } finally {
      simulating = false;
    }
  }

  $effect(() => {
    void loadOptions();
    void loadMatrix();
  });
</script>

<PageHeader title="Rate Studio" />

<p class="mb-4 max-w-3xl text-sm text-ink-muted">
  Simulez un prix sur une voie, un poids et une date hypothétiques (sans chargement), comparez les
  transporteurs côte à côte et expliquez pourquoi tel tarif s'applique. Aucune donnée n'est créée.
</p>

{#if optionsError}<p class="mb-3 text-sm text-danger">{optionsError}</p>{/if}

<!-- ─── Section 1 — Simulateur ───────────────────────────────────────────────── -->
<Card>
  {#snippet children()}
    {#if loadingOptions}
      <Skeleton rows={5} />
    {:else}
      <form onsubmit={simulate} class="space-y-4">
        <div>
          <span class="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Origine / destination</span>
          <div class="inline-flex rounded-inner border border-edge p-0.5">
            <button
              type="button"
              class={`rounded px-3 py-1 text-sm font-medium ${inputMode === 'lane' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
              onclick={() => (inputMode = 'lane')}
            >Voie existante</button>
            <button
              type="button"
              class={`rounded px-3 py-1 text-sm font-medium ${inputMode === 'manual' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
              onclick={() => (inputMode = 'manual')}
            >Saisie manuelle</button>
          </div>
        </div>

        {#if inputMode === 'lane'}
          <Field label="Voie">
            <Select bind:value={laneId} required>
              <option value="" disabled>Sélectionner une voie…</option>
              {#each lanes as l (l.id)}<option value={l.id}>{laneLabel(l)}</option>{/each}
            </Select>
          </Field>
        {:else}
          <div class="grid gap-4 md:grid-cols-2">
            <fieldset class="space-y-2 rounded-inner border border-edge p-3">
              <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Origine</legend>
              <Field label="Niveau">
                <Select bind:value={originType}>
                  {#each Object.keys(ENDPOINT_LABELS) as t (t)}
                    <option value={t}>{ENDPOINT_LABELS[t as EndpointType]}</option>
                  {/each}
                </Select>
              </Field>
              {#if originType === 'LOCATION'}
                <Field label="Site">
                  <Select bind:value={originLocationId} required>
                    <option value="" disabled>Sélectionner…</option>
                    {#each locations as l (l.id)}<option value={l.id}>{l.name} ({l.city})</option>{/each}
                  </Select>
                </Field>
              {:else if originType === 'CITY'}
                <Field label="Ville"><Input bind:value={originCity} required placeholder="Montréal" /></Field>
                <Field label="Province / État"><Input bind:value={originState} required placeholder="QC" /></Field>
                <Field label="Pays"><Input bind:value={originCountry} required placeholder="CA" /></Field>
              {:else if originType === 'STATE'}
                <Field label="Province / État"><Input bind:value={originState} required placeholder="QC" /></Field>
                <Field label="Pays"><Input bind:value={originCountry} required placeholder="CA" /></Field>
              {:else if originType === 'COUNTRY'}
                <Field label="Pays"><Input bind:value={originCountry} required placeholder="CA" /></Field>
              {/if}
            </fieldset>

            <fieldset class="space-y-2 rounded-inner border border-edge p-3">
              <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Destination</legend>
              <Field label="Niveau">
                <Select bind:value={destinationType}>
                  {#each Object.keys(ENDPOINT_LABELS) as t (t)}
                    <option value={t}>{ENDPOINT_LABELS[t as EndpointType]}</option>
                  {/each}
                </Select>
              </Field>
              {#if destinationType === 'LOCATION'}
                <Field label="Site">
                  <Select bind:value={destinationLocationId} required>
                    <option value="" disabled>Sélectionner…</option>
                    {#each locations as l (l.id)}<option value={l.id}>{l.name} ({l.city})</option>{/each}
                  </Select>
                </Field>
              {:else if destinationType === 'CITY'}
                <Field label="Ville"><Input bind:value={destinationCity} required placeholder="Toronto" /></Field>
                <Field label="Province / État"><Input bind:value={destinationState} required placeholder="ON" /></Field>
                <Field label="Pays"><Input bind:value={destinationCountry} required placeholder="CA" /></Field>
              {:else if destinationType === 'STATE'}
                <Field label="Province / État"><Input bind:value={destinationState} required placeholder="ON" /></Field>
                <Field label="Pays"><Input bind:value={destinationCountry} required placeholder="CA" /></Field>
              {:else if destinationType === 'COUNTRY'}
                <Field label="Pays"><Input bind:value={destinationCountry} required placeholder="CA" /></Field>
              {/if}
            </fieldset>
          </div>
        {/if}

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Poids (kg)">
            <Input
              type="number"
              step="0.001"
              min="0"
              value={weightKg ?? ''}
              oninput={(e) => {
                const v = e.currentTarget.value;
                weightKg = v === '' ? null : parseFloat(v);
              }}
              placeholder="optionnel"
            />
          </Field>
          <Field label="Distance (km)">
            <Input
              type="number"
              step="0.1"
              min="0"
              value={distanceKm ?? ''}
              oninput={(e) => {
                const v = e.currentTarget.value;
                distanceKm = v === '' ? null : parseFloat(v);
              }}
              placeholder="optionnel"
            />
          </Field>
          <Field label="Palettes">
            <Input
              type="number"
              step="1"
              min="0"
              value={palletCount ?? ''}
              oninput={(e) => {
                const v = e.currentTarget.value;
                palletCount = v === '' ? null : parseInt(v, 10);
              }}
              placeholder="optionnel"
            />
          </Field>
          <Field label="Date de référence">
            <Input type="date" bind:value={referenceDate} />
          </Field>
        </div>

        <Field label="Mode">
          <Select bind:value={simMode}>
            <option value="">— tous les modes —</option>
            {#each Object.values(TransportMode) as m (m)}<option value={m}>{m}</option>{/each}
          </Select>
        </Field>

        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <span class="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Accessoriaux demandés</span>
            {#if accessorials.length === 0}
              <p class="text-xs text-ink-faint">Aucun accessorial configuré.</p>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                {#each accessorials as a (a.id)}
                  <button
                    type="button"
                    class={`rounded-inner border px-2 py-1 text-xs ${selectedAccessorials.includes(a.code) ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-ink-muted hover:text-ink'}`}
                    onclick={() => (selectedAccessorials = toggle(selectedAccessorials, a.code))}
                  >{a.code} – {a.name}</button>
                {/each}
              </div>
            {/if}
          </div>
          <div>
            <span class="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Transporteurs (vide = tous)</span>
            {#if carriers.length === 0}
              <p class="text-xs text-ink-faint">Aucun transporteur.</p>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                {#each carriers as c (c.id)}
                  <button
                    type="button"
                    class={`rounded-inner border px-2 py-1 text-xs ${selectedCarriers.includes(c.id) ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-ink-muted hover:text-ink'}`}
                    onclick={() => (selectedCarriers = toggle(selectedCarriers, c.id))}
                  >{c.name}</button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        {#if simError}<p class="text-sm text-danger">{simError}</p>{/if}

        <div class="flex justify-end border-t border-edge pt-3">
          <Button variant="primary" type="submit" disabled={simulating}>
            {simulating ? 'Simulation…' : 'Simuler'}
          </Button>
        </div>
      </form>
    {/if}
  {/snippet}
</Card>

<!-- ─── Section 2 — Résultats / comparaison transporteurs ────────────────────── -->
{#if result}
  <div class="mt-6">
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-base font-semibold text-ink">Comparaison transporteurs</h2>
      <span class="font-mono text-xs text-ink-muted">
        {result.resolved.originKey} → {result.resolved.destinationKey} · {formatDate(result.referenceDate)}
      </span>
    </div>

    {#if result.options.length === 0}
      <Card>
        <EmptyState message="Aucun tarif actif ne correspond à ce scénario." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>#</th><th>Tarif</th><th>Transporteur</th><th>Total</th><th>Spécificité</th><th>Alertes</th><th></th>
        {/snippet}
        {#snippet body()}
          {#each result?.options ?? [] as opt, i (opt.rateId)}
            <tr class="cursor-pointer" onclick={() => (expanded = { ...expanded, [opt.rateId]: !expanded[opt.rateId] })}>
              <td class="font-mono text-ink-muted">{i + 1}</td>
              <td><span class="font-semibold text-ink">{opt.rateName}</span></td>
              <td>{opt.carrier?.name ?? '—'}</td>
              <td class="font-mono tabular-nums text-ink">{formatMoney(opt.breakdown.total, opt.currency)}</td>
              <td class="font-mono text-xs text-ink-muted">{opt.laneSpecificity?.total ?? '—'}</td>
              <td>
                {#if opt.breakdown.missingAccessorials.length > 0}
                  <Badge tone="warn">Accessoriaux manquants ({opt.breakdown.missingAccessorials.length})</Badge>
                {:else}
                  <span class="text-ink-faint">—</span>
                {/if}
              </td>
              <td class="text-right text-ink-muted">{expanded[opt.rateId] ? '▾' : '▸'}</td>
            </tr>
            {#if expanded[opt.rateId]}
              <tr>
                <td colspan="7" class="bg-surface-muted">
                  <div class="space-y-3 px-2 py-3">
                    <div class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Pourquoi ce tarif ?</div>

                    <table class="w-full text-sm">
                      <tbody>
                        {#each opt.breakdown.lines as line (line.label + line.type + (line.code ?? ''))}
                          <tr class="border-b border-edge/50">
                            <td class="py-1 text-ink">
                              {line.label}
                              {#if line.code}<span class="ml-1 font-mono text-xs text-ink-muted">{line.code}</span>{/if}
                            </td>
                            <td class="py-1 text-right font-mono tabular-nums text-ink">{formatMoney(line.amount, opt.currency)}</td>
                          </tr>
                        {/each}
                        <tr>
                          <td class="py-1 font-semibold text-ink">Total</td>
                          <td class="py-1 text-right font-mono font-semibold tabular-nums text-ink">{formatMoney(opt.breakdown.total, opt.currency)}</td>
                        </tr>
                      </tbody>
                    </table>

                    <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
                      <span>Base&nbsp;<span class="font-mono text-ink">{formatMoney(opt.breakdown.base, opt.currency)}</span></span>
                      <span>Carburant&nbsp;<span class="font-mono text-ink">{formatMoney(opt.breakdown.fuelSurcharge, opt.currency)}</span> · {fuelLabel(opt.fuel)}</span>
                      <span>Accessoriaux&nbsp;<span class="font-mono text-ink">{formatMoney(opt.breakdown.accessorialsTotal, opt.currency)}</span></span>
                      {#if opt.laneSpecificity}
                        <span>Voie&nbsp;<span class="font-mono text-ink">{opt.laneSpecificity.originType} → {opt.laneSpecificity.destinationType}</span> (spéc. {opt.laneSpecificity.total})</span>
                      {:else}
                        <span>Voie&nbsp;<span class="text-ink">générique</span></span>
                      {/if}
                    </div>

                    {#if opt.breakdown.appliedBreak}
                      <div class="text-xs text-ink-muted">
                        Palier appliqué : jusqu'à <span class="font-mono text-ink">{opt.breakdown.appliedBreak.upToKg} kg</span>
                        @ <span class="font-mono text-ink">{opt.breakdown.appliedBreak.amount}</span>
                        {#if opt.breakdown.appliedBreak.asIfApplied}
                          <Badge tone="neutral">règle « as-if » · poids fictif {opt.breakdown.appliedBreak.asIfWeightKg} kg</Badge>
                        {/if}
                      </div>
                    {/if}

                    {#if opt.breakdown.missingAccessorials.length > 0}
                      <div class="text-xs text-warn">
                        Accessoriaux demandés non tarifés : <span class="font-mono">{opt.breakdown.missingAccessorials.join(', ')}</span>
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        {/snippet}
      </Table>
    {/if}
  </div>
{/if}

<!-- ─── Section 3 — Matrice des tarifs (heatmap) ─────────────────────────────── -->
<div class="mt-8">
  <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-base font-semibold text-ink">Matrice des tarifs</h2>
    <span class="text-xs text-ink-muted">
      Tarif de base par voie et transporteur — la cellule retient le tarif le plus bas du couple.
    </span>
  </div>

  <Card>
    {#snippet children()}
      {#if loadingMatrix}
        <Skeleton rows={5} />
      {:else if matrixError}
        <p class="text-sm text-danger">{matrixError}</p>
      {:else if matrix.rows.length === 0}
        <EmptyState
          message="Aucun tarif configuré pour le moment — la matrice apparaîtra dès que des grilles tarifaires existeront."
        />
      {:else}
        <!-- Légende -->
        <div class="mb-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <span>Tarif de base&nbsp;:</span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-3 w-4 rounded-inner border border-edge-soft" style="background-color: {heatColor(matrix.min, matrix.min, matrix.max)}"></span>
            bas <span class="font-mono text-ink">{formatMoney(matrix.min, matrix.currency)}</span>
          </span>
          <span
            class="inline-block h-3 w-24 rounded-inner border border-edge-soft"
            style="background-image: linear-gradient(to right, hsl(140,70%,88%), hsl(70,70%,88%), hsl(0,70%,88%))"
          ></span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-3 w-4 rounded-inner border border-edge-soft" style="background-color: {heatColor(matrix.max, matrix.min, matrix.max)}"></span>
            élevé <span class="font-mono text-ink">{formatMoney(matrix.max, matrix.currency)}</span>
          </span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th class="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                  Voie ＼ Transporteur
                </th>
                {#each matrix.cols as col (col.id)}
                  <th class="px-3 py-2 text-center text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-muted uppercase">
                    {col.label}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each matrix.rows as row (row.id)}
                <tr class="border-t border-edge-soft">
                  <th class="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium whitespace-nowrap text-ink">
                    {row.label}
                  </th>
                  {#each matrix.cols as col (col.id)}
                    {@const cell = matrix.cells.get(`${row.id}::${col.id}`)}
                    {#if cell}
                      <td
                        class="px-3 py-2 text-center font-mono tabular-nums"
                        style="background-color: {heatColor(cell.amount, matrix.min, matrix.max)}; color: {heatText(cell.amount, matrix.min, matrix.max)}"
                        title="{row.label} · {col.label}{cell.count > 1 ? ` · ${cell.count} tarifs (le plus bas affiché)` : ''}"
                      >
                        {formatMoney(cell.amount, cell.currency ?? matrix.currency)}
                      </td>
                    {:else}
                      <td class="px-3 py-2 text-center text-ink-faint">—</td>
                    {/if}
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <p class="mt-2 text-xs text-ink-faint">
          {matrix.rows.length} voie(s) × {matrix.cols.length} transporteur(s) · le « tarif de base »
          ne tient pas compte du carburant, des accessoriaux ni des paliers de poids — utilisez le
          simulateur ci-dessus pour un prix complet.
        </p>
      {/if}
    {/snippet}
  </Card>
</div>

<!-- ─── Section 4 — Hub tarification ─────────────────────────────────────────── -->
<div class="mt-8">
  <h2 class="mb-2 text-base font-semibold text-ink">Hub tarification</h2>
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each [
      { href: '/rates', label: 'Tarifs', desc: 'Grilles tarifaires et paliers' },
      { href: '/lanes', label: 'Voies (lanes)', desc: 'Corridors et préférences transporteurs' },
      { href: '/accessorials', label: 'Accessoriaux', desc: 'Frais additionnels' },
      { href: '/fuel-tables', label: 'Carburant', desc: 'Tables de surtaxe carburant' },
    ] as link (link.href)}
      <a href={link.href} class="block rounded-card border border-edge p-4 transition-colors hover:border-accent hover:bg-surface-muted">
        <div class="font-semibold text-ink">{link.label}</div>
        <div class="mt-0.5 text-xs text-ink-muted">{link.desc}</div>
      </a>
    {/each}
  </div>
</div>
