<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { YardDirection } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    PageHeader,
    Select,
    Skeleton,
    ViewToggle,
    type ViewId,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
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

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
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
  let spots = $state<SpotOption[]>([]);
  let appointments = $state<AppointmentOption[]>([]);
  let visits = $state<Visit[]>([]);
  let loading = $state(true);
  let error = $state('');
  let visitView = $state<ViewId>('table');

  const VISIT_KANBAN_COLS: { status: string; label: string }[] = [
    { status: 'CHECKED_IN', label: 'En cours' },
    { status: 'ASSIGNED', label: 'Assigné' },
    { status: 'DEPARTED', label: 'Parti' },
    { status: 'CANCELLED', label: 'Annulé' },
  ];

  // Check-in form
  let formLocationId = $state('');
  // Remorque : `formTrailerPick` holds either a fleet trailer id (catalog pick) or a
  // raw plate/reference (free text, "chauffeur externe"); `formTrailerIsFreeText`
  // disambiguates which one it is at submit time (rule: id when picked, text when free).
  let formTrailerPick = $state('');
  let formTrailerIsFreeText = $state(false);
  let formCarrierId = $state('');
  // Chauffeur : the API only ever stores free text (`driverName` — no driver FK on a
  // visit). A catalog pick still resolves to the driver's display name below, so
  // `formDriverName` remains the single value sent to the API either way.
  let formDriverPick = $state('');
  let formDriverIsFreeText = $state(false);
  let formDriverName = $state('');
  let formDirection = $state<string>(YardDirection.INBOUND);
  let formSpotId = $state('');
  let formAppointmentId = $state('');
  let saving = $state(false);
  let visitFieldDefs = $state<CustomFieldDef[]>([]);
  let customData = $state<Record<string, unknown>>({});
  let spotWarnings = $state<string[]>([]);

  $effect(() => {
    const id = formDriverPick;
    const isFree = formDriverIsFreeText;
    if (!id) {
      formDriverName = '';
      return;
    }
    if (isFree) {
      formDriverName = id;
      return;
    }
    let cancelled = false;
    api<{ firstName: string; lastName: string }>(
      `/yard/data/drivers/${encodeURIComponent(id)}`,
    )
      .then((d) => {
        if (!cancelled) formDriverName = [d.firstName, d.lastName].filter(Boolean).join(' ');
      })
      .catch(() => {
        if (!cancelled) formDriverName = '';
      });
    return () => {
      cancelled = true;
    };
  });

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

  function visitStatusLabel(status: string): string {
    switch (status) {
      case 'ASSIGNED':
        return 'Assigné';
      case 'CHECKED_IN':
        return 'En cours';
      case 'DEPARTED':
        return 'Parti';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return status;
    }
  }

  function trailerLabel(v: Visit): string {
    if (v.trailer)
      return v.trailer.plate
        ? `${v.trailer.unitNumber} (${v.trailer.plate})`
        : v.trailer.unitNumber;
    return v.trailerRef ?? '—';
  }

  // Free spots of the selected site (no occupying visit known here — show active ones).
  const siteSpots = $derived(spots.filter((s) => s.locationId === formLocationId && s.isActive));

  const siteAppointments = $derived(
    appointments.filter(
      (a) =>
        a.status === 'SCHEDULED' &&
        (a.locationId === formLocationId || a.location?.id === formLocationId),
    ),
  );

  const selectedAppointment = $derived(siteAppointments.find((a) => a.id === formAppointmentId));
  $effect(() => {
    if (selectedAppointment) formDirection = selectedAppointment.direction;
    else if (formAppointmentId) formAppointmentId = '';
  });

  // Active visits only.
  const activeVisits = $derived(
    visits.filter((v) => v.status === 'CHECKED_IN' || v.status === 'ASSIGNED'),
  );

  async function loadStatic() {
    const [locs, spts, appts, defs] = await Promise.all([
      api<Paginated<LocationOption>>('/locations', {
        query: { type: 'WAREHOUSE', pageSize: 100 },
      }),
      api<SpotOption[]>('/yard/spots'),
      api<AppointmentOption[]>('/yard/appointments', { query: { status: 'SCHEDULED' } }),
      api<CustomFieldDef[]>('/yard/custom-fields', { query: { entityType: 'YARD_VISIT' } }).catch(
        () => [] as CustomFieldDef[],
      ),
    ]);
    locations = locs.items;
    spots = spts;
    appointments = appts;
    visitFieldDefs = defs;
    if (!formLocationId) formLocationId = locations[0]?.id ?? '';
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
    if (!formTrailerPick) {
      toast.error('Une remorque (flotte) ou une référence est requise');
      return;
    }
    saving = true;
    spotWarnings = [];
    try {
      const body: Record<string, unknown> = {
        locationId: formLocationId,
        trailerId: formTrailerIsFreeText ? undefined : formTrailerPick,
        trailerRef: formTrailerIsFreeText ? formTrailerPick.trim() : undefined,
        carrierId: formCarrierId || undefined,
        driverName: formDriverName.trim() || undefined,
        direction: formDirection,
        spotId: formSpotId || undefined,
        appointmentId: formAppointmentId || undefined,
        customData: Object.keys(customData).length > 0 ? customData : undefined,
      };
      const result = await api<{ spotWarnings?: string[] }>('/yard/visits', {
        method: 'POST',
        body,
      });
      if (result?.spotWarnings && result.spotWarnings.length > 0) {
        spotWarnings = result.spotWarnings;
      }
      toast.success('Check-in effectué');
      formTrailerPick = '';
      formTrailerIsFreeText = false;
      formCarrierId = '';
      formDriverPick = '';
      formDriverIsFreeText = false;
      formDriverName = '';
      formSpotId = '';
      formAppointmentId = '';
      customData = {};
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
    return Number.isNaN(d.getTime()) ? '—' : formatDateTime(value);
  }
</script>

<PageHeader title="Entrées et sorties" />

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
          <EntityPicker
            endpoint="/locations"
            label="Site"
            filters={{ type: 'WAREHOUSE' }}
            labelKey="name"
            detailKey="code"
            bind:value={formLocationId}
          />
        </Field>
        <Field label="Remorque (flotte ou référence)">
          <EntityPicker
            endpoint="/yard/data/trailers"
            label="Remorque (flotte ou référence)"
            labelKey="unitNumber"
            detailKey="plate"
            allowFreeText
            bind:value={
              () => formTrailerPick,
              (v) => {
                formTrailerPick = v;
                formTrailerIsFreeText = false;
              }
            }
            onfreetext={() => {
              formTrailerIsFreeText = true;
            }}
          />
        </Field>
        <Field label="Transporteur">
          <EntityPicker
            endpoint="/yard/data/carriers"
            label="Transporteur"
            labelKey="name"
            detailKey="code"
            bind:value={formCarrierId}
          />
        </Field>
        <Field label="Chauffeur">
          <EntityPicker
            endpoint="/yard/data/drivers"
            label="Chauffeur"
            labelKey="lastName"
            detailKey="firstName"
            allowFreeText
            bind:value={
              () => formDriverPick,
              (v) => {
                formDriverPick = v;
                formDriverIsFreeText = false;
              }
            }
            onfreetext={() => {
              formDriverIsFreeText = true;
            }}
          />
        </Field>
        <Field label="Direction">
          <Select bind:value={formDirection} disabled={!!selectedAppointment}>
            {#each DIRECTIONS as d (d)}<option value={d}>{d}</option>{/each}
          </Select>
        </Field>
        {#if selectedAppointment}<p class="mt-1 text-xs text-ink-muted">
            Sens repris du rendez-vous lié.
          </p>{/if}
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
        {#if visitFieldDefs.length > 0}
          <CustomFieldInputs definitions={visitFieldDefs} bind:data={customData} />
        {/if}
        {#if spotWarnings.length > 0}
          <div class="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            {#each spotWarnings as w (w)}
              <p>{w}</p>
            {/each}
          </div>
        {/if}
        <div>
          <Button loading={saving} onclick={submitCheckIn}>Check-in</Button>
        </div>
      </div>
    </Card>

    <!-- Visits -->
    <Card padded={false}>
      <div class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 class="font-semibold text-ink">Visites</h2>
        <ViewToggle bind:view={visitView} views={['table', 'cards', 'kanban']} />
      </div>
      {#if visitView === 'table'}
        {#if visits.length === 0}
          <EmptyState message="Aucune visite." />
        {:else}
          <div class="divide-y divide-edge">
            {#each visits as v (v.id)}
              <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Badge tone={statusTone(v.status)}>{visitStatusLabel(v.status)}</Badge>
                <div class="min-w-0">
                  <div class="font-medium text-ink">{v.visitNumber}</div>
                  <div class="text-ink-muted">
                    {trailerLabel(v)}{v.spot ? ` · ${v.spot.code}` : ''}
                  </div>
                </div>
                {#if v.status === 'CHECKED_IN' || v.status === 'ASSIGNED'}
                  <span class="ml-auto">
                    <Button variant="ghost" onclick={() => checkOut(v)}>Check-out</Button>
                  </span>
                {:else}
                  <span class="ml-auto text-xs text-ink-faint">{fmtDate(v.checkInAt)}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {:else if visitView === 'cards'}
        {#if visits.length === 0}
          <EmptyState message="Aucune visite." />
        {:else}
          <div class="grid gap-3 p-3 sm:grid-cols-2">
            {#each visits as v (v.id)}
              <Card>
                <div class="flex items-start justify-between gap-2">
                  <span class="font-semibold text-ink">{v.visitNumber}</span>
                  <Badge tone={statusTone(v.status)}>{visitStatusLabel(v.status)}</Badge>
                </div>
                <p class="mt-1 text-sm text-ink-muted">
                  {trailerLabel(v)}{v.spot ? ` · ${v.spot.code}` : ''}
                </p>
                <p class="mt-0.5 text-xs text-ink-faint">{v.direction} · {fmtDate(v.checkInAt)}</p>
                {#if v.status === 'CHECKED_IN' || v.status === 'ASSIGNED'}
                  <div class="mt-2">
                    <Button variant="ghost" onclick={() => checkOut(v)}>Check-out</Button>
                  </div>
                {/if}
              </Card>
            {/each}
          </div>
        {/if}
      {:else if visitView === 'kanban'}
        <div class="flex gap-3 overflow-x-auto p-3 pb-4">
          {#each VISIT_KANBAN_COLS as col (col.status)}
            {@const items = visits.filter((v) => v.status === col.status)}
            <div
              class="flex w-56 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
            >
              <div class="flex items-center justify-between px-3 py-2">
                <Badge tone={statusTone(col.status)}>{col.label}</Badge>
                <span class="font-mono text-xs text-ink-muted">{items.length}</span>
              </div>
              <div class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {#if items.length === 0}
                  <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
                {:else}
                  {#each items as v (v.id)}
                    <div class="rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm">
                      <div class="font-semibold text-sm text-ink">{v.visitNumber}</div>
                      <div class="mt-0.5 truncate text-xs text-ink-muted">
                        {trailerLabel(v)}{v.spot ? ` · ${v.spot.code}` : ''}
                      </div>
                      <div class="mt-0.5 text-[11px] text-ink-faint">{v.direction}</div>
                      {#if v.status === 'CHECKED_IN' || v.status === 'ASSIGNED'}
                        <button
                          class="mt-1.5 rounded-md border border-edge px-2 py-0.5 text-[11px] font-semibold text-ink-muted hover:bg-surface-muted"
                          onclick={() => checkOut(v)}>Check-out</button
                        >
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{/if}
