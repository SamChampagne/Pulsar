<script lang="ts">
  import { untrack } from 'svelte';
  import {
    CURRENCIES,
    PERMISSIONS,
    applyDeliveryFuelParameters,
    deliveryFuelRange,
    validateDeliveryFuelActual,
    validateDeliveryFuelPrice,
    validateDeliveryFuelProfile,
    type DeliveryFuelActualSnapshot,
    type DeliveryFuelApplied,
    type DeliveryFuelPrice,
    type DeliveryFuelProfile,
    type DeliveryFuelRevision,
    type Paginated,
    type compareDeliveryFuel,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    Drawer,
    ErrorNotice,
    Field,
    Input,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import { fuelOperationStorageKey, parseFuelIntent, type FuelIntent } from './fuel-operation';

  let {
    loadId,
    refreshKey = '',
    onApply,
  }: {
    loadId: string;
    refreshKey?: string;
    onApply?: (value: DeliveryFuelApplied) => void;
  } = $props();
  type ActualRecord = DeliveryFuelRevision<DeliveryFuelActualSnapshot> & {
    comparison: ReturnType<typeof compareDeliveryFuel>;
  };
  type Context = {
    load: {
      id: string;
      loadNumber: string;
      status: string;
      updatedAt: string;
      vehicleId: string | null;
      vehicle: { id: string; unitNumber: string } | null;
    };
    route: {
      id: string;
      updatedAt: string;
      deliveryPlan: {
        options?: { startAt?: string };
        totals?: { liters: number | null };
        fuelSource?: unknown;
      } | null;
    } | null;
    profile: DeliveryFuelRevision<DeliveryFuelProfile> | null;
    latestPriceRevision: number;
    actual: ActualRecord | null;
  };
  const base = '/transportation/delivery-fuel';
  const scope = $derived(`${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}:${loadId}`);
  const canRead = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_READ) ?? false,
  );
  const canPlan = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE) ?? false,
  );
  const canExecute = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE) ?? false,
  );
  let data = $state<Context | null>(null),
    loading = $state(true),
    busy = $state(false),
    error = $state(''),
    actionError = $state(''),
    storageError = $state('');
  let pending = $state<FuelIntent | null>(null),
    inspected = $state(false);
  let prices = $state<DeliveryFuelRevision<DeliveryFuelPrice>[]>([]),
    pricePage = $state(1),
    priceTotal = $state(0),
    selectedPrice = $state(''),
    asOf = $state('');
  let open = $state(false),
    mode = $state<'profile' | 'price' | 'actual' | 'profile-history' | 'actual-history'>('profile');
  let editVersions = $state<{
    revision: number;
    vehicleId: string | null;
    loadUpdatedAt: string;
    routeUpdatedAt: string | null;
  } | null>(null);
  let history = $state<Array<DeliveryFuelRevision<DeliveryFuelProfile> | ActualRecord>>([]),
    historyPage = $state(1),
    historyTotal = $state(0),
    historyLoading = $state(false);
  let loaded = $state(''),
    empty = $state(''),
    idle = $state(''),
    tank = $state(''),
    reserve = $state('');
  let effectiveOn = $state(''),
    amount = $state(''),
    currency = $state('CAD'),
    reference = $state('');
  let distance = $state(''),
    litres = $state(''),
    actualCost = $state(''),
    actualCurrency = $state('CAD'),
    measuredAt = $state(''),
    note = $state('');
  let generation = 0,
    historyGeneration = 0;
  const price = $derived(prices.find((p) => p.id === selectedPrice) ?? null);
  const blocked = $derived(busy || loading || !!error || !!pending || !!storageError);
  const editablePlan = $derived(!!data && ['OPEN', 'PLANNED'].includes(data.load.status));
  const actualAllowed = $derived(
    !!data?.route?.deliveryPlan && ['IN_TRANSIT', 'COMPLETED'].includes(data?.load.status ?? ''),
  );
  const range = $derived(
    data?.profile
      ? deliveryFuelRange(data.profile.snapshot, data.route?.deliveryPlan?.totals?.liters ?? null)
      : null,
  );
  const n = (v: number | string | null | undefined) =>
    v == null ? 'Non mesuré' : Number(v).toLocaleString('fr-CA', { maximumFractionDigits: 3 });
  const delta = (v: number | null) => (v == null ? 'Non comparable' : `${v > 0 ? '+' : ''}${n(v)}`);

  function restore() {
    pending = null;
    storageError = '';
    inspected = false;
    try {
      const raw = sessionStorage.getItem(fuelOperationStorageKey(scope));
      if (raw) pending = parseFuelIntent(raw, loadId);
    } catch {
      storageError = 'Demande conservée illisible. Inspectez les historiques avant de la retirer.';
    }
  }
  async function reload() {
    const current = ++generation,
      owner = scope;
    loading = true;
    error = '';
    try {
      const [context, list] = await Promise.all([
        api<Context>(`${base}/loads/${encodeURIComponent(loadId)}`),
        api<Paginated<DeliveryFuelRevision<DeliveryFuelPrice>>>(`${base}/prices`, {
          query: { page: pricePage },
        }),
      ]);
      if (current !== generation || owner !== scope) return false;
      data = context;
      prices = list.items;
      priceTotal = list.total;
      if (!prices.some((p) => p.id === selectedPrice)) selectedPrice = '';
      if (!asOf) {
        const departure = context.route?.deliveryPlan?.options?.startAt;
        asOf = (departure ? new Date(departure) : new Date()).toISOString().slice(0, 10);
      }
      return true;
    } catch (e) {
      if (current === generation && owner === scope)
        error = e instanceof ApiError ? e.message : 'Paramètres carburant indisponibles.';
      return false;
    } finally {
      if (current === generation && owner === scope) loading = false;
    }
  }
  $effect(() => {
    scope;
    untrack(() => {
      ++generation;
      ++historyGeneration;
      data = null;
      prices = [];
      selectedPrice = '';
      asOf = '';
      pricePage = 1;
      open = false;
      busy = false;
      actionError = '';
      restore();
    });
  });
  $effect(() => {
    scope;
    refreshKey;
    pricePage;
    if (canRead)
      untrack(() => {
        void reload();
      });
  });

  function edit(next: 'profile' | 'price' | 'actual') {
    if (blocked || !data) return;
    mode = next;
    editVersions = {
      revision:
        next === 'profile'
          ? (data.profile?.revision ?? 0)
          : next === 'price'
            ? data.latestPriceRevision
            : (data.actual?.revision ?? 0),
      vehicleId: data.load.vehicleId,
      loadUpdatedAt: data.load.updatedAt,
      routeUpdatedAt: data.route?.updatedAt ?? null,
    };
    actionError = '';
    const p = data.profile?.snapshot;
    loaded = p ? String(p.loadedLitersPer100Km) : '';
    empty = p ? String(p.emptyLitersPer100Km) : '';
    idle = p ? String(p.idleLitersPerHour) : '';
    tank = p ? String(p.tankCapacityLitres) : '';
    reserve = p ? String(p.reserveLitres) : '';
    effectiveOn = new Date().toISOString().slice(0, 10);
    amount = '';
    currency = 'CAD';
    reference = '';
    const a = data.actual?.snapshot;
    distance = a?.distanceKm ?? '';
    litres = a?.consumedLitres ?? '';
    actualCost = a?.costAmount ?? '';
    actualCurrency = a?.currency ?? 'CAD';
    measuredAt = new Date().toISOString();
    note = '';
    open = true;
  }
  async function showHistory(next: 'profile-history' | 'actual-history', page = 1) {
    if (!data) return;
    const owner = scope,
      current = ++historyGeneration;
    mode = next;
    historyPage = page;
    open = true;
    historyLoading = true;
    actionError = '';
    const endpoint =
      next === 'profile-history'
        ? `${base}/vehicles/${encodeURIComponent(data.load.vehicleId ?? '')}/profile`
        : `${base}/loads/${encodeURIComponent(loadId)}/actuals`;
    try {
      const result = await api<Paginated<DeliveryFuelRevision<DeliveryFuelProfile> | ActualRecord>>(
        endpoint,
        { query: { page } },
      );
      if (owner === scope && current === historyGeneration) {
        history = result.items;
        historyTotal = result.total;
      }
    } catch (e) {
      if (owner === scope && current === historyGeneration)
        actionError = e instanceof ApiError ? e.message : 'Historique indisponible.';
    } finally {
      if (owner === scope && current === historyGeneration) historyLoading = false;
    }
  }
  async function apply() {
    if (
      blocked ||
      !editablePlan ||
      !canPlan ||
      !data?.profile ||
      !data.load.vehicleId ||
      !price ||
      !onApply
    )
      return;
    if (!asOf || price.snapshot.effectiveOn > asOf) {
      actionError = 'Choisissez un prix applicable à la date de référence.';
      return;
    }
    const owner = scope;
    const value: DeliveryFuelApplied = {
      options: applyDeliveryFuelParameters(data.profile.snapshot, price.snapshot),
      fuelSource: {
        vehicleId: data.load.vehicleId,
        profileRevision: data.profile.revision,
        priceRevision: price.revision,
        currency: price.snapshot.currency,
        asOf,
      },
    };
    if (
      !(await confirmAction(
        'Copier ce profil et ce prix dans le brouillon de tournée ? Il faudra ensuite prévisualiser puis enregistrer la tournée. Aucun plan existant ne change ici.',
        {
          title: 'Préparer les hypothèses carburant',
          confirmLabel: 'Appliquer au brouillon',
          dangerous: false,
        },
      ))
    )
      return;
    if (owner !== scope || blocked) return;
    onApply(value);
    toast.success('Hypothèses copiées dans le brouillon de tournée.');
    actionError = '';
  }
  async function save() {
    if (blocked || !data || !editVersions) return;
    actionError = '';
    let intent: FuelIntent;
    try {
      const operationKey = crypto.randomUUID();
      if (mode === 'profile' && canPlan && data.load.vehicleId) {
        if (data.load.vehicleId !== editVersions.vehicleId)
          throw Error('Le véhicule affecté a changé. Fermez puis ouvrez de nouveau le profil.');
        if ([loaded, empty, idle, tank, reserve].some((v) => v === ''))
          throw Error('Tous les paramètres du profil sont requis.');
        const profile = validateDeliveryFuelProfile({
          loadedLitersPer100Km: Number(loaded),
          emptyLitersPer100Km: Number(empty),
          idleLitersPerHour: Number(idle),
          tankCapacityLitres: Number(tank),
          reserveLitres: Number(reserve),
        });
        intent = {
          kind: 'profile',
          endpoint: `${base}/vehicles/${encodeURIComponent(data.load.vehicleId)}/profile`,
          body: { operationKey, expectedRevision: editVersions.revision, profile },
        };
      } else if (mode === 'price' && canPlan) {
        const price = validateDeliveryFuelPrice({
          effectiveOn,
          pricePerLitre: amount,
          currency,
          reference,
        });
        intent = {
          kind: 'price',
          endpoint: `${base}/prices`,
          body: { operationKey, expectedRevision: editVersions.revision, price },
        };
      } else if (mode === 'actual' && canExecute && actualAllowed && data.route) {
        const actual = validateDeliveryFuelActual({
          distanceKm: distance,
          consumedLitres: litres,
          costAmount: actualCost === '' ? null : actualCost,
          currency: actualCost === '' ? null : actualCurrency,
          measuredAt,
          note,
        });
        intent = {
          kind: 'actual',
          endpoint: `${base}/loads/${encodeURIComponent(loadId)}/actuals`,
          body: {
            operationKey,
            expectedRevision: editVersions.revision,
            expectedLoadUpdatedAt: editVersions.loadUpdatedAt,
            expectedRouteUpdatedAt: editVersions.routeUpdatedAt,
            actual,
          },
        };
      } else return;
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Paramètres invalides.';
      return;
    }
    const owner = scope;
    if (
      !(await confirmAction(
        mode === 'actual'
          ? 'Enregistrer ces totaux déclarés pour la tournée ? Cette nouvelle révision remplace la déclaration courante, sans additionner les totaux ni modifier le stock, la finance ou les statuts.'
          : 'Publier une nouvelle révision immuable ? Les anciennes tournées et déclarations conserveront leurs paramètres capturés.',
        {
          title: 'Confirmer la déclaration',
          confirmLabel: 'Enregistrer la révision',
          dangerous: false,
        },
      ))
    )
      return;
    if (owner !== scope || blocked) return;
    try {
      sessionStorage.setItem(fuelOperationStorageKey(scope), JSON.stringify(intent));
      pending = intent;
      inspected = false;
    } catch {
      storageError = 'Impossible de conserver la demande avant envoi. Aucune écriture effectuée.';
      return;
    }
    await send(intent);
  }
  async function send(intent: FuelIntent) {
    if (busy || (intent.kind === 'actual' ? !canExecute : !canPlan)) return;
    const owner = scope;
    busy = true;
    actionError = '';
    try {
      const receipt = await api<{ operationKey: string; revision: number }>(intent.endpoint, {
        method: 'POST',
        body: intent.body,
      });
      if (owner !== scope) return;
      if (receipt.operationKey !== intent.body.operationKey || !Number.isInteger(receipt.revision))
        throw Error('Réception non reconnue.');
      sessionStorage.removeItem(fuelOperationStorageKey(owner));
      pending = null;
      open = false;
      selectedPrice = '';
      toast.success('Révision carburant enregistrée.');
      await reload();
    } catch (e) {
      if (owner !== scope) return;
      const certain = e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode);
      // Even a definitive refusal on retry cannot prove that an earlier uncertain
      // attempt did not commit (e.g. permission revoked in the meantime).
      actionError =
        (e instanceof Error ? e.message : 'Réponse indisponible.') +
        (certain
          ? ' Demande conservée : inspectez les historiques avant de la retirer ou de la reprendre.'
          : ' Résultat incertain : inspectez les historiques ou reprenez exactement la demande conservée.');
    } finally {
      if (owner === scope) busy = false;
    }
  }
  async function inspect() {
    if (await reload()) inspected = true;
  }
  async function discard() {
    if (!inspected || busy) return;
    const owner = scope;
    if (
      !(await confirmAction(
        'Avez-vous vérifié les historiques ? Retirer cette demande ne supprime aucune révision déjà enregistrée.',
        { title: 'Retirer la demande locale', confirmLabel: 'Retirer après vérification' },
      )) ||
      owner !== scope
    )
      return;
    try {
      sessionStorage.removeItem(fuelOperationStorageKey(scope));
      pending = null;
      storageError = '';
      actionError = '';
      open = false;
    } catch {
      storageError = 'Stockage local indisponible.';
    }
  }
