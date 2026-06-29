<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { computeAppointmentTiming } from '@pulsar/shared';
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

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  interface Appointment {
    id: string;
    appointmentNumber: string;
    status: string;
    direction: string;
    windowStart: string;
    windowEnd: string;
    reference: string | null;
    spot: { id: string; code: string; type: string } | null;
    carrier: { id: string; name: string } | null;
    location: { id: string; code: string; name: string } | null;
  }

  // Dock door (spot) lane = a row in the agenda; appointments without a spot
  // fall into an "unassigned" lane so they're never hidden.
  interface Lane {
    key: string;
    code: string;
    items: Appointment[];
  }

  let locations = $state<LocationOption[]>([]);
  let locationId = $state('');
  let appointments = $state<Appointment[]>([]);
  let loading = $state(true);
  let error = $state('');

  function statusTone(status: string): Tone {
    switch (status) {
      case 'SCHEDULED':
        return 'info';
      case 'ARRIVED':
        return 'warn';
      case 'COMPLETED':
        return 'ok';
      case 'CANCELLED':
        return 'neutral';
      case 'NO_SHOW':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'SCHEDULED':
        return 'Planifié';
      case 'ARRIVED':
        return 'Arrivé';
      case 'COMPLETED':
        return 'Complété';
      case 'CANCELLED':
        return 'Annulé';
      case 'NO_SHOW':
        return 'No-show';
      default:
        return status;
    }
  }

  function fmtTime(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-CA');
  }

  function isToday(value: string): boolean {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
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
      appointments = await api<Appointment[]>('/yard/appointments', {
        query: locationId ? { locationId } : {},
      });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du planificateur';
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

  // KPIs over the loaded appointments (today only for the headline counter).
  const todayItems = $derived(appointments.filter((a) => isToday(a.windowStart)));
  const kpiToday = $derived(todayItems.length);
  const kpiScheduled = $derived(appointments.filter((a) => a.status === 'SCHEDULED').length);
  const kpiArrived = $derived(appointments.filter((a) => a.status === 'ARRIVED').length);
  const kpiCompleted = $derived(appointments.filter((a) => a.status === 'COMPLETED').length);
  const kpiNoShow = $derived(appointments.filter((a) => a.status === 'NO_SHOW').length);

  // Lanes by dock door, each ordered by scheduled time. Appointments with no
  // spot land in a synthetic "sans porte" lane at the end.
  const lanes = $derived.by<Lane[]>(() => {
    const map = new Map<string, Lane>();
    const sorted = [...appointments].sort(
      (a, b) => new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime(),
    );
    for (const a of sorted) {
      const key = a.spot?.id ?? '__none__';
      const code = a.spot?.code ?? 'Sans porte';
      let lane = map.get(key);
      if (!lane) {
        lane = { key, code, items: [] };
        map.set(key, lane);
      }
      lane.items.push(a);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === '__none__') return 1;
      if (b.key === '__none__') return -1;
      return a.code.localeCompare(b.code);
    });
  });
</script>

<PageHeader
  title="Planificateur de quais"
  eyebrow="Cour"
  subtitle="Agenda du jour des rendez-vous, par porte de quai et heure planifiée."
  count={appointments.length}
>
  {#snippet actions()}
    <Button href="/yard/appointments">Rendez-vous</Button>
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
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each Array(5) as _, i (i)}<Skeleton />{/each}
  </div>
{:else}
  <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <Card>
      <div class="text-xs font-medium text-ink-muted">Rendez-vous aujourd'hui</div>
      <div class="mt-1 text-3xl font-bold text-ink">{kpiToday}</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-ink-muted">Planifiés</div>
      <div class="mt-1 text-3xl font-bold text-ink">{kpiScheduled}</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-ink-muted">Arrivés</div>
      <div class="mt-1 text-3xl font-bold text-ink">{kpiArrived}</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-ink-muted">Complétés</div>
      <div class="mt-1 text-3xl font-bold text-ink">{kpiCompleted}</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-danger">No-show</div>
      <div class={`mt-1 text-3xl font-bold ${kpiNoShow > 0 ? 'text-danger' : 'text-ink'}`}>
        {kpiNoShow}
      </div>
    </Card>
  </div>

  {#if appointments.length === 0}
    <Card>
      <EmptyState
        title="Aucun rendez-vous"
        message="Planifiez un rendez-vous pour le voir apparaître dans l'agenda des quais."
      >
        {#snippet children()}
          <Button href="/yard/appointments">Créer un rendez-vous</Button>
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <div class="space-y-3">
      {#each lanes as lane (lane.key)}
        <Card padded={false}>
          <div
            class="flex items-center justify-between border-b border-edge-soft px-4 py-2.5"
          >
            <div class="flex items-center gap-2">
              <span class="font-semibold text-ink">
                {lane.key === '__none__' ? 'Sans porte assignée' : `Porte ${lane.code}`}
              </span>
              <span class="font-mono text-xs text-ink-muted">{lane.items.length}</span>
            </div>
          </div>
          <div class="flex gap-2 overflow-x-auto p-3">
            {#each lane.items as a (a.id)}
              {@const timing = computeAppointmentTiming({
                windowStart: a.windowStart,
                windowEnd: a.windowEnd,
                status: a.status,
              })}
              <div
                class="w-52 shrink-0 rounded-inner border border-edge-soft bg-surface-muted p-3"
                title={`${fmtDate(a.windowStart)} → ${fmtDate(a.windowEnd)}`}
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="font-mono text-sm font-semibold text-ink">
                    {fmtTime(a.windowStart)}
                  </span>
                  <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
                </div>
                <div class="mt-1 text-xs text-ink-muted">
                  {a.appointmentNumber} · {a.direction}
                </div>
                {#if a.carrier}
                  <div class="mt-0.5 truncate text-xs text-ink-faint">{a.carrier.name}</div>
                {/if}
                {#if a.reference}
                  <div class="mt-0.5 truncate text-xs text-ink-faint">Réf : {a.reference}</div>
                {/if}
                {#if timing.status === 'LATE'}
                  <div class="mt-1.5">
                    <Badge tone="danger">En retard +{timing.minutesLate}m</Badge>
                  </div>
                {:else if timing.status === 'DUE'}
                  <div class="mt-1.5"><Badge tone="warn">Fenêtre</Badge></div>
                {/if}
              </div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>
  {/if}
{/if}
