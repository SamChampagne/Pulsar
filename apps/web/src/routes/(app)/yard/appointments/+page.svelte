<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { YardDirection, YardSpotType, computeAppointmentTiming } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
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

  interface Appointment {
    id: string;
    appointmentNumber: string;
    status: string;
    direction: string;
    windowStart: string;
    windowEnd: string;
    reference: string | null;
    spot: { code: string; type: string } | null;
    carrier: { name: string } | null;
  }

  const DIRECTIONS = [YardDirection.INBOUND, YardDirection.OUTBOUND, YardDirection.OTHER];

  let appointments = $state<Appointment[]>([]);
  let locations = $state<LocationOption[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let spots = $state<SpotOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Create modal
  let createOpen = $state(false);
  let formLocationId = $state('');
  let formSpotId = $state('');
  let formCarrierId = $state('');
  let formDirection = $state<string>(YardDirection.INBOUND);
  let formWindowStart = $state('');
  let formWindowEnd = $state('');
  let formReference = $state('');
  let saving = $state(false);

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

  // Dock doors of the selected site.
  const siteDoors = $derived(
    spots.filter(
      (s) => s.locationId === formLocationId && s.isActive && s.type === YardSpotType.DOCK_DOOR,
    ),
  );

  function fmtDate(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  async function loadStatic() {
    const [locs, crs, spts] = await Promise.all([
      api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
      api<SpotOption[]>('/yard/spots'),
    ]);
    locations = locs.items;
    carriers = crs.items;
    spots = spts;
  }

  async function loadAppointments() {
    appointments = await api<Appointment[]>('/yard/appointments');
  }

  async function load() {
    loading = true;
    error = '';
    try {
      if (locations.length === 0) await loadStatic();
      await loadAppointments();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des rendez-vous';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openCreate() {
    formLocationId = locations.find((l) => l.type === 'WAREHOUSE')?.id ?? locations[0]?.id ?? '';
    formSpotId = '';
    formCarrierId = '';
    formDirection = YardDirection.INBOUND;
    formWindowStart = '';
    formWindowEnd = '';
    formReference = '';
    createOpen = true;
  }

  async function submitCreate() {
    if (!formLocationId) {
      toast.error('Sélectionnez un site');
      return;
    }
    if (!formWindowStart || !formWindowEnd) {
      toast.error('Fenêtre de début et de fin requises');
      return;
    }
    const start = new Date(formWindowStart);
    const end = new Date(formWindowEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error('Dates invalides');
      return;
    }
    if (end <= start) {
      toast.error('La fin doit être après le début');
      return;
    }
    saving = true;
    try {
      await api('/yard/appointments', {
        method: 'POST',
        body: {
          locationId: formLocationId,
          spotId: formSpotId || undefined,
          carrierId: formCarrierId || undefined,
          direction: formDirection,
          windowStart: start.toISOString(),
          windowEnd: end.toISOString(),
          reference: formReference.trim() || undefined,
        },
      });
      toast.success('Rendez-vous créé');
      createOpen = false;
      await loadAppointments();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      saving = false;
    }
  }

  async function action(a: Appointment, verb: string, label: string) {
    try {
      await api(`/yard/appointments/${a.id}/${verb}`, { method: 'POST' });
      toast.success(label);
      await loadAppointments();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'action");
    }
  }
</script>

<PageHeader title="Rendez-vous">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau rendez-vous</Button>
  {/snippet}
</PageHeader>

<div class="mb-4">
  <a href="/yard" class="text-sm text-accent hover:underline">← Yard</a>
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <Card padded={false}>
    {#if appointments.length === 0}
      <EmptyState message="Aucun rendez-vous." />
    {:else}
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-left text-xs text-ink-faint">
            <th class="px-4 py-2.5 font-medium">Rendez-vous</th>
            <th class="px-4 py-2.5 font-medium">Statut</th>
            <th class="px-4 py-2.5 font-medium">Direction</th>
            <th class="px-4 py-2.5 font-medium">Fenêtre</th>
            <th class="px-4 py-2.5 font-medium">Porte</th>
            <th class="px-4 py-2.5 font-medium">Transporteur</th>
            <th class="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-edge">
          {#each appointments as a (a.id)}
            {@const timing = computeAppointmentTiming({
              windowStart: a.windowStart,
              windowEnd: a.windowEnd,
              status: a.status,
            })}
            <tr class="hover:bg-surface-muted">
              <td class="px-4 py-2.5 font-medium text-ink">
                {a.appointmentNumber}
                {#if a.reference}<span class="block text-xs text-ink-faint">{a.reference}</span
                  >{/if}
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-2">
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  {#if timing.status === 'LATE'}
                    <Badge tone="danger">En retard +{timing.minutesLate}m</Badge>
                  {:else if timing.status === 'DUE'}
                    <Badge tone="warn">Fenêtre</Badge>
                  {/if}
                </div>
              </td>
              <td class="px-4 py-2.5 text-ink-muted">{a.direction}</td>
              <td class="px-4 py-2.5 text-ink-muted"
                >{fmtDate(a.windowStart)} → {fmtDate(a.windowEnd)}</td
              >
              <td class="px-4 py-2.5 text-ink-muted">{a.spot?.code ?? '—'}</td>
              <td class="px-4 py-2.5 text-ink-muted">{a.carrier?.name ?? '—'}</td>
              <td class="px-4 py-2.5 text-right">
                <div class="flex justify-end gap-2">
                  {#if a.status === 'SCHEDULED'}
                    <Button
                      variant="secondary"
                      onclick={() => action(a, 'arrive', 'Arrivée enregistrée')}>Arrivée</Button
                    >
                    <Button
                      variant="ghost"
                      onclick={() => action(a, 'cancel', 'Rendez-vous annulé')}>Annuler</Button
                    >
                    <Button
                      variant="ghost"
                      onclick={() => action(a, 'no-show', 'No-show enregistré')}>No-show</Button
                    >
                  {:else if a.status === 'ARRIVED'}
                    <Button
                      variant="secondary"
                      onclick={() => action(a, 'complete', 'Rendez-vous complété')}
                      >Compléter</Button
                    >
                    <Button
                      variant="ghost"
                      onclick={() => action(a, 'cancel', 'Rendez-vous annulé')}>Annuler</Button
                    >
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Card>
{/if}

<Modal bind:open={createOpen} title="Nouveau rendez-vous">
  <div class="space-y-3">
    <Field label="Site">
      <Select bind:value={formLocationId}>
        <option value="">— Sélectionner —</option>
        {#each locations as l (l.id)}
          <option value={l.id}>{l.code} — {l.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Porte (optionnel)">
      <Select bind:value={formSpotId}>
        <option value="">— Aucune —</option>
        {#each siteDoors as s (s.id)}
          <option value={s.id}>{s.code}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Transporteur (optionnel)">
      <Select bind:value={formCarrierId}>
        <option value="">— Aucun —</option>
        {#each carriers as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Direction">
      <Select bind:value={formDirection}>
        {#each DIRECTIONS as d (d)}<option value={d}>{d}</option>{/each}
      </Select>
    </Field>
    <Field label="Début de fenêtre">
      <Input type="datetime-local" bind:value={formWindowStart} />
    </Field>
    <Field label="Fin de fenêtre">
      <Input type="datetime-local" bind:value={formWindowEnd} />
    </Field>
    <Field label="Référence">
      <Input bind:value={formReference} placeholder="PO / référence" />
    </Field>
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        createOpen = false;
      }}>Annuler</Button
    >
    <Button loading={saving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>
