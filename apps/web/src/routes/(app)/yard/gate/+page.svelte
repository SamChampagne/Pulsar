<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { YardDirection } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  interface TrailerOption {
    id: string;
    unitNumber: string;
    plate: string | null;
    carrierId: string | null;
  }

  interface CarrierOption {
    id: string;
    name: string;
  }

  interface SpotOption {
    id: string;
    code: string;
    type: string;
    locationId: string;
    isActive: boolean;
  }

  interface AppointmentOption {
    id: string;
    appointmentNumber: string;
    status: string;
    direction: string;
    windowStart: string;
    locationId?: string;
    location?: { id: string } | null;
  }

  interface Visit {
    id: string;
    visitNumber: string;
    status: string;
    direction: string;
    trailerRef: string | null;
    trailer: { unitNumber: string; plate: string | null } | null;
    carrier: { name: string } | null;
    spot: { code: string; type: string } | null;
    checkInAt: string;
    locationId: string;
  }

  const DIRECTIONS = [YardDirection.INBOUND, YardDirection.OUTBOUND, YardDirection.OTHER];

  let locations = $state<LocationOption[]>([]);
  let trailers = $state<TrailerOption[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let spots = $state<SpotOption[]>([]);
  let appointments = $state<AppointmentOption[]>([]);
  let visits = $state<Visit[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Check-in form
  let formLocationId = $state('');
  let formTrailerId = $state('');
  let formTrailerRef = $state('');
  let formCarrierId = $state('');
  let formDriverName = $state('');
  let formDirection = $state<string>(YardDirection.INBOUND);
  let formSpotId = $state('');
  let formAppointmentId = $state('');
  let saving = $state(false);

  function statusTone(status: string): Tone {
    switch (status) {
      case 'ASSIGNED':
        return 'info';
      case 'CHECKED_IN':
        return 'warn';
      case 'DEPARTED':
        return 'neutral';
      case 'CANCELLED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function trailerLabel(v: Visit): string {
    if (v.trailer) return v.trailer.plate ? `${v.trailer.unitNumber} (${v.trailer.plate})` : v.trailer.unitNumber;
    return v.trailerRef ?? '—';
  }

  // Free spots of the selected site (no occupying visit known here — show active ones).
  const siteSpots = $derived(
    spots.filter((s) => s.locationId === formLocationId && s.isActive),
  );

  const siteAppointments = $derived(
    appointments.filter(
      (a) =>
        a.status === 'SCHEDULED' &&
        (a.locationId === formLocationId || a.location?.id === formLocationId),
    ),
  );

  // Active visits only.
  const activeVisits = $derived(
    visits.filter((v) => v.status === 'CHECKED_IN' || v.status === 'ASSIGNED'),
  );

  async function loadStatic() {
    const [locs, trls, crs, spts, appts] = await Promise.all([
      api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      api<Paginated<TrailerOption>>('/transportation/trailers', { query: { pageSize: 100 } }),
      api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
      api<SpotOption[]>('/yard/spots'),
      api<AppointmentOption[]>('/yard/appointments', { query: { status: 'SCHEDULED' } }),
    ]);
    locations = locs.items;
    trailers = trls.items;
    carriers = crs.items;
    spots = spts;
    appointments = appts;
    if (!formLocationId) {
      const dc = locations.find((l) => l.type === 'WAREHOUSE') ?? locations[0];
      formLocationId = dc?.id ?? '';
    }
  }

  async function loadVisits() {
    visits = await api<Visit[]>('/yard/visits');
  }

  async function load() {
    loading = true;
    error = '';
    try {
      if (locations.length === 0) await loadStatic();
      await loadVisits();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la guérite';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  async function submitCheckIn() {
    if (!formLocationId) {
      toast.error('Sélectionnez un site');
      return;
    }
    if (!formTrailerId && !formTrailerRef.trim()) {
      toast.error('Une remorque (flotte) ou une référence est requise');
      return;
    }
    saving = true;
    try {
      const body = {
        locationId: formLocationId,
        trailerId: formTrailerId || undefined,
        trailerRef: formTrailerId ? undefined : formTrailerRef.trim() || undefined,
        carrierId: formCarrierId || undefined,
        driverName: formDriverName.trim() || undefined,
        direction: formDirection,
        spotId: formSpotId || undefined,
        appointmentId: formAppointmentId || undefined,
      };
      await api('/yard/visits', { method: 'POST', body });
      toast.success('Check-in effectué');
      formTrailerId = '';
      formTrailerRef = '';
      formCarrierId = '';
      formDriverName = '';
      formSpotId = '';
      formAppointmentId = '';
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du check-in');
    } finally {
      saving = false;
    }
  }

  async function checkOut(v: Visit) {
    try {
      await api(`/yard/visits/${v.id}/check-out`, { method: 'POST' });
      toast.success('Check-out effectué');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du check-out');
    }
  }

  function fmtDate(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
</script>

<PageHeader title="Gate" />

<div class="mb-4">
  <a href="/yard" class="text-sm text-accent hover:underline">← Yard</a>
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(3) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    <!-- Check-in form -->
    <Card>
      <h2 class="mb-3 font-semibold text-ink">Check-in</h2>
      <div class="space-y-3">
        <Field label="Site">
          <Select bind:value={formLocationId}>
            <option value="">— Sélectionner —</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.code} — {l.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Remorque (flotte)">
          <Select bind:value={formTrailerId}>
            <option value="">— Aucune (référence libre) —</option>
            {#each trailers as t (t.id)}
              <option value={t.id}>{t.unitNumber}{t.plate ? ` (${t.plate})` : ''}</option>
            {/each}
          </Select>
        </Field>
        {#if !formTrailerId}
          <Field label="Référence remorque">
            <Input bind:value={formTrailerRef} placeholder="ABC123" />
          </Field>
        {/if}
        <Field label="Transporteur">
          <Select bind:value={formCarrierId}>
            <option value="">— Aucun —</option>
            {#each carriers as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Chauffeur">
          <Input bind:value={formDriverName} placeholder="Nom du chauffeur" />
        </Field>
        <Field label="Direction">
          <Select bind:value={formDirection}>
            {#each DIRECTIONS as d (d)}<option value={d}>{d}</option>{/each}
          </Select>
        </Field>
        <Field label="Spot (optionnel)">
          <Select bind:value={formSpotId}>
            <option value="">— Aucun (placer plus tard) —</option>
            {#each siteSpots as s (s.id)}
              <option value={s.id}>{s.code} ({s.type})</option>
            {/each}
          </Select>
        </Field>
        <Field label="Rendez-vous (optionnel)">
          <Select bind:value={formAppointmentId}>
            <option value="">— Aucun —</option>
            {#each siteAppointments as a (a.id)}
              <option value={a.id}>{a.appointmentNumber} — {fmtDate(a.windowStart)}</option>
            {/each}
          </Select>
        </Field>
        <div>
          <Button loading={saving} onclick={submitCheckIn}>Check-in</Button>
        </div>
      </div>
    </Card>

    <!-- Active visits -->
    <Card padded={false}>
      <div class="border-b border-edge px-4 py-3">
        <h2 class="font-semibold text-ink">Visites actives</h2>
      </div>
      {#if activeVisits.length === 0}
        <EmptyState message="Aucune visite active." />
      {:else}
        <div class="divide-y divide-edge">
          {#each activeVisits as v (v.id)}
            <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone={statusTone(v.status)}>{v.status}</Badge>
              <div class="min-w-0">
                <div class="font-medium text-ink">{v.visitNumber}</div>
                <div class="text-ink-muted">{trailerLabel(v)}{v.spot ? ` · ${v.spot.code}` : ''}</div>
              </div>
              <span class="ml-auto">
                <Button variant="ghost" onclick={() => checkOut(v)}>Check-out</Button>
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{/if}
