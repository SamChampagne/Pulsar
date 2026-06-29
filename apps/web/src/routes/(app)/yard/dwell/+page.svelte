<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { computeDwell } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Select,
    Skeleton,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';

  // Detention threshold (minutes): a visit dwelling longer than this is flagged.
  const DWELL_WARN_MIN = 120;

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  interface Visit {
    id: string;
    visitNumber: string;
    status: string;
    direction: string;
    checkInAt: string | null;
    checkOutAt: string | null;
    trailerRef: string | null;
    driverName: string | null;
    locationId: string;
    spotId: string | null;
    trailer: { unitNumber: string; plate: string | null } | null;
    carrier: { name: string } | null;
    spot: { code: string; type: string } | null;
    appointment: { appointmentNumber: string } | null;
  }

  interface RankedVisit extends Visit {
    dwellMinutes: number;
    detentionMinutes: number;
    longDwell: boolean;
  }

  let locations = $state<LocationOption[]>([]);
  let locationId = $state('');
  let visits = $state<Visit[]>([]);
  let loading = $state(true);
  let error = $state('');
  // Single read-time clock so every row computes against the same "now".
  let now = $state(new Date());

  function statusLabel(status: string): string {
    switch (status) {
      case 'CHECKED_IN':
        return 'En cour';
      case 'ASSIGNED':
        return 'À quai';
      default:
        return status;
    }
  }

  function fmtDate(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-CA');
  }

  function fmtDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h <= 0) return `${m} min`;
    return `${h} h ${String(m).padStart(2, '0')}`;
  }

  async function loadLocations() {
    const res = await api<Paginated<LocationOption>>('/transportation/locations', {
      query: { pageSize: 100 },
    });
    locations = res.items;
    if (!locationId) {
      const dc = locations.find((l) => l.type === 'WAREHOUSE') ?? locations[0];
      locationId = dc?.id ?? '';
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      if (locations.length === 0) await loadLocations();
      // Active visits only: CHECKED_IN (in yard) + ASSIGNED (at a dock).
      const [checkedIn, assigned] = await Promise.all([
        api<Visit[]>('/yard/visits', {
          query: { status: 'CHECKED_IN', ...(locationId ? { locationId } : {}) },
        }),
        api<Visit[]>('/yard/visits', {
          query: { status: 'ASSIGNED', ...(locationId ? { locationId } : {}) },
        }),
      ]);
      visits = [...checkedIn, ...assigned];
      now = new Date();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du bureau de séjour';
    } finally {
      loading = false;
    }
  }

  let lastLocationId = '';
  $effect(() => {
    if (locationId !== lastLocationId) {
      lastLocationId = locationId;
      void load();
    }
  });

  let didInit = false;
  $effect(() => {
    if (!didInit) {
      didInit = true;
      void load();
    }
  });

  // Rank by dwell time = now − checkInAt (computed client-side via computeDwell).
  const ranked = $derived.by<RankedVisit[]>(() =>
    visits
      .filter((v) => v.checkInAt)
      .map((v) => {
        const d = computeDwell(
          { checkInAt: v.checkInAt as string, freeMinutes: DWELL_WARN_MIN },
          now,
        );
        return {
          ...v,
          dwellMinutes: d.minutes,
          detentionMinutes: d.detentionMinutes,
          longDwell: d.minutes > DWELL_WARN_MIN,
        };
      })
      .sort((a, b) => b.dwellMinutes - a.dwellMinutes),
  );

  const kpiActive = $derived(ranked.length);
  const kpiLong = $derived(ranked.filter((v) => v.longDwell).length);
  const kpiAvg = $derived(
    ranked.length === 0
      ? 0
      : Math.round(ranked.reduce((sum, v) => sum + v.dwellMinutes, 0) / ranked.length),
  );

  function dwellTone(v: RankedVisit): Tone {
    return v.longDwell ? 'danger' : 'ok';
  }
</script>

<PageHeader
  title="Séjour / Détention"
  eyebrow="Cour"
  subtitle={`Visites actives classées par durée de séjour. Seuil de détention : ${DWELL_WARN_MIN} min.`}
  count={ranked.length}
>
  {#snippet actions()}
    <Button href="/yard/gate">Guérite</Button>
  {/snippet}
</PageHeader>

<div class="mb-4">
  <a href="/yard" class="text-sm text-accent hover:underline">← Plan de cour</a>
</div>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <div class="max-w-xs flex-1">
    <Select bind:value={locationId}>
      <option value="">— Tous les sites —</option>
      {#each locations as l (l.id)}
        <option value={l.id}>{l.code} — {l.name}</option>
      {/each}
    </Select>
  </div>
</div>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-3">
    {#each Array(3) as _, i (i)}<Skeleton />{/each}
  </div>
{:else}
  <div class="mb-5 grid gap-3 sm:grid-cols-3">
    <Card>
      <div class="text-xs font-medium text-ink-muted">Visites actives</div>
      <div class="mt-1 text-3xl font-bold text-ink">{kpiActive}</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-danger">Séjour prolongé (&gt; {DWELL_WARN_MIN} min)</div>
      <div class={`mt-1 text-3xl font-bold ${kpiLong > 0 ? 'text-danger' : 'text-ink'}`}>
        {kpiLong}
      </div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-ink-muted">Séjour moyen</div>
      <div class="mt-1 text-3xl font-bold text-ink">{fmtDuration(kpiAvg)}</div>
    </Card>
  </div>

  {#if ranked.length === 0}
    <Card>
      <EmptyState
        title="Aucune visite active"
        message="Enregistrez l'arrivée d'un camion à la guérite pour suivre son temps de séjour."
      >
        {#snippet children()}
          <Button href="/yard/gate">Enregistrer une arrivée</Button>
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <Card padded={false}>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-left text-xs text-ink-faint">
            <th class="px-4 py-2.5 font-medium">Visite</th>
            <th class="px-4 py-2.5 font-medium">Remorque / Transporteur</th>
            <th class="px-4 py-2.5 font-medium">Emplacement</th>
            <th class="px-4 py-2.5 font-medium">Arrivée</th>
            <th class="px-4 py-2.5 font-medium">Séjour</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-edge">
          {#each ranked as v (v.id)}
            <tr class={`hover:bg-surface-muted ${v.longDwell ? 'bg-danger-soft' : ''}`}>
              <td class="px-4 py-2.5 font-medium text-ink">
                {v.visitNumber}
                <span class="ml-1 text-xs text-ink-faint">{statusLabel(v.status)}</span>
                {#if v.appointment}
                  <span class="block text-xs text-ink-faint">{v.appointment.appointmentNumber}</span>
                {/if}
              </td>
              <td class="px-4 py-2.5 text-ink-muted">
                {v.trailer?.unitNumber ?? v.trailerRef ?? '—'}
                {#if v.carrier}
                  <span class="block text-xs text-ink-faint">{v.carrier.name}</span>
                {/if}
              </td>
              <td class="px-4 py-2.5 text-ink-muted">{v.spot?.code ?? 'Sans porte'}</td>
              <td class="px-4 py-2.5 text-ink-muted">{fmtDate(v.checkInAt)}</td>
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-2">
                  <Badge tone={dwellTone(v)}>{fmtDuration(v.dwellMinutes)}</Badge>
                  {#if v.longDwell}
                    <Badge tone="danger">Détention +{fmtDuration(v.detentionMinutes)}</Badge>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </Card>
  {/if}
{/if}
