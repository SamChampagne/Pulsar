<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PERMISSIONS,
    type DeliveryManifestAddress,
    type DeliveryManifestPreview,
    type DeliveryManifestRecord,
    type DeliveryManifestSummary,
    type DeliveryManifestFileKind,
    type Paginated,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth, getAccessToken } from '$lib/stores/auth';
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
    Skeleton,
    Textarea,
    labelFor,
  } from '$lib/components/ui';

  let { loadId, refreshKey }: { loadId: string; refreshKey: string } = $props();
  type Intent = {
    loadId: string;
    body: {
      operationKey: string;
      sourceHash: string;
      expectedLoadUpdatedAt: string;
      reason: string;
    };
  };
  const endpoint = $derived(`/transportation/loads/${encodeURIComponent(loadId)}/manifests`);
  const scope = $derived(`${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}:${loadId}`);
  const canRead = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_READ) ?? false,
  );
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE) ?? false,
  );
  const key = (value: string) => `pulsar.delivery-manifests.pending.v1:${value}`;
  let items = $state<DeliveryManifestSummary[]>([]),
    total = $state(0),
    page = $state(1);
  let loading = $state(true),
    busy = $state(false),
    detailLoading = $state(false),
    drawerOpen = $state(false);
  let error = $state(''),
    actionError = $state(''),
    storageError = $state(''),
    reason = $state('');
  let preview = $state<DeliveryManifestPreview | null>(null),
    selected = $state<DeliveryManifestRecord | null>(null);
  let pending = $state<Intent | null>(null),
    inspected = $state(false);
  let listGeneration = 0,
    detailGeneration = 0;
  const snapshot = $derived(selected?.snapshot ?? preview?.snapshot ?? null);
  const packageCount = $derived(
    snapshot?.shipments.reduce((n, shipment) => n + shipment.packages.length, 0) ?? 0,
  );
  const activePackageCount = $derived(
    snapshot?.shipments.reduce(
      (n, shipment) => n + shipment.packages.filter((p) => p.status !== 'CANCELLED').length,
      0,
    ) ?? 0,
  );
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const hash = /^[0-9a-f]{64}$/;
  const names = { PREPARED: 'Préparé', LOADED: 'Chargé', DELIVERED: 'Livré', CANCELLED: 'Annulé', RETURNED: 'Retourné' };
  function addressLines(value: DeliveryManifestAddress) {
    return [
      value.addressLine1,
      value.addressLine2,
      [value.city, value.province, value.postalCode].filter(Boolean).join(' · '),
      value.country,
    ].filter(Boolean);
  }
  function restore() {
    pending = null;
    storageError = '';
    inspected = false;
    actionError = '';
    try {
      const raw = sessionStorage.getItem(key(scope));
      if (!raw) return;
      const value = JSON.parse(raw) as Intent;
      if (
        !value ||
        value.loadId !== loadId ||
        !value.body ||
        !uuid.test(value.body.operationKey) ||
        !hash.test(value.body.sourceHash) ||
        !Number.isFinite(Date.parse(value.body.expectedLoadUpdatedAt)) ||
        typeof value.body.reason !== 'string' ||
        !value.body.reason.trim() ||
        value.body.reason.length > 300 ||
        Object.keys(value).some((k) => !['loadId', 'body'].includes(k)) ||
        Object.keys(value.body).some(
          (k) => !['operationKey', 'sourceHash', 'expectedLoadUpdatedAt', 'reason'].includes(k),
        )
      )
        throw new Error('Invalid request');
      pending = value;
      actionError =
        'Une émission attend sa confirmation. Consultez les archives ou reprenez exactement la demande conservée.';
    } catch {
      storageError =
        'Impossible de relire la demande conservée. Vérifiez les archives avant toute nouvelle émission.';
    }
  }
  async function reload() {
    const generation = ++listGeneration,
      currentScope = scope;
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<DeliveryManifestSummary>>(endpoint, {
        query: { page, pageSize: 5 },
      });
      if (generation !== listGeneration || currentScope !== scope) return false;
      if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total))
        throw new Error('Invalid history');
      items = result.items;
      total = result.total;
      return true;
    } catch (e) {
      if (generation === listGeneration && currentScope === scope)
        error = e instanceof ApiError ? e.message : 'Historique des manifestes indisponible.';
      return false;
    } finally {
      if (generation === listGeneration && currentScope === scope) loading = false;
    }
  }
  $effect(() => {
    scope;
    untrack(() => {
      page = 1;
      items = [];
      total = 0;
      drawerOpen = false;
      preview = null;
      selected = null;
      busy = false;
      detailLoading = false;
      ++detailGeneration;
      restore();
    });
  });
  $effect(() => {
    scope;
    refreshKey;
    page;
    if (canRead)
      untrack(() => {
        void reload();
      });
  });

  async function openPreview() {
    if (!canManage || busy || loading || error || pending || storageError) return;
    const generation = ++detailGeneration,
      currentScope = scope;
    selected = null;
    preview = null;
    reason = '';
    actionError = '';
    drawerOpen = true;
    detailLoading = true;
    try {
      const result = await api<DeliveryManifestPreview>(`${endpoint}/preview`);
      if (generation === detailGeneration && currentScope === scope) preview = result;
    } catch (e) {
      if (generation === detailGeneration && currentScope === scope)
        actionError =
          e instanceof ApiError ? e.message : 'Aperçu indisponible. Aucun manifeste émis.';
    } finally {
      if (generation === detailGeneration && currentScope === scope) detailLoading = false;
    }
  }
  async function openRecord(id: string) {
    if (busy) return;
    const generation = ++detailGeneration,
      currentScope = scope;
    preview = null;
    selected = null;
    actionError = '';
    drawerOpen = true;
    detailLoading = true;
    try {
      const result = await api<DeliveryManifestRecord>(`${endpoint}/${encodeURIComponent(id)}`);
      if (generation === detailGeneration && currentScope === scope) selected = result;
    } catch (e) {
      if (generation === detailGeneration && currentScope === scope)
        actionError = e instanceof ApiError ? e.message : 'Édition indisponible.';
    } finally {
      if (generation === detailGeneration && currentScope === scope) detailLoading = false;
    }
  }
  async function issue() {
    if (
      !preview?.canIssue ||
      !canManage ||
      busy ||
      error ||
      pending ||
      storageError ||
      !reason.trim() ||
      reason.trim().length > 300
    )
      return;
    const intent: Intent = {
      loadId,
      body: {
        operationKey: crypto.randomUUID(),
        sourceHash: preview.sourceHash,
        expectedLoadUpdatedAt: preview.snapshot.load.updatedAt,
        reason: reason.trim(),
      },
    };
    const currentScope = scope;
    if (
      !(await confirmAction(
        'Figer cette édition et son contenu ? Les éditions précédentes sont conservées. Aucun colis, stock ou statut de livraison ne sera modifié.',
        { title: 'Émettre le manifeste', confirmLabel: 'Émettre', dangerous: false },
      ))
    )
      return;
    if (currentScope !== scope || busy || pending) return;
    try {
      sessionStorage.setItem(key(currentScope), JSON.stringify(intent));
      pending = intent;
      inspected = false;
    } catch {
      actionError = 'La demande ne peut pas être conservée. Aucun envoi effectué.';
      return;
    }
    await sendPending();
  }
  async function sendPending() {
    if (!pending || busy || !canManage) return;
    const intent = $state.snapshot(pending),
      currentScope = scope,
      path = endpoint;
    busy = true;
    actionError = '';
    try {
      const result = await api<DeliveryManifestRecord>(path, { method: 'POST', body: intent.body });
      if (
        !result?.id ||
        result.sourceHash !== intent.body.sourceHash ||
        !hash.test(result.snapshotHash) ||
        !Number.isInteger(result.revision) ||
        result.revision < 1
      )
        throw new Error('Invalid receipt');
      sessionStorage.removeItem(key(currentScope));
      if (currentScope !== scope) return;
      pending = null;
      preview = null;
      selected = result;
      drawerOpen = true;
      toast.success(`Manifeste ${result.number} émis`);
      if (page !== 1) page = 1;
      else await reload();
    } catch (e) {
      if (currentScope !== scope) return;
      if (e instanceof ApiError && [400, 404, 422].includes(e.statusCode)) {
        try {
          sessionStorage.removeItem(key(currentScope));
          pending = null;
        } catch {
          storageError = 'Impossible de libérer la demande locale.';
        }
        preview = null;
        actionError = `${e.message} Actualisez l’aperçu avant une nouvelle émission.`;
      } else {
        inspected = false;
        actionError =
          e instanceof ApiError && e.statusCode === 409
            ? `${e.message} Une émission concurrente est possible. Vérifiez les archives ou reprenez la même demande avant de préparer un nouvel aperçu.`
            : 'Réponse incertaine : le manifeste a peut-être été émis. La demande exacte est conservée; aucun renvoi automatique.';
      }
    } finally {
      if (currentScope === scope) busy = false;
    }
  }
  async function inspect() {
    drawerOpen = false;
    inspected = await reload();
  }
  async function acknowledge() {
    if (!inspected || busy) return;
    const currentScope = scope;
    if (
      !(await confirmAction(
        'Confirmez avoir vérifié les éditions et leur motif dans les archives. Oublier la demande locale n’annule aucun manifeste émis.',
        { title: 'Archives vérifiées', confirmLabel: 'Terminer la vérification', dangerous: false },
      ))
    )
      return;
    if (currentScope !== scope) return;
    try {
      sessionStorage.removeItem(key(currentScope));
      pending = null;
      storageError = '';
      actionError = '';
      preview = null;
    } catch {
      storageError = 'Impossible de libérer la demande locale.';
    }
  }
  async function file(
    record: DeliveryManifestSummary,
    kind: DeliveryManifestFileKind,
    prepare: boolean,
  ) {
    if (busy || (prepare && !canManage)) return;
    const currentScope = scope;
    const path = `${endpoint}/${encodeURIComponent(record.id)}/files/${kind}`;
    busy = true;
    actionError = '';
    try {
      if (prepare) {
        const ready = await api<{ ready: boolean }>(path, { method: 'POST' });
        if (ready?.ready !== true) throw new Error('Fichier non confirmé');
      }
      if (currentScope !== scope) return;
      // Same authenticated blob-download pattern as api/files, through this document's protected route.
      const token = getAccessToken();
      const response = await fetch(`/api/v1${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new ApiError(response.status, payload?.message ?? 'Téléchargement indisponible.');
      }
      const blob = await response.blob();
      if (currentScope !== scope) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${record.number}-${kind === 'labels' ? 'etiquettes' : 'manifeste'}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      if (currentScope === scope)
        actionError =
          e instanceof ApiError && e.statusCode === 404
            ? 'Ce fichier n’est pas encore disponible. Un utilisateur avec le droit de planification peut le préparer depuis cette édition.'
            : `${e instanceof Error ? e.message : 'Fichier indisponible.'} Vous pouvez vérifier le téléchargement de cette même édition; aucune nouvelle édition n’est nécessaire.`;
    } finally {
      if (currentScope === scope) busy = false;
    }
  }
</script>

{#if canRead}
  <Card>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink">Manifestes et étiquettes</h2>
        <p class="mt-1 max-w-prose text-xs text-ink-muted">
          Une édition figée de la tournée et de ses colis. Réimprimer conserve la même preuve; ce
          document ne confirme pas le chargement.
        </p>
      </div>
      {#if canManage}<Button
          variant="secondary"
          onclick={openPreview}
          disabled={busy || loading || !!error || !!pending || !!storageError}
          >{total ? 'Nouvelle édition' : 'Préparer un manifeste'}</Button
        >{/if}
    </div>
    {#if pending || storageError}
      <div class="mt-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm" role="status">
        <p>{storageError || 'Demande conservée : émission à vérifier avant de poursuivre.'}</p>
        {#if pending}<p class="mt-1 text-xs break-words">Motif : {pending.body.reason}</p>{/if}
        <div class="mt-2 flex flex-wrap gap-2">
          {#if pending && canManage}<Button
              variant="secondary"
              onclick={sendPending}
              disabled={busy}>Reprendre la même demande</Button
            >{/if}
          <Button variant="ghost" onclick={inspect} disabled={busy}>Vérifier les archives</Button>
          {#if inspected}<Button variant="ghost" onclick={acknowledge} disabled={busy}
              >Terminer la vérification</Button
            >{/if}
        </div>
      </div>
    {/if}
    {#if actionError && !drawerOpen}<div class="mt-3">
        <ErrorNotice message={actionError} />
      </div>{/if}
    {#if loading}<div class="mt-4"><Skeleton rows={3} /></div>
    {:else if error}<div class="mt-4">
        <ErrorNotice
          message={error}
          onretry={() => {
            void reload();
          }}
        />
      </div>
    {:else if !items.length}<p class="mt-4 rounded-md bg-surface-muted p-4 text-sm text-ink-muted">
        Aucun manifeste émis. Préparez les colis, vérifiez les adresses, puis capturez une première
        édition.
      </p>
    {:else}
      <ol class="mt-4 divide-y divide-edge-soft">
        {#each items as record (record.id)}
          <li class="py-3 first:pt-0 last:pb-0">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-sm font-medium tabular-nums">{record.number}</span
                  ><Badge tone="neutral">Édition {record.revision}</Badge>
                </div>
                <p class="mt-1 text-xs text-ink-muted">{formatDateTime(record.issuedAt)}</p>
                <p class="mt-1 break-words text-sm">{record.reason}</p>
              </div>
              <Button variant="ghost" onclick={() => openRecord(record.id)} disabled={busy}
                >Consulter</Button
              >
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onclick={() => file(record, 'manifest', canManage)}
                disabled={busy}>PDF manifeste</Button
              >
              <Button
                variant="secondary"
                onclick={() => file(record, 'labels', canManage)}
                disabled={busy}>PDF étiquettes</Button
              >
            </div>
          </li>
        {/each}
      </ol>
      {#if total > 5}<nav
          aria-label="Pages des manifestes"
          class="mt-4 flex items-center justify-between gap-2 text-xs text-ink-muted"
        >
          <Button
            variant="ghost"
            disabled={page <= 1 || busy}
            onclick={() => {
              page--;
            }}>Précédent</Button
          ><span>Page {page} sur {Math.ceil(total / 5)} · {total} éditions</span><Button
            variant="ghost"
            disabled={page * 5 >= total || busy}
            onclick={() => {
              page++;
            }}>Suivant</Button
          >
        </nav>{/if}
    {/if}
  </Card>

  <Drawer
    bind:open={drawerOpen}
    title={selected ? `${selected.number} · édition ${selected.revision}` : 'Aperçu du manifeste'}
    width="xl"
    dismissible={!busy}
  >
    {#if detailLoading}<Skeleton rows={5} />
    {:else}
      {#if actionError}<div class="mb-4">
          <ErrorNotice message={actionError} />
        </div>{/if}
      {#if !snapshot && !pending && canManage}<Button
          variant="secondary"
          onclick={openPreview}
          disabled={busy}>Actualiser l’aperçu</Button
        >{/if}
      {#if snapshot}
        <div class="space-y-5">
          <section class="rounded-md bg-surface-muted p-4" aria-label="Résumé de l’édition">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-semibold">{snapshot.load.loadNumber}</h3>
              <Badge tone="neutral">{selected ? 'Édition figée' : 'Aperçu non émis'}</Badge>
            </div>
            <p class="mt-2 text-sm tabular-nums">
              {snapshot.shipments.length} expéditions · {packageCount} colis déclarés · {activePackageCount}
              étiquettes
            </p>
            <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt class="text-ink-muted">Véhicule / remorque</dt>
                <dd>
                  {snapshot.load.vehicleNumber ?? 'Non affecté'} / {snapshot.load.trailerNumber ??
                    'Non affectée'}
                </dd>
              </div>
              <div>
                <dt class="text-ink-muted">Chauffeur / transporteur</dt>
                <dd>
                  {snapshot.load.driverName ?? 'Non affecté'} / {snapshot.load.carrierName ??
                    'Non affecté'}
                </dd>
              </div>
            </dl>
            <p class="mt-3 text-xs text-ink-muted">
              {selected
                ? `Émis le ${formatDateTime(selected.issuedAt)}`
                : `Version du chargement : ${formatDateTime(snapshot.load.updatedAt)}`}
            </p>
            {#if selected}<p class="mt-2 text-sm break-words">Motif : {selected.reason}</p>{/if}
          </section>
          {#if preview?.blockers.length}<div
              class="rounded-md bg-warn-soft p-3 text-sm"
              role="status"
            >
              <p class="font-medium">Émission indisponible</p>
              <ul class="mt-2 list-disc space-y-1 pl-4">
                {#each preview.blockers as blocker}<li>{blocker}</li>{/each}
              </ul>
            </div>{/if}
          {#if snapshot.stops.length}<section>
              <h3 class="text-sm font-semibold">Ordre des arrêts capturé</h3>
              <ol class="mt-2 space-y-1 text-sm">
                {#each snapshot.stops as item}<li class="flex gap-3 py-1">
                    <span class="font-mono text-ink-muted">{item.sequence}.</span>
                    <div class="min-w-0">
                      <p>
                        {item.type === 'PICKUP'
                          ? 'Ramassage'
                          : item.type === 'DELIVERY'
                            ? 'Livraison'
                            : item.type} · {item.location.name}
                      </p>
                      <address class="mt-1 text-xs not-italic text-ink-muted">
                        {#each addressLines(item.location) as line}<span class="block break-words"
                            >{line}</span
                          >{/each}
                      </address>
                    </div>
                  </li>{/each}
              </ol>
            </section>{/if}
          <section aria-label="Expéditions et colis" class="space-y-4">
            {#each snapshot.shipments as shipment (shipment.id)}
              <article class="rounded-md border border-edge-soft p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-mono text-sm font-semibold">{shipment.shipmentNumber}</h3>
                  <Badge tone="neutral">{labelFor(shipment.status)}</Badge
                  >{#if !shipment.trackingEnabled}<Badge tone="warn">Sans suivi par colis</Badge
                    >{/if}
                </div>
                <div class="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  {#each [{ title: 'Origine', value: shipment.origin }, { title: 'Destination', value: shipment.destination }] as side}<address
                      class="not-italic"
                    >
                      <span class="text-ink-muted">{side.title}</span><strong
                        class="mt-1 block font-medium">{side.value.name}</strong
                      >{#each addressLines(side.value) as line}<span class="block break-words"
                          >{line}</span
                        >{/each}
                    </address>{/each}
                </div>
                {#if !shipment.packages.length}<p class="mt-3 text-xs text-ink-muted">
                    Aucun colis déclaré dans cette édition.
                  </p>{/if}
                {#each shipment.packages as pkg (pkg.id)}
                  <section
                    class="mt-3 border-t border-edge-soft pt-3"
                    aria-label={`Colis ${pkg.code}`}
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-sm">{pkg.code}</span><Badge
                        tone={pkg.status === 'DELIVERED'
                          ? 'ok'
                          : pkg.status === 'LOADED'
                            ? 'info'
                            : 'neutral'}>{names[pkg.status]}</Badge
                      >{#if pkg.status === 'CANCELLED'}<span class="text-xs text-ink-muted"
                          >Sans étiquette</span
                        >{/if}
                    </div>
                    {#if pkg.label}<p class="mt-1 text-sm break-words">{pkg.label}</p>{/if}
                    <ul class="mt-2 space-y-1 text-xs">
                      {#each pkg.contents as line}<li
                          class="flex flex-wrap justify-between gap-x-4 gap-y-1"
                        >
                          <span class="min-w-0 break-words"
                            ><span class="font-mono">{line.reference}</span> · {line.description}</span
                          ><span class="font-mono tabular-nums">{line.quantity} {line.unit}</span>
                        </li>{/each}
                    </ul>
                    {#if pkg.loadedAt || pkg.deliveredAt}<p class="mt-2 text-xs text-ink-muted">
                        {pkg.loadedAt
                          ? `Chargé : ${formatDateTime(pkg.loadedAt)}`
                          : ''}{pkg.deliveredAt
                          ? ` · Livré : ${formatDateTime(pkg.deliveredAt)}`
                          : ''}
                      </p>{/if}
                  </section>
                {/each}
              </article>
            {/each}
          </section>
          {#if selected}<details class="text-xs text-ink-muted">
              <summary class="cursor-pointer">Empreintes de l’édition</summary>
              <p class="mt-2 break-all font-mono">Source : {selected.sourceHash}</p>
              <p class="mt-1 break-all font-mono">Capture : {selected.snapshotHash}</p>
            </details>
          {:else if preview && canManage}<Field
              label={total ? 'Motif de la nouvelle édition' : 'Motif de la première édition'}
              ><Textarea
                bind:value={reason}
                required
                maxlength={300}
                rows={2}
                disabled={busy || !!pending}
                placeholder="Ex. préparation de la tournée ou ajout d’un colis"
              /></Field
            >{/if}
        </div>
      {/if}
    {/if}
    {#snippet footer()}
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onclick={() => {
            drawerOpen = false;
          }}
          disabled={busy}>Fermer</Button
        >
        {#if selected}
          <Button
            variant="secondary"
            onclick={() => file(selected!, 'manifest', canManage)}
            disabled={busy}>PDF manifeste</Button
          >
          <Button
            variant="secondary"
            onclick={() => file(selected!, 'labels', canManage)}
            disabled={busy || !activePackageCount}>PDF étiquettes</Button
          >
        {:else if preview && canManage}<Button
            onclick={issue}
            loading={busy}
            disabled={!preview.canIssue || !reason.trim() || !!error || !!pending || !!storageError}
            >Émettre cette édition</Button
          >{/if}
      </div>
    {/snippet}
  </Drawer>
{/if}
