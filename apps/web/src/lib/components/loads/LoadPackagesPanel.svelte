<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PERMISSIONS,
    DeliveryPackageStatus as Status,
    deriveDeliveryPackageCounts,
    validateDeliveryPackageContents,
    normalizeDeliveryPackageLabel,
    canTransitionDeliveryPackage,
    type DeliveryPackageContent,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    Drawer,
    ErrorNotice,
    Field,
    Input,
    Skeleton,
    Textarea,
    type Tone,
  } from '$lib/components/ui';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';

  interface PackageRow {
    id: string;
    code: string;
    label: string;
    status: Status;
    contents: DeliveryPackageContent[];
    version: number;
    loadedAt: string | null;
    deliveredAt: string | null;
    updatedAt: string;
  }
  interface ShipmentRow {
    id: string;
    shipmentNumber: string;
    status: string;
    updatedAt: string;
    packageTrackingEnabledAt: string | null;
    originName: string;
    destinationName: string;
    packages: PackageRow[];
  }
  interface Manifest {
    load: { id: string; loadNumber: string; status: string; updatedAt: string };
    shipments: ShipmentRow[];
  }
  interface Receipt {
    operationKey: string;
    packageId: string;
    version: number;
    status: Status;
    code: string;
  }
  type Intent = {
    kind: 'create' | 'edit' | 'transition';
    loadId: string;
    shipmentId: string;
    packageId: string | null;
    summary: string;
    body: {
      operationKey: string;
      expectedVersion?: number;
      expectedUpdatedAt?: string;
      expectedLoadId?: string;
      expectedLoadUpdatedAt?: string;
      label?: string;
      contents?: DeliveryPackageContent[];
      target?: Status;
      recipientName?: string;
      notes?: string;
    };
  };
  let {
    loadId,
    refreshKey,
    onReload,
  }: {
    loadId: string;
    refreshKey: string;
    onReload: () => Promise<void>;
  } = $props();
  const endpoint = '/transportation/delivery-packages';
  const canRead = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_READ) ?? false,
  );
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE) ?? false,
  );
  const canExecute = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE) ?? false,
  );
  const scope = $derived(`${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}:${loadId}`);
  const storageKey = (value: string) => `pulsar.delivery-packages.pending.v1:${value}`;
  let manifest = $state<Manifest | null>(null),
    loading = $state(true),
    busy = $state(false);
  let error = $state(''),
    mutationError = $state(''),
    storageError = $state('');
  let pending = $state<Intent | null>(null),
    inspected = $state(false);
  let scan = $state(''),
    scanMessage = $state(''),
    selectedId = $state('');
  let drawerOpen = $state(false),
    formShipment = $state<ShipmentRow | null>(null);
  let editing = $state<PackageRow | null>(null),
    delivering = $state<PackageRow | null>(null);
  let label = $state(''),
    lines = $state<DeliveryPackageContent[]>([]),
    recipient = $state(''),
    notes = $state('');
  let generation = 0;
  let formLoad = $state<Manifest['load'] | null>(null);
  let formElement = $state<HTMLFormElement | null>(null);
  const blocked = $derived(busy || loading || !!pending || !!storageError || !!error);
  const allPackages = $derived(manifest?.shipments.flatMap((s) => s.packages) ?? []);
  const totals = $derived(deriveDeliveryPackageCounts(allPackages));
  const names: Record<Status, string> = {
    PREPARED: 'Préparé',
    LOADED: 'Chargé',
    DELIVERED: 'Livré',
    CANCELLED: 'Annulé',
    RETURNED: 'Retourné',
  };
  const tones: Record<Status, Tone> = {
    PREPARED: 'neutral',
    LOADED: 'info',
    DELIVERED: 'ok',
    CANCELLED: 'neutral',
    RETURNED: 'warn',
  };

  function editable(shipment: ShipmentRow) {
    return (
      canManage &&
      ['OPEN', 'PLANNED'].includes(manifest?.load.status ?? '') &&
      ['PENDING', 'PLANNED'].includes(shipment.status)
    );
  }
  function allowed(pkg: PackageRow, shipment: ShipmentRow, target: Status) {
    if (
      !canExecute ||
      !canTransitionDeliveryPackage(pkg.status, target) ||
      ['DELIVERED', 'CANCELLED'].includes(shipment.status)
    )
      return false;
    const status = manifest?.load.status ?? '';
    if (target === Status.LOADED)
      return ['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'].includes(status);
    if (target === Status.PREPARED) return ['PLANNED', 'TENDERED', 'DISPATCHED'].includes(status);
    if (target === Status.DELIVERED)
      return status === 'IN_TRANSIT' && shipment.status === 'IN_TRANSIT';
    return target === Status.CANCELLED && editable(shipment);
  }
  function validIntent(value: unknown): value is Intent {
    if (!value || typeof value !== 'object') return false;
    const v = value as Intent,
      b = v.body;
    if (
      !(
        v.loadId === loadId &&
        ['create', 'edit', 'transition'].includes(v.kind) &&
        typeof v.shipmentId === 'string' &&
        /^[\w-]{1,100}$/.test(v.shipmentId) &&
        (v.kind === 'create'
          ? v.packageId === null
          : typeof v.packageId === 'string' && /^[\w-]{1,100}$/.test(v.packageId)) &&
        !!b &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          b.operationKey,
        ) &&
        (v.kind === 'create'
          ? typeof b.expectedUpdatedAt === 'string'
          : Number.isInteger(b.expectedVersion) && b.expectedVersion! > 0)
      )
    )
      return false;
    if (v.kind === 'transition')
      return (
        b.expectedLoadId === v.loadId &&
        typeof b.expectedLoadUpdatedAt === 'string' &&
        Number.isFinite(Date.parse(b.expectedLoadUpdatedAt)) &&
        Object.values(Status).includes(b.target!) &&
        (b.target !== Status.DELIVERED ||
          (typeof b.recipientName === 'string' && b.recipientName.trim().length > 0))
      );
    try {
      normalizeDeliveryPackageLabel(b.label);
      validateDeliveryPackageContents(b.contents);
      return true;
    } catch {
      return false;
    }
  }
  function restore() {
    pending = null;
    storageError = '';
    inspected = false;
    mutationError = '';
    try {
      const raw = sessionStorage.getItem(storageKey(scope));
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!validIntent(saved)) throw new Error('invalid intent');
      pending = saved;
      mutationError =
        'Une demande conservée attend sa confirmation. Inspectez les colis ou reprenez exactement cette demande.';
    } catch {
      storageError =
        'La demande conservée ne peut pas être relue. Aucune nouvelle écriture n’est autorisée avant vérification.';
    }
  }
  async function reload() {
    const run = ++generation,
      currentScope = scope;
    loading = true;
    error = '';
    try {
      const result = await api<Manifest>(endpoint, { query: { loadId } });
      if (run !== generation || currentScope !== scope) return false;
      if (!result?.load || result.load.id !== loadId || !Array.isArray(result.shipments))
        throw new Error('Invalid manifest');
      manifest = result;
      return true;
    } catch (e) {
      if (run === generation && currentScope === scope)
        error =
          e instanceof ApiError ? e.message : 'Impossible de lire les colis de ce chargement.';
      return false;
    } finally {
      if (run === generation && currentScope === scope) loading = false;
    }
  }
  $effect(() => {
    scope;
    canRead;
    untrack(() => {
      manifest = null;
      drawerOpen = false;
      selectedId = '';
      scanMessage = '';
      restore();
    });
  });
  $effect(() => {
    scope;
    refreshKey;
    if (canRead)
      untrack(() => {
        void reload();
      });
  });
  function selectScan() {
    const code = scan.trim();
    const matches = allPackages.filter((p) => p.code === code);
    selectedId = matches.length === 1 ? matches[0].id : '';
    scanMessage =
      matches.length === 1
        ? `${code} sélectionné. Choisissez une action puis confirmez.`
        : 'Code exact introuvable dans ce chargement. Aucun colis modifié.';
    if (selectedId)
      document
        .getElementById(`delivery-package-${selectedId}`)
        ?.scrollIntoView({ block: 'nearest' });
  }
  function openEditor(shipment: ShipmentRow, pkg: PackageRow | null = null) {
    if (blocked || !editable(shipment) || (pkg && pkg.status !== Status.PREPARED)) return;
    formShipment = structuredClone($state.snapshot(shipment));
    formLoad = manifest ? { ...manifest.load } : null;
    editing = pkg ? structuredClone($state.snapshot(pkg)) : null;
    delivering = null;
    label = pkg?.label ?? '';
    lines = pkg
      ? pkg.contents.map((line) => ({ ...line }))
      : [{ reference: '', description: '', quantity: '1', unit: '' }];
    mutationError = '';
    drawerOpen = true;
  }
  function openDelivery(pkg: PackageRow, shipment: ShipmentRow) {
    if (blocked || !allowed(pkg, shipment, Status.DELIVERED)) return;
    formShipment = structuredClone($state.snapshot(shipment));
    formLoad = manifest ? { ...manifest.load } : null;
    delivering = structuredClone($state.snapshot(pkg));
    editing = null;
    recipient = '';
    notes = '';
    mutationError = '';
    drawerOpen = true;
  }
  async function submit(intent: Intent) {
    if (blocked) return;
    const currentScope = scope;
    if (
      !(await confirmAction(intent.summary, {
        title: 'Confirmer le colis',
        confirmLabel: 'Confirmer',
        dangerous: intent.body.target === Status.CANCELLED,
      }))
    )
      return;
    if (currentScope !== scope || blocked) return;
    try {
      // Persist before sending, and freeze the exact version, body and key for retries.
      const saved = JSON.parse(JSON.stringify(intent)) as Intent;
      sessionStorage.setItem(storageKey(currentScope), JSON.stringify(saved));
      pending = saved;
      inspected = false;
    } catch {
      mutationError =
        'La demande ne peut pas être conservée dans ce navigateur. Aucun envoi effectué.';
      return;
    }
    await sendPending();
  }
  async function sendPending() {
    const intent = pending,
      currentScope = scope;
    if (
      !intent ||
      busy ||
      !canRead ||
      (intent.kind === 'transition'
        ? !canExecute || (intent.body.target === Status.CANCELLED && !canManage)
        : !canManage)
    )
      return;
    busy = true;
    mutationError = '';
    const path =
      intent.kind === 'create'
        ? `${endpoint}/shipment/${encodeURIComponent(intent.shipmentId)}`
        : `${endpoint}/${encodeURIComponent(intent.packageId!)}${intent.kind === 'transition' ? '/transition' : ''}`;
    try {
      const receipt = await api<Receipt>(path, {
        method: intent.kind === 'edit' ? 'PATCH' : 'POST',
        body: intent.body,
      });
      if (
        !receipt ||
        receipt.operationKey !== intent.body.operationKey ||
        !receipt.packageId ||
        !Number.isInteger(receipt.version) ||
        receipt.version < 1 ||
        !Object.values(Status).includes(receipt.status) ||
        (intent.packageId !== null && receipt.packageId !== intent.packageId)
      )
        throw new Error('Accusé de réception non vérifiable');
      sessionStorage.removeItem(storageKey(currentScope));
      if (currentScope !== scope) return;
      pending = null;
      drawerOpen = false;
      selectedId = receipt.packageId;
      toast.success(`Colis ${receipt.code} · ${names[receipt.status] ?? receipt.status}`);
    } catch (e) {
      if (currentScope !== scope) return;
      const rejected = e instanceof ApiError && [400, 404, 409, 422].includes(e.statusCode);
      if (rejected) {
        sessionStorage.removeItem(storageKey(currentScope));
        pending = null;
        if ([404, 409].includes(e.statusCode)) drawerOpen = false;
        mutationError = `${e.message} Relisez les colis avant de recommencer.`;
      } else {
        inspected = false;
        mutationError =
          'Réponse incertaine : le colis a peut-être été modifié. La clé et le contenu sont conservés ; aucun renvoi automatique.';
      }
    } finally {
      busy = false;
    }
    if (currentScope === scope && !pending) {
      busy = true;
      try {
        await onReload();
        await reload();
      } finally {
        busy = false;
      }
    }
  }
  async function inspect() {
    drawerOpen = false;
    inspected = await reload();
  }
  async function acknowledgeInspection() {
    if (!inspected || busy) return;
    const currentScope = scope;
    if (
      !(await confirmAction(
        'Confirmez avoir vérifié l’état et le contenu des colis. Cette action oublie uniquement la demande locale ; elle n’annule aucune opération enregistrée.',
        { title: 'Terminer la vérification', confirmLabel: 'État vérifié', dangerous: false },
      ))
    )
      return;
    if (scope !== currentScope || busy) return;
    try {
      sessionStorage.removeItem(storageKey(scope));
      pending = null;
      storageError = '';
      mutationError = '';
    } catch {
      storageError = 'Impossible d’effacer la demande locale. Les écritures restent bloquées.';
    }
  }
  async function saveForm() {
    if (!formShipment || !formLoad || blocked) return;
    if (delivering) {
      if (!recipient.trim()) {
        mutationError = 'Le nom du destinataire est obligatoire.';
        return;
      }
      await submit({
        kind: 'transition',
        loadId,
        shipmentId: formShipment.id,
        packageId: delivering.id,
        summary: `Confirmer la remise du colis ${delivering.code} à ${recipient.trim()} ? Les autres colis restent inchangés.`,
        body: {
          operationKey: crypto.randomUUID(),
          expectedVersion: delivering.version,
          expectedLoadId: formLoad.id,
          expectedLoadUpdatedAt: formLoad.updatedAt,
          target: Status.DELIVERED,
          recipientName: recipient.trim(),
          notes: notes.trim(),
        },
      });
      return;
    }
    let contents: DeliveryPackageContent[], normalizedLabel: string;
    try {
      contents = validateDeliveryPackageContents($state.snapshot(lines));
      normalizedLabel = normalizeDeliveryPackageLabel(label);
    } catch (e) {
      mutationError = e instanceof Error ? e.message : 'Contenu invalide.';
      return;
    }
    await submit({
      kind: editing ? 'edit' : 'create',
      loadId,
      shipmentId: formShipment.id,
      packageId: editing?.id ?? null,
      summary: `${editing ? `Modifier ${editing.code}` : 'Créer ce colis'} pour ${formShipment.shipmentNumber} avec ${contents.length} ligne(s) de contenu ? ${!editing && !formShipment.packageTrackingEnabledAt ? 'Le suivi par colis sera activé définitivement : déclarez tous les colis avant d’engager le chargement. ' : ''}Aucun stock WMS n’est modifié.`,
      body: {
        operationKey: crypto.randomUUID(),
        ...(editing
          ? { expectedVersion: editing.version }
          : { expectedUpdatedAt: formShipment.updatedAt }),
        label: normalizedLabel,
        contents,
      },
    });
  }
  async function transition(pkg: PackageRow, shipment: ShipmentRow, target: Status) {
    if (blocked || !manifest || !allowed(pkg, shipment, target)) return;
    await submit({
      kind: 'transition',
      loadId,
      shipmentId: shipment.id,
      packageId: pkg.id,
      summary: `${target === Status.LOADED ? 'Confirmer le chargement physique de' : target === Status.PREPARED ? 'Retirer du camion et remettre en préparation' : 'Annuler'} ${pkg.code} ? Cette action concerne uniquement ce colis.`,
      body: {
        operationKey: crypto.randomUUID(),
        expectedVersion: pkg.version,
        expectedLoadId: manifest.load.id,
        expectedLoadUpdatedAt: manifest.load.updatedAt,
        target,
      },
    });
  }
