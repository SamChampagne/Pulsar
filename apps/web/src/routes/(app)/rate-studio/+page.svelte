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
    const src = fuel.source === 'TABLE' ? 'table' : fuel.source === 'STATIC' ? 'fixe' : 'aucune';
    return `${fuel.pct}% (${src})`;
  }

  async function loadOptions() {
    try {
      const [lanesRes, locsRes, carriersRes, accsRes] = await Promise.all([
        api<Paginated<LaneOption>>('/transportation/lanes', { query: { pageSize: 100 } }),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
        api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
        api<Paginated<AccessorialOpt>>('/transportation/accessorials', {
          query: { pageSize: 100 },
        }),
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
  });
</script>

<PageHeader title="Tarification" />

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
          <span
            class="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
            >Origine / destination</span
          >
          <div class="inline-flex rounded-inner border border-edge p-0.5">
            <button
              type="button"
              class={`rounded px-3 py-1 text-sm font-medium ${inputMode === 'lane' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
              onclick={() => (inputMode = 'lane')}>Voie existante</button
            >
            <button
              type="button"
              class={`rounded px-3 py-1 text-sm font-medium ${inputMode === 'manual' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
              onclick={() => (inputMode = 'manual')}>Saisie manuelle</button
            >
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
              <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
                >Origine</legend
              >
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
                    {#each locations as l (l.id)}<option value={l.id}>{l.name} ({l.city})</option
                      >{/each}
                  </Select>
                </Field>
              {:else if originType === 'CITY'}
                <Field label="Ville"
                  ><Input bind:value={originCity} required placeholder="Montréal" /></Field
                >
                <Field label="Province / État"
                  ><Input bind:value={originState} required placeholder="QC" /></Field
                >
                <Field label="Pays"
                  ><Input bind:value={originCountry} required placeholder="CA" /></Field
                >
              {:else if originType === 'STATE'}
                <Field label="Province / État"
                  ><Input bind:value={originState} required placeholder="QC" /></Field
                >
                <Field label="Pays"
                  ><Input bind:value={originCountry} required placeholder="CA" /></Field
                >
              {:else if originType === 'COUNTRY'}
                <Field label="Pays"
                  ><Input bind:value={originCountry} required placeholder="CA" /></Field
                >
              {/if}
            </fieldset>

            <fieldset class="space-y-2 rounded-inner border border-edge p-3">
              <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
                >Destination</legend
              >
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
                    {#each locations as l (l.id)}<option value={l.id}>{l.name} ({l.city})</option
                      >{/each}
                  </Select>
                </Field>
              {:else if destinationType === 'CITY'}
                <Field label="Ville"
                  ><Input bind:value={destinationCity} required placeholder="Toronto" /></Field
                >
                <Field label="Province / État"
                  ><Input bind:value={destinationState} required placeholder="ON" /></Field
                >
                <Field label="Pays"
                  ><Input bind:value={destinationCountry} required placeholder="CA" /></Field
                >
              {:else if destinationType === 'STATE'}
                <Field label="Province / État"
                  ><Input bind:value={destinationState} required placeholder="ON" /></Field
                >
                <Field label="Pays"
                  ><Input bind:value={destinationCountry} required placeholder="CA" /></Field
                >
              {:else if destinationType === 'COUNTRY'}
                <Field label="Pays"
                  ><Input bind:value={destinationCountry} required placeholder="CA" /></Field
                >
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
            <span
              class="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
              >Accessoriaux demandés</span
            >
            {#if accessorials.length === 0}
              <p class="text-xs text-ink-faint">Aucun accessorial configuré.</p>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                {#each accessorials as a (a.id)}
                  <button
                    type="button"
                    class={`rounded-inner border px-2 py-1 text-xs ${selectedAccessorials.includes(a.code) ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-ink-muted hover:text-ink'}`}
                    onclick={() => (selectedAccessorials = toggle(selectedAccessorials, a.code))}
                    >{a.code} – {a.name}</button
                  >
                {/each}
              </div>
            {/if}
          </div>
          <div>
            <span
              class="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
              >Transporteurs (vide = tous)</span
            >
            {#if carriers.length === 0}
              <p class="text-xs text-ink-faint">Aucun transporteur.</p>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                {#each carriers as c (c.id)}
                  <button
                    type="button"
                    class={`rounded-inner border px-2 py-1 text-xs ${selectedCarriers.includes(c.id) ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-ink-muted hover:text-ink'}`}
                    onclick={() => (selectedCarriers = toggle(selectedCarriers, c.id))}
                    >{c.name}</button
                  >
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
        {result.resolved.originKey} → {result.resolved.destinationKey} · {formatDate(
          result.referenceDate,
        )}
      </span>
    </div>

    {#if result.options.length === 0}
      <Card>
        <EmptyState message="Aucun tarif actif ne correspond à ce scénario." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>#</th><th>Tarif</th><th>Transporteur</th><th>Total</th><th>Spécificité</th><th
            >Alertes</th
          ><th></th>
        {/snippet}
        {#snippet body()}
          {#each result?.options ?? [] as opt, i (opt.rateId)}
            <tr
              class="cursor-pointer"
              onclick={() => (expanded = { ...expanded, [opt.rateId]: !expanded[opt.rateId] })}
            >
              <td class="font-mono text-ink-muted">{i + 1}</td>
              <td><span class="font-semibold text-ink">{opt.rateName}</span></td>
              <td>{opt.carrier?.name ?? '—'}</td>
              <td class="font-mono tabular-nums text-ink"
                >{formatMoney(opt.breakdown.total, opt.currency)}</td
              >
              <td class="font-mono text-xs text-ink-muted">{opt.laneSpecificity?.total ?? '—'}</td>
              <td>
                {#if opt.breakdown.missingAccessorials.length > 0}
                  <Badge tone="warn"
                    >Accessoriaux manquants ({opt.breakdown.missingAccessorials.length})</Badge
                  >
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
                    <div class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                      Pourquoi ce tarif ?
                    </div>

                    <table class="w-full text-sm">
                      <tbody>
                        {#each opt.breakdown.lines as line (line.label + line.type + (line.code ?? ''))}
                          <tr class="border-b border-edge/50">
                            <td class="py-1 text-ink">
                              {line.label}
                              {#if line.code}<span class="ml-1 font-mono text-xs text-ink-muted"
                                  >{line.code}</span
                                >{/if}
                            </td>
                            <td class="py-1 text-right font-mono tabular-nums text-ink"
                              >{formatMoney(line.amount, opt.currency)}</td
                            >
                          </tr>
                        {/each}
                        <tr>
                          <td class="py-1 font-semibold text-ink">Total</td>
                          <td class="py-1 text-right font-mono font-semibold tabular-nums text-ink"
                            >{formatMoney(opt.breakdown.total, opt.currency)}</td
                          >
                        </tr>
                      </tbody>
                    </table>

                    <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
                      <span
                        >Base&nbsp;<span class="font-mono text-ink"
                          >{formatMoney(opt.breakdown.base, opt.currency)}</span
                        ></span
                      >
                      <span
                        >Carburant&nbsp;<span class="font-mono text-ink"
                          >{formatMoney(opt.breakdown.fuelSurcharge, opt.currency)}</span
                        >
                        · {fuelLabel(opt.fuel)}</span
                      >
                      <span
                        >Accessoriaux&nbsp;<span class="font-mono text-ink"
                          >{formatMoney(opt.breakdown.accessorialsTotal, opt.currency)}</span
                        ></span
                      >
                      {#if opt.laneSpecificity}
                        <span
                          >Voie&nbsp;<span class="font-mono text-ink"
                            >{opt.laneSpecificity.originType} → {opt.laneSpecificity
                              .destinationType}</span
                          >
                          (spéc. {opt.laneSpecificity.total})</span
                        >
                      {:else}
                        <span>Voie&nbsp;<span class="text-ink">générique</span></span>
                      {/if}
                    </div>

                    {#if opt.breakdown.appliedBreak}
                      <div class="text-xs text-ink-muted">
                        Palier appliqué : jusqu'à <span class="font-mono text-ink"
                          >{opt.breakdown.appliedBreak.upToKg} kg</span
                        >
                        @
                        <span class="font-mono text-ink">{opt.breakdown.appliedBreak.amount}</span>
                        {#if opt.breakdown.appliedBreak.asIfApplied}
                          <Badge tone="neutral"
                            >règle « as-if » · poids fictif {opt.breakdown.appliedBreak
                              .asIfWeightKg} kg</Badge
                          >
                        {/if}
                      </div>
                    {/if}

                    {#if opt.breakdown.missingAccessorials.length > 0}
                      <div class="text-xs text-warn">
                        Accessoriaux demandés non tarifés : <span class="font-mono"
                          >{opt.breakdown.missingAccessorials.join(', ')}</span
                        >
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

<!-- ─── Section 3 — Hub tarification ─────────────────────────────────────────── -->
<div class="mt-8">
  <h2 class="mb-2 text-base font-semibold text-ink">Hub tarification</h2>
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each [{ href: '/rates', label: 'Tarifs', desc: 'Grilles tarifaires et paliers' }, { href: '/lanes', label: 'Voies (lanes)', desc: 'Corridors et préférences transporteurs' }, { href: '/accessorials', label: 'Accessoriaux', desc: 'Frais additionnels' }, { href: '/fuel-tables', label: 'Carburant', desc: 'Tables de surtaxe carburant' }] as link (link.href)}
      <a
        href={link.href}
        class="block rounded-card border border-edge p-4 transition-colors hover:border-accent hover:bg-surface-muted"
      >
        <div class="font-semibold text-ink">{link.label}</div>
        <div class="mt-0.5 text-xs text-ink-muted">{link.desc}</div>
      </a>
    {/each}
  </div>
</div>
