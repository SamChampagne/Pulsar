<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDateTime } from '$lib/format';
  import { userTimeZone } from '$lib/stores/time-zone.svelte';
  import { Badge, Button, Card, Drawer, Field, ErrorNotice, Skeleton } from '$lib/components/ui';
  import {
    PERMISSIONS,
    DeliveryExceptionStatus as State,
    canTransitionDeliveryException,
  } from '@pulsar/shared';

  type Package = { id: string; code: string; status: string; version: number };
  type Case = {
    id: string;
    kind: string;
    status: State;
    note: string;
    version: number;
    retryAt: string | null;
    receivedAt: string | null;
    receivedBy: string | null;
    returnLocation: { name: string } | null;
    package: Package;
    nextAction: string;
    events: { createdAt: string; snapshot: { after?: { note?: string; status?: string } } }[];
  };
  type View = { load: { updatedAt: string; status: string }; truncated: boolean; cases: Case[] };
  type Intent = { path: string; body: Record<string, unknown>; summary: string };
  let {
    loadId,
    refreshKey,
    onReload,
  }: { loadId: string; refreshKey: string; onReload: () => Promise<void> } = $props();
  const prefix = '/transportation/delivery-exceptions';
  const identity = $derived($auth ? `${$auth.tenant.id}:${$auth.user.id}` : '');
  const storageKey = $derived(`pulsar.delivery-exception.v1:${identity}:${loadId}`);
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE) ?? false,
  );
  const canReadLocations = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ) ?? false,
  );
  const labels: Record<State, string> = {
    OPEN: 'À traiter',
    RETRY_PLANNED: 'Nouvelle tentative',
    RETURN_AUTHORIZED: 'Retour autorisé',
    RETURN_RECEIVED: 'Retour reçu',
    RESOLVED: 'Résolu',
  };
  const kinds: Record<string, string> = {
    DAMAGE: 'Colis endommagé',
    REFUSED: 'Refus du destinataire',
    MISSING: 'Colis manquant',
    ABSENT: 'Destinataire absent',
    OTHER: 'Autre incident',
  };
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let view = $state<View | null>(null),
    packages = $state<Package[]>([]),
    locations = $state<{ id: string; name: string; city: string }[]>([]);
  let loading = $state(true),
    busy = $state(false),
    open = $state(false),
    error = $state(''),
    storageError = $state('');
  let pending = $state<Intent | null>(null),
    selected = $state<Case | null>(null),
    packageId = $state(''),
    kind = $state('ABSENT'),
    target = $state<State>(State.RETRY_PLANNED),
    note = $state(''),
    retry = $state(''),
    returnLocationId = $state(''),
    receivedBy = $state(''),
    search = $state('');
  let generation = 0;
  $effect(() => {
    const key = storageKey,
      revision = refreshKey;
    untrack(() => {
      void revision;
      open = false;
      busy = false;
      selected = null;
      pending = null;
      storageError = '';
      try {
        const saved = sessionStorage.getItem(key);
        if (saved) {
          const value = JSON.parse(saved);
          if (
            !value ||
            typeof value.path !== 'string' ||
            !(
              value.path === prefix ||
              /^\/transportation\/delivery-exceptions\/[A-Za-z0-9_-]+\/transition$/.test(value.path)
            ) ||
            typeof value.body?.operationKey !== 'string'
          )
            throw new Error();
          pending = value;
        }
      } catch {
        storageError = 'Reprise locale indisponible : aucune nouvelle écriture n’est envoyée.';
      }
      void load();
    });
  });
  async function load() {
    const current = ++generation,
      key = storageKey;
    loading = true;
    error = '';
    view = null;
    packages = [];
    open = false;
    if (!identity) {
      loading = false;
      return;
    }
    try {
      const [cases, parcels] = await Promise.all([
        api<View>(`${prefix}?loadId=${encodeURIComponent(loadId)}`),
        api<{ shipments: { packages: Package[] }[] }>(
          `/transportation/delivery-packages?loadId=${encodeURIComponent(loadId)}`,
        ),
      ]);
      if (current !== generation || key !== storageKey) return;
      if (!cases?.load || !Array.isArray(cases.cases) || !Array.isArray(parcels?.shipments))
        throw new Error('Invalid incident view');
      const nextPackages = parcels.shipments.flatMap((s) => {
        if (!Array.isArray(s.packages)) throw new Error('Invalid package view');
        return s.packages;
      });
      view = cases;
      packages = nextPackages;
    } catch (e) {
      if (current === generation && key === storageKey)
        error = e instanceof ApiError ? e.message : 'Incidents indisponibles.';
    } finally {
      if (current === generation && key === storageKey) loading = false;
    }
  }
  function begin(row: Case | null) {
    if (!view || loading || busy || pending || storageError || !canManage) return;
    selected = row;
    note = '';
    retry = '';
    returnLocationId = '';
    receivedBy = '';
    locations = [];
    search = '';
    packageId = '';
    target =
      row?.status === State.RETURN_AUTHORIZED
        ? State.RETURN_RECEIVED
        : row?.status === State.RETRY_PLANNED
          ? State.OPEN
          : State.RETRY_PLANNED;
    open = true;
  }
  async function findLocations() {
    if (!canReadLocations || busy) return;
    const key = storageKey;
    busy = true;
    error = '';
    locations = [];
    returnLocationId = '';
    try {
      const result = await api<{
        items: { id: string; name: string; city: string; isActive: boolean }[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/transportation/locations?search=${encodeURIComponent(search)}&pageSize=50`);
      if (key === storageKey) locations = result.items.filter((location) => location.isActive);
    } catch (e) {
      if (key === storageKey)
        error = e instanceof ApiError ? e.message : 'Recherche des lieux indisponible.';
    } finally {
      if (key === storageKey) busy = false;
    }
  }
  function persist(value: Intent | null) {
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
      pending = value;
      return true;
    } catch {
      storageError = 'Impossible de conserver la demande pour une reprise sûre.';
      return false;
    }
  }
  async function send(intent: Intent) {
    if (!canManage || busy || storageError) return;
    const key = storageKey;
    busy = true;
    error = '';
    try {
      const receipt = await api<unknown>(intent.path, { method: 'POST', body: intent.body });
      if (key !== storageKey) return;
      const result = receipt as Record<string, unknown> | null;
      const existingId = intent.path.match(
        /\/delivery-exceptions\/([A-Za-z0-9_-]+)\/transition$/,
      )?.[1];
      const expectedVersion = existingId ? Number(intent.body.expectedVersion) + 1 : 1;
      if (
        !result ||
        typeof result.id !== 'string' ||
        !result.id ||
        (existingId && result.id !== existingId) ||
        result.operationKey !== String(intent.body.operationKey).toLowerCase() ||
        result.status !== (existingId ? intent.body.target : State.OPEN) ||
        result.version !== expectedVersion
      )
        throw new Error('Receipt mismatch');
      persist(null);
      open = false;
      await onReload();
      if (key !== storageKey) return;
      await load();
    } catch (e) {
      if (key === storageKey)
        error =
          e instanceof ApiError
            ? e.message
            : 'Réponse incertaine : rechargez pour inspecter puis reprenez exactement cette demande.';
    } finally {
      if (key === storageKey) busy = false;
    }
  }
  async function submit() {
    if (!view || !canManage || busy || pending || storageError || !note.trim()) return;
    const p = selected?.package ?? packages.find((p) => p.id === packageId);
    if (!p) return;
    if (
      selected &&
      target === State.RETRY_PLANNED &&
      (!retry || !Number.isFinite(new Date(retry).getTime()))
    ) {
      error = 'Indiquez une date valide.';
      return;
    }
    const body = {
      operationKey: crypto.randomUUID(),
      expectedPackageVersion: p.version,
      expectedLoadUpdatedAt: view.load.updatedAt,
      note: note.trim(),
      ...(selected
        ? {
            expectedVersion: selected.version,
            target,
            ...(target === State.RETRY_PLANNED ? { retryAt: new Date(retry).toISOString() } : {}),
            ...(target === State.RETURN_AUTHORIZED ? { returnLocationId } : {}),
            ...(target === State.RETURN_RECEIVED ? { receivedBy: receivedBy.trim() } : {}),
          }
        : { packageId: p.id, kind }),
    };
    const intent = {
      path: selected ? `${prefix}/${selected.id}/transition` : prefix,
      body,
      summary: selected ? `${p.code} — ${labels[target]}` : `${p.code} — ${kinds[kind]}`,
    };
    if (persist(intent)) await send(intent);
  }
</script>

<Card>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="font-semibold text-ink">Incidents et retours</h2>
      <p class="mt-1 text-xs text-ink-muted">
        Prochain geste explicite · Affichage {userTimeZone.value}
      </p>
    </div>
    {#if canManage}<Button
        variant="secondary"
        disabled={loading ||
          busy ||
          !!pending ||
          !!storageError ||
          !view ||
          !['DISPATCHED', 'IN_TRANSIT', 'COMPLETED'].includes(view.load.status)}
        onclick={() => begin(null)}>Signaler un incident</Button
      >{/if}
  </div>
  {#if error}<div class="mt-3"><ErrorNotice message={error} onretry={load} /></div>{/if}
  {#if storageError}<p role="alert" class="mt-3 text-sm text-danger">{storageError}</p>{/if}
  {#if pending}<div class="my-3 rounded-lg border border-warning/30 p-3">
      <p class="text-sm">
        Demande conservée : {pending.summary}. Inspectez le dossier avant de reprendre.
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onclick={load}>Inspecter</Button><Button
          disabled={busy || !canManage}
          onclick={() => {
            if (pending) void send(pending);
          }}>Reprendre la même demande</Button
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => {
            if (
              window.confirm(
                'Après inspection : abandonner uniquement la reprise locale ? Aucun effet serveur ne sera annulé.',
              )
            )
              persist(null);
          }}>Abandonner la reprise</Button
        >
      </div>
    </div>{/if}
  {#if loading}<Skeleton rows={3} />{:else if view}
    {#if view.truncated}<p class="mt-3 text-sm text-warning">
        200 dossiers les plus récents affichés. L’historique complet reste conservé.
      </p>{/if}
    {#if !view.cases.length}<p class="mt-4 text-sm text-ink-muted">
        Aucun incident déclaré. Un signalement chauffeur apparaîtra ici.
      </p>{:else}<ul class="mt-4 divide-y divide-edge">
        {#each view.cases as row (row.id)}<li class="py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-mono text-sm text-ink">{row.package.code}</span><Badge
                tone={['RESOLVED', 'RETURN_RECEIVED'].includes(row.status) ? 'neutral' : 'warn'}
                >{labels[row.status]}</Badge
              >
            </div>
            <p class="mt-1 text-sm text-ink">{kinds[row.kind]} — {row.note}</p>
            <p class="mt-1 text-xs text-ink-muted">{row.nextAction}</p>
            {#if row.retryAt}<p class="mt-1 text-xs">
                Tentative : {formatDateTime(row.retryAt)}. L’ordre des arrêts n’est pas modifié
                automatiquement.
              </p>{/if}{#if row.returnLocation}<p class="mt-1 text-xs">
                Retour : {row.returnLocation.name}{row.receivedAt
                  ? ` · reçu ${formatDateTime(row.receivedAt)} par ${row.receivedBy}`
                  : ''}
              </p>{/if}
            {#if canManage && ['OPEN', 'RETRY_PLANNED', 'RETURN_AUTHORIZED'].includes(row.status)}<Button
                variant="secondary"
                size="sm"
                class="mt-2"
                disabled={busy || !!pending || !!storageError}
                onclick={() => begin(row)}>Traiter</Button
              >{/if}
            <details class="mt-2 text-xs text-ink-muted">
              <summary class="cursor-pointer">Historique récent</summary>
              <ol class="mt-2 space-y-1">
                {#each row.events as event}<li>
                    {formatDateTime(event.createdAt)} · {event.snapshot.after?.status ??
                      'Événement'} — {event.snapshot.after?.note ?? ''}
                  </li>{/each}
              </ol>
            </details>
          </li>{/each}
      </ul>{/if}
  {/if}
  <p class="mt-4 border-t border-edge pt-3 text-xs text-ink-muted">
    Un retour reçu n’est ni une livraison, ni une remise en stock, ni un remboursement. Ces
    décisions restent séparées dans les modules autorisés.
  </p>
</Card>
<Drawer bind:open title={selected ? `Traiter ${selected.package.code}` : 'Signaler un incident'}>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <fieldset
      disabled={loading || !view || busy || !!pending || !!storageError || !canManage}
      class="space-y-4"
    >
      {#if selected}<Field label="Décision"
          ><select class="case-input" bind:value={target}
            >{#each Object.values(State).filter( (s) => canTransitionDeliveryException(selected!.status, s), ) as state}<option
                value={state}>{labels[state]}</option
              >{/each}</select
          ></Field
        >
      {:else}<Field label="Colis"
          ><select class="case-input" bind:value={packageId} required
            ><option value="">Sélectionner</option
            >{#each packages.filter((p) => !['CANCELLED', 'RETURNED'].includes(p.status) && !view?.cases.some((c) => c.package.id === p.id && ['OPEN', 'RETRY_PLANNED', 'RETURN_AUTHORIZED'].includes(c.status))) as pkg}<option
                value={pkg.id}>{pkg.code} · {pkg.status}</option
              >{/each}</select
          ></Field
        ><Field label="Nature"
          ><select class="case-input" bind:value={kind}
            >{#each Object.entries(kinds) as [key, label]}<option value={key}>{label}</option
              >{/each}</select
          ></Field
        >{/if}
      {#if selected && target === State.RETRY_PLANNED}<Field
          label={`Prochaine tentative — ${browserZone}`}
          ><input class="case-input" type="datetime-local" bind:value={retry} required /></Field
        >
        <p class="text-xs text-ink-muted">
          Plan indicatif sur la tournée en cours. La remise effective sera confirmée séparément,
          avec les contrôles d’arrêt et de POD existants.
        </p>{/if}
      {#if selected && target === State.RETURN_AUTHORIZED}<Field
          label="Rechercher un lieu de retour"
          ><input
            class="case-input"
            bind:value={search}
            maxlength="100"
            placeholder="Nom ou ville"
          /></Field
        ><Button variant="secondary" disabled={!canReadLocations} onclick={findLocations}
          >Rechercher les lieux</Button
        >{#if !canReadLocations}<p class="text-xs text-warning">
            La recherche des lieux exige le droit de lecture des référentiels Transport.
          </p>{/if}<Field label="Lieu de réception"
          ><select class="case-input" bind:value={returnLocationId} required
            ><option value="">Sélectionner un lieu actif</option
            >{#each locations as location}<option value={location.id}
                >{location.name} · {location.city}</option
              >{/each}</select
          ></Field
        >
        <p class="text-xs text-ink-muted">
          Seuls les lieux actifs parmi les 50 premiers résultats sont proposés. Précisez la
          recherche si nécessaire.
        </p>{/if}
      {#if selected && target === State.RETURN_RECEIVED}<p
          class="rounded-md border border-warning/30 p-3 text-sm"
        >
          Confirmer uniquement après réception physique à {selected.returnLocation?.name}. Le colis
          devient « Retourné ». Aucun stock ni avoir ne sera créé.
        </p>
        <Field label="Personne ayant reçu le colis"
          ><input class="case-input" bind:value={receivedBy} maxlength="120" required /></Field
        >{/if}
      <Field label="Constat / justification"
        ><textarea class="case-input" rows="3" maxlength="1000" bind:value={note} required
        ></textarea></Field
      >
      {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
      <Button type="submit" disabled={busy || !note.trim()}
        >Confirmer {selected ? 'la décision' : 'le signalement'}</Button
      >
    </fieldset>
  </form>
</Drawer>

<style>
  .case-input {
    width: 100%;
    border: 1px solid var(--color-edge);
    border-radius: 0.5rem;
    background: var(--color-canvas);
    padding: 0.55rem 0.7rem;
    color: var(--color-ink);
    font-size: 0.875rem;
  }
  .case-input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