</script>

{#if canRead}
  <Card>
    <section aria-label="Manifeste de colis" class="min-w-0 space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-ink">Colis et contenu</h2>
          <p class="mt-1 max-w-prose text-xs text-ink-muted">
            Préparer, charger et remettre chaque colis. Le suivi du camion ne prouve pas son
            contenu.
          </p>
        </div>
        <Button
          variant="ghost"
          disabled={busy || loading}
          onclick={() => {
            void reload();
          }}>Actualiser les colis</Button
        >
      </div>
      {#if error}<ErrorNotice
          message={error}
          onretry={async () => {
            await reload();
          }}
        />{/if}
      {#if mutationError && !drawerOpen}<p role="alert" class="text-sm text-danger">
          {mutationError}
        </p>{/if}
      {#if pending || storageError}<div
          class="space-y-3 rounded-md border border-warn/30 bg-warn-soft p-3"
          role="status"
        >
          <p class="text-sm text-ink">{storageError || pending?.summary}</p>
          {#if pending}<p class="break-all font-mono text-xs text-ink-muted">
              Clé : {pending.body.operationKey}
            </p>{/if}
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || loading} onclick={inspect}
              >Inspecter l’état actuel</Button
            >
            {#if pending}<Button
                variant="secondary"
                disabled={busy ||
                  loading ||
                  (pending.kind === 'transition'
                    ? !canExecute || (pending.body.target === Status.CANCELLED && !canManage)
                    : !canManage)}
                onclick={sendPending}>Reprendre la même demande</Button
              >{/if}
            {#if inspected}<Button variant="ghost" disabled={busy} onclick={acknowledgeInspection}
                >J’ai vérifié l’état</Button
              >{/if}
          </div>
        </div>{/if}
      {#if loading && !manifest}<Skeleton rows={4} />{:else if manifest}
        <div
          class="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-surface-muted px-3 py-2 text-sm tabular-nums"
          aria-label="Bilan des colis"
        >
          <span><strong>{totals.active}</strong> colis actifs</span><span
            ><strong>{totals.loaded}</strong> chargés</span
          ><span><strong>{totals.delivered}</strong> livrés</span>
        </div>
        <form
          class="flex items-end gap-2"
          onsubmit={(e) => {
            e.preventDefault();
            selectScan();
          }}
        >
          <div class="min-w-0 flex-1">
            <Field label="Scanner ou saisir le code exact"
              ><Input
                aria-label="Scanner ou saisir le code exact"
                bind:value={scan}
                placeholder="Code du colis"
                disabled={loading}
              /></Field
            >
          </div>
          <Button type="submit" variant="secondary" disabled={!scan.trim() || loading}
            >Repérer</Button
          >
        </form>
        <p class="text-xs text-ink-muted" role="status">
          {scanMessage ||
            'Le scan sélectionne le colis, sans le charger ni le livrer automatiquement.'}
        </p>
        {#if !manifest.shipments.length}<p class="py-4 text-sm text-ink-muted">
            Affectez une expédition au chargement pour préparer ses colis.
          </p>{/if}
        {#each manifest.shipments as shipment (shipment.id)}
          {@const count = deriveDeliveryPackageCounts(shipment.packages)}
          <section
            class="space-y-3 border-t border-edge pt-4"
            aria-label={`Colis de ${shipment.shipmentNumber}`}
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 class="text-sm font-semibold text-ink">{shipment.shipmentNumber}</h3>
                <p class="mt-1 break-words text-xs text-ink-muted">
                  {shipment.originName} → {shipment.destinationName}
                </p>
                <p class="mt-1 text-xs tabular-nums text-ink-muted">
                  {count.delivered} / {count.active} colis livrés · {count.loaded} chargés{count.delivered >
                    0 && count.delivered < count.active
                    ? ' · Livraison partielle'
                    : ''}
                </p>
              </div>
              {#if editable(shipment)}<Button
                  variant="secondary"
                  disabled={blocked}
                  onclick={() => openEditor(shipment)}
                  >Ajouter un colis à {shipment.shipmentNumber}</Button
                >{/if}
            </div>
            {#if !shipment.packages.length}<p
                class="rounded-md bg-surface-muted p-3 text-sm text-ink-muted"
              >
                {shipment.packageTrackingEnabledAt
                  ? 'Aucun colis enregistré pour cette expédition.'
                  : 'Suivi par colis non activé. Le premier colis l’active définitivement : déclarez tous les colis avant d’engager le chargement.'}
              </p>{/if}
            {#each shipment.packages as pkg (pkg.id)}
              <article
                id={`delivery-package-${pkg.id}`}
                class="package-row min-w-0 rounded-md border border-edge p-3"
                class:package-selected={selectedId === pkg.id}
                aria-label={`Colis ${pkg.code}`}
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="break-all font-mono text-xs font-medium text-ink-muted">
                      {pkg.code}{selectedId === pkg.id ? ' · Sélectionné' : ''}
                    </p>
                    <h4 class="mt-1 break-words text-sm font-semibold text-ink">
                      {pkg.label || 'Colis sans libellé'}
                    </h4>
                  </div>
                  <Badge tone={tones[pkg.status]}>{names[pkg.status]}</Badge>
                </div>
                <ul class="my-3 space-y-2" aria-label={`Contenu de ${pkg.code}`}>
                  {#each pkg.contents as line, index (index)}<li
                      class="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"
                    >
                      <span class="min-w-0 break-words text-ink"
                        >{line.reference} · {line.description}</span
                      ><span class="shrink-0 font-mono text-xs text-ink-muted"
                        >{line.quantity} {line.unit}</span
                      >
                    </li>{/each}
                </ul>
                {#if pkg.loadedAt || pkg.deliveredAt}<p class="mb-2 text-xs text-ink-muted">
                    {pkg.deliveredAt
                      ? `Livré le ${formatDateTime(pkg.deliveredAt)}`
                      : `Chargé le ${formatDateTime(pkg.loadedAt)}`}
                  </p>{/if}
                <div class="flex flex-wrap gap-2">
                  {#if editable(shipment) && pkg.status === Status.PREPARED}<Button
                      variant="ghost"
                      disabled={blocked}
                      onclick={() => openEditor(shipment, pkg)}>Modifier {pkg.code}</Button
                    >{/if}
                  {#if allowed(pkg, shipment, Status.LOADED)}<Button
                      variant="secondary"
                      disabled={blocked}
                      onclick={() => transition(pkg, shipment, Status.LOADED)}
                      >Charger {pkg.code}</Button
                    >{/if}
                  {#if allowed(pkg, shipment, Status.PREPARED)}<Button
                      variant="ghost"
                      disabled={blocked}
                      onclick={() => transition(pkg, shipment, Status.PREPARED)}
                      >Retirer du camion {pkg.code}</Button
                    >{/if}
                  {#if allowed(pkg, shipment, Status.DELIVERED)}<Button
                      variant="secondary"
                      disabled={blocked}
                      onclick={() => openDelivery(pkg, shipment)}>Livrer {pkg.code}</Button
                    >{/if}
                  {#if allowed(pkg, shipment, Status.CANCELLED)}<Button
                      variant="ghost"
                      disabled={blocked}
                      onclick={() => transition(pkg, shipment, Status.CANCELLED)}
                      >Annuler {pkg.code}</Button
                    >{/if}
                </div>
              </article>
            {/each}
          </section>
        {/each}
        <p class="border-t border-edge pt-3 text-xs text-ink-muted">
          Les quantités restent détaillées par article et unité. Ces déclarations ne déplacent aucun
          stock WMS et ne constituent pas une signature électronique.
        </p>
      {/if}
    </section>
  </Card>
{/if}

<Drawer
  bind:open={drawerOpen}
  title={delivering
    ? `Remettre ${delivering.code}`
    : editing
      ? `Modifier ${editing.code}`
      : 'Préparer un colis'}
  width="lg"
  dismissible={!busy}
>
  <form
    id="delivery-package-form"
    bind:this={formElement}
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void saveForm();
    }}
  >
    <p class="text-sm text-ink-muted">
      {formShipment?.shipmentNumber} · {formShipment?.destinationName}
    </p>
    {#if mutationError}<p role="alert" class="text-sm text-danger">{mutationError}</p>{/if}
    {#if pending}<p class="text-sm text-warn">
        Fermez ce panneau pour inspecter l’état ou reprendre la demande conservée.
      </p>{/if}
    <fieldset disabled={busy || !!pending || !!storageError} class="min-w-0 space-y-4">
      {#if delivering}
        <p class="text-sm text-ink">
          Vous confirmez la remise physique de ce colis uniquement. Sur une tournée planifiée,
          l’arrivée à l’arrêt de livraison doit d’abord être déclarée.
        </p>
        <Field label="Nom du destinataire"
          ><Input
            aria-label="Nom du destinataire"
            required
            maxlength={120}
            bind:value={recipient}
          /></Field
        >
        <Field label="Notes de remise (facultatif)"
          ><Textarea
            aria-label="Notes de remise (facultatif)"
            maxlength={1000}
            bind:value={notes}
          /></Field
        >
      {:else}
        {#if !editing && !formShipment?.packageTrackingEnabledAt}<p
            class="rounded-md bg-warn-soft p-3 text-sm text-ink"
          >
            Le premier colis active définitivement le suivi de cette expédition. Déclarez tous ses
            colis avant d’engager le chargement.
          </p>{/if}
        <Field label="Libellé du colis (facultatif)"
          ><Input
            aria-label="Libellé du colis (facultatif)"
            maxlength={120}
            bind:value={label}
            placeholder="Ex. Caisse de pièces – assemblage 4"
          /></Field
        >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Contenu déclaré</h3>
          <Button
            variant="secondary"
            disabled={lines.length >= 50}
            onclick={() => {
              lines = [...lines, { reference: '', description: '', quantity: '1', unit: '' }];
            }}>Ajouter une ligne</Button
          >
        </div>
        {#each lines as line, index (index)}<section
            class="min-w-0 space-y-3 rounded-md border border-edge p-3"
            aria-label={`Ligne de contenu ${index + 1}`}
          >
            <div class="flex items-center justify-between">
              <h4 class="text-xs font-medium text-ink-muted">Ligne {index + 1}</h4>
              <Button
                variant="ghost"
                disabled={lines.length === 1}
                aria-label={`Retirer la ligne ${index + 1}`}
                onclick={() => {
                  lines = lines.filter((_, i) => i !== index);
                }}>Retirer</Button
              >
            </div>
            <Field label={`Référence ${index + 1}`}
              ><Input
                aria-label={`Référence ${index + 1}`}
                required
                maxlength={80}
                bind:value={line.reference}
              /></Field
            >
            <Field label={`Description ${index + 1}`}
              ><Input
                aria-label={`Description ${index + 1}`}
                required
                maxlength={200}
                bind:value={line.description}
              /></Field
            >
            <div class="grid min-w-0 grid-cols-2 gap-3">
              <Field label={`Quantité ${index + 1}`}
                ><Input
                  aria-label={`Quantité ${index + 1}`}
                  required
                  inputmode="decimal"
                  maxlength={16}
                  bind:value={line.quantity}
                /></Field
              ><Field label={`Unité ${index + 1}`}
                ><Input
                  aria-label={`Unité ${index + 1}`}
                  required
                  maxlength={20}
                  placeholder="pièce, kg…"
                  bind:value={line.unit}
                /></Field
              >
            </div>
          </section>{/each}
        <p class="text-xs text-ink-muted">
          Utilisez un point et au plus trois décimales. Les références décrivent le contenu ; aucun
          rapprochement automatique avec un article WMS.
        </p>
      {/if}
    </fieldset>
  </form>
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        drawerOpen = false;
      }}>Fermer</Button
    ><Button loading={busy} disabled={blocked} onclick={() => formElement?.requestSubmit()}
      >{delivering
        ? 'Confirmer la remise'
        : editing
          ? 'Enregistrer le colis'
          : 'Créer le colis'}</Button
    >
  {/snippet}
</Drawer>

<style>
  .package-row {
    scroll-margin: 6rem;
  }
  .package-selected {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }
</style>