</script>

{#if canRead}
  <section aria-label="Carburant de la tournée">
    <Card>
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-display text-base font-semibold text-ink">Carburant de la tournée</h2>
          <p class="mt-1 max-w-3xl text-sm text-ink-muted">
            Paramètres déclarés et comparaison opérationnelle. Aucun relevé GPS, achat ni écriture
            financière.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onclick={() => {
            void reload();
          }}
          disabled={busy || loading}>Actualiser</Button
        >
      </div>
      {#if error}<ErrorNotice message={error} />{/if}
      {#if actionError && !open}<ErrorNotice message={actionError} />{/if}
      {#if pending || storageError}
        <div
          class="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-ink"
          role="status"
        >
          <p>
            {storageError ||
              'Une demande attend sa confirmation. Ne créez pas une autre révision pour la remplacer.'}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onclick={inspect} disabled={busy || loading}
              >Inspecter les données</Button
            >{#if pending}<Button
                size="sm"
                onclick={() => {
                  if (pending) void send(pending);
                }}
                disabled={busy || (pending.kind === 'actual' ? !canExecute : !canPlan)}
                >Reprendre la même demande</Button
              >{/if}<Button
              size="sm"
              variant="ghost"
              onclick={discard}
              disabled={busy || !inspected}>Retirer après vérification</Button
            >
          </div>
        </div>
      {/if}
      {#if loading && !data}<Skeleton rows={4} />{:else if data}
        <div class="grid gap-5 lg:grid-cols-2">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-ink">
                Profil · {data.load.vehicle?.unitNumber ?? 'Véhicule non affecté'}
              </h3>
              {#if data.profile}<Badge>Révision {data.profile.revision}</Badge>{/if}
            </div>
            {#if data.profile}
              <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt class="text-ink-muted">Chargé / à vide</dt>
                  <dd class="font-mono text-ink">
                    {n(data.profile.snapshot.loadedLitersPer100Km)} / {n(
                      data.profile.snapshot.emptyLitersPer100Km,
                    )} L/100 km
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Au ralenti</dt>
                  <dd class="font-mono text-ink">
                    {n(data.profile.snapshot.idleLitersPerHour)} L/h
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Réservoir / réserve</dt>
                  <dd class="font-mono text-ink">
                    {n(data.profile.snapshot.tankCapacityLitres)} / {n(
                      data.profile.snapshot.reserveLitres,
                    )} L
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Autonomie théorique chargé</dt>
                  <dd class="font-mono text-ink">{n(range?.loadedRangeKm)} km</dd>
                </div>
              </dl>
              <p class="text-xs text-ink-muted">
                Autonomie avec réservoir plein moins réserve, hors ralenti. Niveau au départ et
                ravitaillements inconnus.
              </p>
              {#if range?.exceedsUsableTank}<p class="text-sm text-warning">
                  Le plan dépasse le volume utilisable théorique. Vérifiez manuellement le
                  ravitaillement.
                </p>{/if}
            {:else}<p class="text-sm text-ink-muted">
                Aucun profil enregistré pour ce véhicule. Aucune consommation n’est supposée.
              </p>{/if}
            <div class="flex flex-wrap gap-2">
              {#if canPlan}<Button
                  size="sm"
                  variant="secondary"
                  onclick={() => edit('profile')}
                  disabled={blocked || !data.load.vehicleId}
                  >{data.profile ? 'Réviser le profil' : 'Créer le profil'}</Button
                >{/if}{#if data.profile}<Button
                  size="sm"
                  variant="ghost"
                  onclick={() => showHistory('profile-history')}
                  disabled={busy}>Historique du profil</Button
                >{/if}
            </div>
          </div>
          <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-ink">Prix déclaré · choix explicite</h3>
              {#if canPlan}<Button
                  size="sm"
                  variant="secondary"
                  onclick={() => edit('price')}
                  disabled={blocked}>Ajouter un prix</Button
                >{/if}
            </div>
            <Field label="Révision de prix"
              ><Select
                aria-label="Révision de prix carburant"
                bind:value={selectedPrice}
                disabled={blocked}
                ><option value="">Choisir un prix, aucune sélection automatique</option
                >{#each prices as p}<option value={p.id}
                    >R{p.revision} · {p.snapshot.effectiveOn} · {p.snapshot.pricePerLitre}
                    {p.snapshot.currency}/L · {p.snapshot.reference}</option
                  >{/each}</Select
              ></Field
            >
            {#if !prices.length}<p class="text-sm text-ink-muted">
                Aucun prix sur cette page.
              </p>{/if}
            {#if priceTotal > 20}<div class="flex items-center gap-2 text-xs text-ink-muted">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading || pricePage <= 1}
                  onclick={() => {
                    selectedPrice = '';
                    pricePage--;
                  }}>Prix précédents</Button
                ><span>Page {pricePage} / {Math.ceil(priceTotal / 20)}</span><Button
                  size="sm"
                  variant="ghost"
                  disabled={loading || pricePage * 20 >= priceTotal}
                  onclick={() => {
                    selectedPrice = '';
                    pricePage++;
                  }}>Prix suivants</Button
                >
              </div>{/if}
            <Field label="Date de référence (UTC)"
              ><Input
                type="date"
                aria-label="Date de référence carburant UTC"
                bind:value={asOf}
                disabled={blocked}
              /></Field
            >
            <p class="text-xs text-ink-muted">
              Doit correspondre au jour UTC du départ planifié. Un prix futur n’est jamais retenu
              implicitement; aucune conversion de devise.
            </p>
            {#if onApply && canPlan}<Button
                size="sm"
                onclick={apply}
                disabled={blocked || !editablePlan || !data.profile || !price}
                >Appliquer au brouillon de tournée</Button
              >{/if}
            {#if !editablePlan}<p class="text-xs text-ink-muted">
                Le plan engagé conserve ses hypothèses capturées.
              </p>{/if}
          </div>
        </div>
        <div class="mt-5 border-t border-edge-soft pt-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-ink">
              Réel déclaré · {data.actual
                ? `révision ${data.actual.revision}`
                : 'aucune déclaration'}
            </h3>
            <div class="flex flex-wrap gap-2">
              {#if data.actual}<Button
                  size="sm"
                  variant="ghost"
                  onclick={() => showHistory('actual-history')}
                  disabled={busy}>Historique du réel</Button
                >{/if}{#if canExecute}<Button
                  size="sm"
                  variant="secondary"
                  onclick={() => edit('actual')}
                  disabled={blocked || !actualAllowed}
                  >{data.actual
                    ? 'Corriger les totaux déclarés'
                    : 'Déclarer les totaux réels'}</Button
                >{/if}
            </div>
          </div>
          {#if data.actual}
            <div class="mt-3 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs text-ink-muted"
                  ><tr
                    ><th class="py-2 font-medium">Mesure</th><th class="py-2 font-medium"
                      >Base capturée</th
                    ><th class="py-2 font-medium">Déclaré</th><th class="py-2 font-medium">Écart</th
                    ></tr
                  ></thead
                ><tbody class="font-mono text-ink"
                  ><tr
                    ><td class="py-1 font-sans">Distance (km)</td><td
                      >{n(data.actual.comparison.planned.distanceKm)}</td
                    ><td>{n(data.actual.snapshot.distanceKm)}</td><td
                      >{delta(data.actual.comparison.deltaDistanceKm)}</td
                    ></tr
                  ><tr
                    ><td class="py-1 font-sans">Consommation (L)</td><td
                      >{n(data.actual.comparison.planned.litres)}</td
                    ><td>{n(data.actual.snapshot.consumedLitres)}</td><td
                      >{delta(data.actual.comparison.deltaLitres)}</td
                    ></tr
                  ><tr
                    ><td class="py-1 font-sans">Coût déclaré</td><td
                      >{n(data.actual.comparison.planned.costAmount)}
                      {data.actual.comparison.planned.currency ?? ''}</td
                    ><td
                      >{n(data.actual.snapshot.costAmount)}
                      {data.actual.snapshot.currency ?? ''}</td
                    ><td
                      >{delta(data.actual.comparison.deltaCostAmount)}
                      {data.actual.comparison.costComparable
                        ? data.actual.snapshot.currency
                        : ''}</td
                    ></tr
                  ></tbody
                >
              </table>
            </div>
            <p class="mt-2 text-xs text-ink-muted">
              Base figée du {formatDateTime(data.actual.snapshot.baseline.routeUpdatedAt)}. Relevé
              du {formatDateTime(data.actual.snapshot.measuredAt)}. Même si la tournée change
              ensuite, cette comparaison reste historique.
            </p>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm text-ink-muted">
              {data.actual.snapshot.note}
            </p>
          {:else}<p class="mt-2 text-sm text-ink-muted">
              Les mesures seront saisies explicitement en transit ou après clôture, avec un plan
              enregistré. Aucune valeur réelle n’est déduite du GPS ou de l’estimation.
            </p>{/if}
        </div>
      {/if}
    </Card>
  </section>
{/if}

<Drawer
  bind:open
  title={mode === 'profile'
    ? 'Profil carburant du véhicule'
    : mode === 'price'
      ? 'Nouveau prix déclaré'
      : mode === 'actual'
        ? 'Totaux réels de la tournée'
        : mode === 'profile-history'
          ? 'Historique des profils'
          : 'Historique des déclarations'}
  width="lg"
  dismissible={!busy}
>
  {#if actionError}<ErrorNotice message={actionError} />{/if}
  {#if mode === 'profile-history' || mode === 'actual-history'}
    {#if historyLoading}<Skeleton rows={4} />{:else}
      <p class="mb-4 text-sm text-ink-muted">
        Révisions immuables, de la plus récente à la plus ancienne.
      </p>
      {#each history as item}<div class="mb-3 rounded-md border border-edge-soft p-3 text-sm">
          <p class="font-semibold text-ink">
            Révision {item.revision} · {formatDateTime(item.createdAt)}
          </p>
          {#if 'comparison' in item}<p class="mt-2 font-mono text-ink">
              {n(item.snapshot.distanceKm)} km · {n(item.snapshot.consumedLitres)} L · {n(
                item.snapshot.costAmount,
              )}
              {item.snapshot.currency ?? ''}
            </p>
            <p class="mt-2 whitespace-pre-wrap break-words text-ink-muted">{item.snapshot.note}</p>
            <p class="mt-1 text-xs text-ink-muted">
              Relevé {formatDateTime(item.snapshot.measuredAt)} · base {formatDateTime(
                item.snapshot.baseline.routeUpdatedAt,
              )}
            </p>{:else}<p class="mt-2 font-mono text-ink">
              {n(item.snapshot.loadedLitersPer100Km)} / {n(item.snapshot.emptyLitersPer100Km)} L/100 km
              · {n(item.snapshot.idleLitersPerHour)} L/h
            </p>
            <p class="mt-1 text-ink-muted">
              Réservoir {n(item.snapshot.tankCapacityLitres)} L · réserve {n(
                item.snapshot.reserveLitres,
              )} L
            </p>{/if}
        </div>{/each}
      {#if !history.length}<p class="text-sm text-ink-muted">Aucune révision enregistrée.</p>{/if}
      <div class="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={historyPage <= 1}
          onclick={() => showHistory(mode as 'profile-history' | 'actual-history', historyPage - 1)}
          >Précédent</Button
        ><span class="text-xs text-ink-muted">Page {historyPage} · {historyTotal} révisions</span
        ><Button
          size="sm"
          variant="secondary"
          disabled={historyPage * 20 >= historyTotal}
          onclick={() => showHistory(mode as 'profile-history' | 'actual-history', historyPage + 1)}
          >Suivant</Button
        >
      </div>
    {/if}
  {:else}
    <form
      class="space-y-4"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p class="text-sm text-ink-muted">
        Chaque enregistrement crée une révision. Il ne modifie pas les anciennes hypothèses ni les
        coûts financiers.
      </p>
      {#if mode === 'profile'}
        <Field label="Chargé (L/100 km)"
          ><Input
            aria-label="Chargé (L/100 km)"
            inputmode="decimal"
            bind:value={loaded}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="À vide (L/100 km)"
          ><Input
            aria-label="À vide (L/100 km)"
            inputmode="decimal"
            bind:value={empty}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Ralenti (L/h)"
          ><Input
            aria-label="Ralenti (L/h)"
            inputmode="decimal"
            bind:value={idle}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Capacité réservoir (L)"
          ><Input
            aria-label="Capacité réservoir (L)"
            inputmode="decimal"
            bind:value={tank}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Réserve (L)"
          ><Input
            aria-label="Réserve (L)"
            inputmode="decimal"
            bind:value={reserve}
            required
            disabled={!!pending || busy}
          /></Field
        >
      {:else if mode === 'price'}
        <Field label="Applicable à partir du (date UTC)"
          ><Input
            aria-label="Date du prix carburant"
            type="date"
            bind:value={effectiveOn}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Prix par litre (4 décimales maximum)"
          ><Input
            aria-label="Prix par litre"
            inputmode="decimal"
            bind:value={amount}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Devise"
          ><Select
            aria-label="Devise du prix carburant"
            bind:value={currency}
            disabled={!!pending || busy}
            >{#each CURRENCIES as c}<option value={c.code}>{c.code}</option>{/each}</Select
          ></Field
        ><Field label="Source du prix déclaré"
          ><Input
            aria-label="Source du prix déclaré"
            bind:value={reference}
            minlength={3}
            maxlength={200}
            required
            disabled={!!pending || busy}
          /></Field
        >
      {:else}
        <p class="text-sm text-ink-muted">
          Saisissez les totaux cumulés de cette tournée, pas un ajout. En transit, indiquez
          clairement une mesure provisoire. Coût vide signifie inconnu, jamais zéro.
        </p>
        <Field label="Distance totale (km)"
          ><Input
            aria-label="Distance totale (km)"
            inputmode="decimal"
            bind:value={distance}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Litres consommés (total)"
          ><Input
            aria-label="Litres consommés (total)"
            inputmode="decimal"
            bind:value={litres}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Coût déclaré (facultatif)"
          ><Input
            aria-label="Coût déclaré"
            inputmode="decimal"
            bind:value={actualCost}
            disabled={!!pending || busy}
          /></Field
        ><Field label="Devise du coût déclaré"
          ><Select
            aria-label="Devise du coût déclaré"
            bind:value={actualCurrency}
            disabled={!!pending || busy || actualCost === ''}
            >{#each CURRENCIES as c}<option value={c.code}>{c.code}</option>{/each}</Select
          ></Field
        ><Field label="Instant du relevé (ISO avec fuseau)"
          ><Input
            aria-label="Instant du relevé"
            bind:value={measuredAt}
            required
            disabled={!!pending || busy}
          /></Field
        ><Field label="Méthode et portée du relevé"
          ><Textarea
            aria-label="Méthode et portée du relevé"
            bind:value={note}
            maxlength={1000}
            required
            disabled={!!pending || busy}
          /></Field
        >
      {/if}
      <div class="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onclick={() => {
            open = false;
          }}
          disabled={busy}>Fermer</Button
        ><Button type="submit" disabled={blocked}>Enregistrer la révision</Button>
      </div>
    </form>
  {/if}
</Drawer>
