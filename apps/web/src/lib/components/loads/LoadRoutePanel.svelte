<script lang="ts">
  import { Badge, Button, Card, Field, toneFor, labelFor } from '$lib/components/ui';
  import LoadMap from '$lib/components/LoadMap.svelte';
  import DeliveryPlanSummary from './DeliveryPlanSummary.svelte';
  import FuelOperationsPanel from './FuelOperationsPanel.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import { userTimeZone } from '$lib/stores/time-zone.svelte';
  import { auth } from '$lib/stores/auth';
  import {
    PERMISSIONS,
    type DeliveryPlan,
    type DeliveryPlanOptions,
    type DeliveryStopInput,
    type DeliveryFuelSourceInput,
  } from '@pulsar/shared';
  import type { RouteDetail, LoadDetail } from './types';
  interface Props {
    loadId: string;
    detail: LoadDetail;
    route: RouteDetail | null;
    editable: boolean;
    executing: boolean;
    onReload: () => Promise<void>;
  }
  const { loadId, detail, route, editable, executing, onReload }: Props = $props();
  interface Preview {
    deliveryPlan: DeliveryPlan;
    stops: DeliveryStopInput[];
    labels: Record<string, string>;
    locations: { id: string; name: string; latitude: number | null; longitude: number | null }[];
    geometry: unknown;
    expectedUpdatedAt: string;
    optimization: string;
    savedDistanceKm: number | null;
  }
  type DraftStop = DeliveryStopInput & { label: string; early: string; late: string };
  let editing = $state(false),
    busy = $state(false),
    error = $state('');
  let fuelSource = $state<DeliveryFuelSourceInput | undefined>();
  let stops = $state<DraftStop[]>([]),
    options = $state<DeliveryPlanOptions>({});
  let start = $state(''),
    manualDistance = $state<number | undefined>(),
    expectedVersion = $state('');
  let preview = $state<Preview | null>(null),
    previewFingerprint = $state('');
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const canPlan = $derived(
    editable &&
      ($auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE) ?? false),
  );
  const canExecute = $derived(
    executing &&
      ($auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE) ?? false),
  );
  const mapStops = $derived(
    route?.stops.map((s) => ({ sequence: s.sequence, locationId: s.locationId, type: s.type })) ??
      [],
  );
  function localInput(value?: string | null) {
    if (!value) return '';
    const d = new Date(value),
      pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function edit(rebuild = false) {
    const plan = route?.deliveryPlan;
    fuelSource = plan?.fuelSource ? { vehicleId: plan.fuelSource.vehicleId, profileRevision: plan.fuelSource.profileRevision, priceRevision: plan.fuelSource.priceRevision, currency: plan.fuelSource.currency, asOf: plan.fuelSource.asOf } : undefined;
    options = {
      ...(plan?.options ?? { currency: 'CAD', serviceMinutes: 0, returnToStart: false }),
    };
    start = localInput(options.startAt);
    manualDistance =
      route?.distanceSource === 'MANUAL' ? (route.totalDistanceKm ?? undefined) : undefined;
    expectedVersion = detail.updatedAt;
    preview = null;
    error = '';
    const source: DeliveryStopInput[] =
      !rebuild && route
        ? route.stops
        : [
            ...detail.shipments.map((s, i) => ({
              sequence: i + 1,
              type: 'PICKUP',
              locationId: s.originLocationId,
              shipmentId: s.id,
              plannedArrivalEarly: s.plannedPickupEarly,
              plannedArrivalLate: s.plannedPickupLate,
            })),
            ...detail.shipments.map((s, i) => ({
              sequence: detail.shipments.length + i + 1,
              type: 'DELIVERY',
              locationId: s.destinationLocationId,
              shipmentId: s.id,
              plannedArrivalEarly: s.plannedDeliveryEarly,
              plannedArrivalLate: s.plannedDeliveryLate,
            })),
          ];
    stops = source.map((s) => {
      const existing = route?.stops.find((r) => r.shipmentId === s.shipmentId && r.type === s.type);
      const captured = plan?.stops.find((r) => r.shipmentId === s.shipmentId && r.type === s.type);
      return {
        ...s,
        serviceMinutes: captured?.serviceMinutes,
        idleMinutes: captured?.idleMinutes ?? 0,
        label: existing
          ? `${existing.location.name}, ${existing.location.city}`
          : `${detail.shipments.find((sh) => sh.id === s.shipmentId)?.shipmentNumber ?? 'Expédition'} · ${s.type === 'PICKUP' ? 'Origine' : 'Destination'}`,
        early: localInput(s.plannedArrivalEarly),
        late: localInput(s.plannedArrivalLate),
      };
    });
    editing = true;
  }
  function body() {
    return {
      loadId,
      expectedUpdatedAt: expectedVersion,
      totalDistanceKm: manualDistance,
      planning: { ...options, startAt: start ? new Date(start).toISOString() : undefined },
      fuelSource,
      stops: stops.map((s, i) => ({
        sequence: i + 1,
        type: s.type,
        locationId: s.locationId,
        shipmentId: s.shipmentId ?? undefined,
        serviceMinutes: s.serviceMinutes,
        idleMinutes: s.idleMinutes,
        plannedDepartureAt: s.plannedDepartureAt ?? undefined,
        plannedArrivalEarly: s.early ? new Date(s.early).toISOString() : undefined,
        plannedArrivalLate: s.late ? new Date(s.late).toISOString() : undefined,
      })),
    };
  }
  // Any edit invalidates the preview; no save of an unseen or stale proposed order.
  const fingerprint = $derived.by(() => {
    try {
      return JSON.stringify(body());
    } catch {
      return '';
    }
  });
  const fresh = $derived(preview != null && fingerprint === previewFingerprint);
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const copy = [...stops];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    stops = copy;
  }
  async function calculate(optimize: boolean) {
    busy = true;
    error = '';
    try {
      const result = await api<Preview>('/transportation/routes/preview', {
        method: 'POST',
        body: { ...body(), optimize },
      });
      stops = result.stops.map((s) => ({
        ...s,
        label: result.labels[s.locationId] ?? s.locationId,
        early: localInput(s.plannedArrivalEarly),
        late: localInput(s.plannedArrivalLate),
      }));
      expectedVersion = result.expectedUpdatedAt;
      preview = result;
      previewFingerprint = JSON.stringify(body());
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de calculer cette tournée.';
      preview = null;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (!fresh) return;
    busy = true;
    error = '';
    try {
      await api('/transportation/routes', { method: 'POST', body: body() });
      editing = false;
      toast.success('Tournée et hypothèses carburant enregistrées');
      await onReload();
    } catch (e) {
      error =
        e instanceof ApiError
          ? e.message
          : 'Enregistrement incertain. Rechargez le dossier avant de réessayer.';
      preview = null;
    } finally {
      busy = false;
    }
  }
  async function stopAction(id: string, status: string) {
    busy = true;
    error = '';
    try {
      await api(`/transportation/routes/stops/${id}/status`, { method: 'POST', body: { status } });
      await onReload();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de mettre à jour cet arrêt.';
    } finally {
      busy = false;
    }
  }
</script>

<Card>
  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="font-semibold text-ink">Tournée et carburant</h2>
      <p class="mt-1 text-xs text-ink-muted">
        Planifier les ramassages, les livraisons et le retour · Affichage {userTimeZone.value}
      </p>
    </div>
    {#if canPlan && !editing}<div class="flex flex-wrap gap-2">
        <Button variant="secondary" onclick={() => edit()} disabled={!detail.shipments.length}
          >{route ? 'Planifier la tournée' : 'Préparer la tournée'}</Button
        >{#if route?.coverageWarning}<Button variant="secondary" onclick={() => edit(true)}
            >Reconstruire depuis les expéditions</Button
          >{/if}
      </div>{/if}
  </div>
  <FuelOperationsPanel {loadId} refreshKey={detail.updatedAt} onApply={canPlan ? (value) => {
    if (!editing) edit();
    options = { ...options, ...value.options };
    fuelSource = value.fuelSource;
    preview = null;
  } : undefined} />
  {#if error}<p
      role="alert"
      class="mb-3 rounded-md border border-danger/30 p-3 text-sm text-danger"
    >
      {error}
    </p>{/if}
  {#if route?.coverageWarning}<p role="alert" class="mb-3 text-sm text-warning">
      {route.coverageWarning}
    </p>{/if}
  {#if editing}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void calculate(false);
      }}
      class="space-y-4"
    >
      <fieldset disabled={busy} class="space-y-4">
        <legend class="mb-3 text-sm font-semibold">Hypothèses de la tournée</legend>
        {#if fuelSource}<p class="text-xs text-ink-muted">Profil v{fuelSource.profileRevision}, prix v{fuelSource.priceRevision} — référence {fuelSource.asOf} (UTC). Les valeurs sont revérifiées côté serveur. Une saisie manuelle ci-dessous détache ce profil.</p>{/if}
        <p class="text-xs text-ink-muted">
          Saisie des horaires : {browserZone} (fuseau du navigateur). Les résultats utilisent {userTimeZone.value}.
          Début au premier arrêt; l’approche du camion n’est pas incluse.
        </p>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Début au premier arrêt"
            ><input class="plan-input" type="datetime-local" bind:value={start} /></Field
          >
          <Field label="Manutention par défaut (min/arrêt)"
            ><input
              class="plan-input"
              type="number"
              min="0"
              max="1440"
              step="1"
              bind:value={options.serviceMinutes}
            /></Field
          >
          <Field label="Consommation chargé (L/100 km)"
            ><input
              class="plan-input"
              type="number"
              min="0"
              max="200"
              step="0.1"
              bind:value={options.loadedLitersPer100Km}
              oninput={() => { fuelSource = undefined; }}
            /></Field
          >
          <Field label="Consommation à vide (L/100 km)"
            ><input
              class="plan-input"
              type="number"
              min="0"
              max="200"
              step="0.1"
              bind:value={options.emptyLitersPer100Km}
              oninput={() => { fuelSource = undefined; }}
            /></Field
          >
          <Field label="Consommation au ralenti (L/h)"
            ><input
              class="plan-input"
              type="number"
              min="0"
              max="100"
              step="0.1"
              bind:value={options.idleLitersPerHour}
              oninput={() => { fuelSource = undefined; }}
            /></Field
          >
          <Field label="Prix du carburant par litre"
            ><input
              class="plan-input"
              type="number"
              min="0"
              max="100"
              step="0.001"
              bind:value={options.pricePerLiter}
              oninput={() => { fuelSource = undefined; }}
            /></Field
          >
          <Field label="Devise du carburant"
            ><input
              class="plan-input"
              maxlength="3"
              pattern={'[A-Z]{3}'}
              placeholder="CAD"
              bind:value={options.currency}
              oninput={() => { fuelSource = undefined; }}
            /></Field
          >
          <Field label="Distance manuelle de tarification (km)"
            ><input
              class="plan-input"
              type="number"
              min="0"
              step="0.1"
              bind:value={manualDistance}
            /></Field
          >
        </div>
        <label class="flex items-center gap-2 text-sm"
          ><input type="checkbox" bind:checked={options.returnToStart} /> Inclure le retour au premier
          arrêt</label
        >
        <p class="text-xs text-ink-muted">
          La distance manuelle de tarification est préservée si elle existe. Le carburant utilise
          les segments routiers séparément. Le retour entre dans la distance calculée quand aucun
          total manuel n’est fixé.
        </p>
        <h3 class="text-sm font-semibold">Ordre et fenêtres des arrêts</h3>
        {#each stops as stop, i (i)}
          <section class="rounded-lg border border-edge p-3" aria-label={`Arrêt ${i + 1}`}>
            <div class="mb-3 flex items-center justify-between gap-2">
              <p class="text-sm">
                <span class="mr-2 font-mono text-ink-muted">#{i + 1}</span><strong
                  >{stop.type === 'PICKUP' ? 'Ramassage' : 'Livraison'}</strong
                >
                · {stop.label}
              </p>
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  aria-label={`Monter arrêt ${i + 1}`}
                  disabled={i === 0}
                  onclick={() => move(i, -1)}>↑</Button
                ><Button
                  variant="ghost"
                  aria-label={`Descendre arrêt ${i + 1}`}
                  disabled={i === stops.length - 1}
                  onclick={() => move(i, 1)}>↓</Button
                >
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field label={`Arrêt ${i + 1} · arrivée dès`}
                ><input class="plan-input" type="datetime-local" bind:value={stop.early} /></Field
              ><Field label={`Arrêt ${i + 1} · arrivée avant`}
                ><input class="plan-input" type="datetime-local" bind:value={stop.late} /></Field
              ><Field label={`Arrêt ${i + 1} · manutention (min)`}
                ><input
                  class="plan-input"
                  type="number"
                  min="0"
                  max="1440"
                  placeholder="Défaut tournée"
                  bind:value={stop.serviceMinutes}
                /></Field
              ><Field label={`Arrêt ${i + 1} · ralenti (min)`}
                ><input
                  class="plan-input"
                  type="number"
                  min="0"
                  max="1440"
                  bind:value={stop.idleMinutes}
                /></Field
              >
            </div>
          </section>
        {/each}
      </fieldset>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" loading={busy}>Calculer cet ordre</Button><Button
          variant="secondary"
          disabled={busy || stops.length > 50}
          onclick={() => calculate(true)}>Proposer un meilleur ordre</Button
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => {
            editing = false;
            error = '';
          }}>Annuler</Button
        >
      </div>
      {#if preview}
        <div class="space-y-3 border-t border-edge pt-4">
          <p class="text-sm" role="status">
            {preview.optimization}{preview.savedDistanceKm != null
              ? preview.savedDistanceKm < 0
                ? ` ${Math.abs(preview.savedDistanceKm).toLocaleString('fr-CA')} km supplémentaires pour réduire les retards.`
                : ` Écart de distance : ${preview.savedDistanceKm.toLocaleString('fr-CA')} km économisés.`
              : ''}
          </p>
          {#if !fresh}<p class="text-sm text-warning">
              Les paramètres ont changé. Recalculez avant de confirmer.
            </p>{/if}<DeliveryPlanSummary plan={preview.deliveryPlan} />
          {#key JSON.stringify([preview.stops, preview.geometry])}
            <LoadMap
              stops={preview.stops}
              {loadId}
              geometry={preview.geometry}
              locations={preview.locations}
            />
          {/key}
          <Button disabled={!fresh || busy} onclick={save}
            >Confirmer et enregistrer la tournée</Button
          >
          <p class="text-xs text-ink-muted">
            L’ordre proposé est modifiable. Les métriques sont recalculées à l’enregistrement;
            aucune livraison, facture ou notification n’est déclenchée.
          </p>
        </div>
      {/if}
    </form>
  {:else if route}
    {#if route.distanceSource === 'MANUAL'}<p class="mb-3 text-sm text-ink-muted">
        Distance de tarification manuelle conservée : {route.totalDistanceKm} km.
      </p>{/if}
    {#if route.deliveryPlan}<DeliveryPlanSummary plan={route.deliveryPlan} />{:else}<p
        class="mb-4 text-sm text-ink-muted"
      >
        Ancienne tournée : {route.totalDistanceKm ?? '—'} km · {route.distanceSource ??
          'source inconnue'}. Préparez le plan pour détailler le carburant et les trajets.
      </p>{/if}
    <div class="mt-5 space-y-2">
      <h3 class="mb-3 text-sm font-semibold">Exécution des livraisons</h3>
      {#each route.stops as stop, i (stop.id)}
        {@const schedule = route.deliveryPlan?.schedule[i]}
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-edge py-3 last:border-0"
        >
          <div class="min-w-0">
            <p class="text-sm">
              <span class="mr-2 font-mono text-ink-muted">#{stop.sequence}</span><strong
                >{stop.type === 'PICKUP' ? 'Ramassage' : 'Livraison'}</strong
              >
              · {stop.location.name}, {stop.location.city}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              Fenêtre : {formatDateTime(stop.plannedArrivalEarly)} → {formatDateTime(
                stop.plannedArrivalLate,
              )}
            </p>
            {#if schedule}<p class="mt-1 text-xs text-ink-muted">
                Arrivée prévue : {formatDateTime(schedule.arrivalAt)} · Départ prévu : {formatDateTime(
                  schedule.departureAt,
                )}{schedule.lateMin ? ` · Retard prévisionnel ${schedule.lateMin} min` : ''}
              </p>{/if}{#if stop.actualArrivalAt}<p class="mt-1 text-xs text-ink-muted">
                Arrivée réelle : {formatDateTime(stop.actualArrivalAt)} · Départ réel : {formatDateTime(
                  stop.actualDepartureAt,
                )}
              </p>{/if}
          </div>
          <div class="flex items-center gap-2">
            <Badge tone={toneFor(stop.status)}>{labelFor(stop.status)}</Badge
            >{#if canExecute && stop.status === 'PENDING'}<Button
                variant="secondary"
                disabled={busy ||
                  route.stops
                    .slice(0, i)
                    .some((s) => s.status === 'PENDING' || s.status === 'ARRIVED')}
                onclick={() => stopAction(stop.id, 'ARRIVED')}>Arrivée</Button
              >{:else if canExecute && stop.status === 'ARRIVED'}<Button
                variant="secondary"
                disabled={busy}
                onclick={() => stopAction(stop.id, 'DEPARTED')}>Départ</Button
              >{/if}
          </div>
        </div>
      {/each}
    </div>
    <p class="mt-3 text-xs text-ink-muted">
      Un départ d’arrêt ne confirme pas automatiquement la livraison ni la POD. Utilisez le suivi de
      l’expédition et les preuves de livraison.
    </p>
    {#if mapStops.length}<div class="mt-4">
        {#key JSON.stringify([mapStops, route.geometry])}<LoadMap
            stops={mapStops}
            {loadId}
            geometry={route.geometry ?? null}
            locations={route.stops.map((s) => ({
              id: s.locationId,
              name: s.location.name,
              latitude: s.location.latitude ?? null,
              longitude: s.location.longitude ?? null,
            }))}
          />{/key}
      </div>{/if}
  {:else}<p class="text-sm text-ink-muted">
      {detail.shipments.length
        ? 'Préparez la tournée pour comparer les trajets, estimer le carburant et vérifier les heures de livraison.'
        : 'Affectez d’abord les expéditions et leurs destinations à ce chargement.'}
    </p>{/if}
</Card>

<style>
  .plan-input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-edge);
    border-radius: 0.375rem;
    background: var(--color-surface);
    padding: 0.5rem 0.625rem;
    font-size: 0.875rem;
    color: var(--color-ink);
  }
  .plan-input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
