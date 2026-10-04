<script lang="ts">
  import type { DeliveryPlan } from '@pulsar/shared';
  import { formatDateTime, formatMoney } from '$lib/format';
  import { Badge } from '$lib/components/ui';
  let { plan }: { plan: DeliveryPlan } = $props();
  const value = (n: number | null, unit: string) =>
    n == null
      ? 'Non calculé'
      : `${n.toLocaleString('fr-CA', { maximumFractionDigits: 2 })} ${unit}`;
</script>

<section aria-label="Prévision de livraison" class="space-y-4">
  <dl class="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4 lg:grid-cols-4">
    <div>
      <dt class="text-xs text-ink-muted">Trajets de la tournée</dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums">{value(plan.totals.distanceKm, 'km')}</dd>
    </div>
    <div>
      <dt class="text-xs text-ink-muted">Conduite estimée</dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums">
        {value(plan.totals.drivingMinutes, 'min')}
      </dd>
    </div>
    <div>
      <dt class="text-xs text-ink-muted">Carburant estimé</dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums">{value(plan.totals.liters, 'L')}</dd>
    </div>
    <div>
      <dt class="text-xs text-ink-muted">Coût carburant · hors tarif</dt>
      <dd class="mt-1 text-lg font-semibold tabular-nums">
        {plan.totals.fuelCost == null || !plan.totals.currency
          ? 'Non calculé'
          : formatMoney(plan.totals.fuelCost, plan.totals.currency)}
      </dd>
    </div>
  </dl>
  <p class="text-sm text-ink-muted">
    Manutention : {plan.totals.serviceMinutes} min · Attente : {value(
      plan.totals.waitingMinutes,
      'min',
    )} · Fin prévue : {formatDateTime(plan.totals.finishAt)}{plan.options.returnToStart
      ? ' · Retour inclus'
      : ''}
  </p>
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm tabular-nums">
      <caption class="sr-only">Distances et carburant entre chaque arrêt</caption>
      <thead class="border-b border-edge text-xs text-ink-muted"
        ><tr
          ><th class="p-2">Trajet</th><th class="p-2">Source</th><th class="p-2">Charge</th><th
            class="p-2">Distance</th
          ><th class="p-2">Conduite</th><th class="p-2">Carburant</th></tr
        ></thead
      >
      <tbody
        >{#each plan.legs as leg, i (i)}<tr class="border-b border-edge last:border-0"
            ><td class="p-2 whitespace-nowrap">#{leg.fromSequence} → #{leg.toSequence}</td><td
              class="p-2"
              ><Badge tone={leg.source === 'OSRM' ? 'neutral' : 'warn'}
                >{leg.source === 'OSRM'
                  ? 'Routier'
                  : leg.source === 'HAVERSINE'
                    ? 'Vol d’oiseau'
                    : 'Inconnu'}</Badge
              ></td
            ><td class="p-2">{leg.empty == null ? 'Inconnue' : leg.empty ? 'À vide' : 'Chargé'}</td
            ><td class="p-2 whitespace-nowrap">{value(leg.distanceKm, 'km')}</td><td
              class="p-2 whitespace-nowrap">{value(leg.durationMin, 'min')}</td
            ><td class="p-2 whitespace-nowrap">{value(leg.liters, 'L')}</td></tr
          >{/each}</tbody
      >
    </table>
  </div>
  <p class="text-xs text-ink-muted">
    Ralenti déclaré : {plan.totals.idleMinutes} min / {value(plan.totals.idleLiters, 'L')}.
    L’attente n’est pas automatiquement du ralenti. Ce budget n’est ni une dépense réelle ni la
    surcharge carburant du tarif.
  </p>
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm tabular-nums">
      <caption class="pb-2 text-left font-medium">Horaire prévisionnel par arrêt</caption>
      <thead class="border-b border-edge text-xs text-ink-muted">
        <tr
          ><th class="p-2">Arrêt</th><th class="p-2">Arrivée</th><th class="p-2"
            >Départ après service</th
          ><th class="p-2">Retard sur fenêtre</th></tr
        >
      </thead>
      <tbody>
        {#each plan.schedule as stop, i (stop.sequence)}
          <tr class="border-b border-edge last:border-0">
            <td class="p-2"
              >#{stop.sequence} · {plan.stops[i]?.type === 'PICKUP' ? 'Ramassage' : 'Livraison'}</td
            >
            <td class="p-2">{stop.arrivalAt ? formatDateTime(stop.arrivalAt) : 'Non calculée'}</td>
            <td class="p-2"
              >{stop.departureAt ? formatDateTime(stop.departureAt) : 'Non calculé'}</td
            >
            <td class="p-2">{stop.lateMin == null ? 'Non évalué' : value(stop.lateMin, 'min')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if plan.warnings.length}<ul
      class="space-y-1 rounded-md border border-edge p-3 text-xs text-ink-muted"
      aria-label="Limites de la prévision"
    >
      {#each plan.warnings as warning}<li>{warning}</li>{/each}
    </ul>{/if}
</section>
