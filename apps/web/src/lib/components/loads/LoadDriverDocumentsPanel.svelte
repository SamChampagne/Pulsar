<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PERMISSIONS,
    type DriverDocumentPreview,
    type DriverDocumentRecord,
    type DriverDocumentSummary,
    type DeliveryManifestAddress,
    type Paginated,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth, getAccessToken } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
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
  } from '$lib/components/ui';

  let {
    loadId,
    refreshKey = '',
    onChange,
  }: { loadId: string; refreshKey?: string; onChange?: () => void } = $props();
  type Body = {
    operationKey: string;
    sourceHash: string;
    expectedLoadUpdatedAt: string;
    reason: string;
    confirmDriverPublication: true;
  };
  const canRead = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_READ) ?? false,
  );
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE) ?? false,
  );
  const scope = $derived(
    `${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}:${loadId}:${canRead}:${canManage}`,
  );
  const storageKey = $derived(
    `pulsar.driver-document.pending.v1:${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}:${loadId}`,
  );
  const endpoint = $derived(`/transportation/loads/${encodeURIComponent(loadId)}/driver-documents`);
  let items = $state<DriverDocumentSummary[]>([]),
    total = $state(0),
    page = $state(1);
  let loading = $state(false),
    busy = $state(false),
    drawer = $state(false),
    detailLoading = $state(false);
  let error = $state(''),
    actionError = $state(''),
    storageError = $state(''),
    reason = $state('');
  let preview = $state<DriverDocumentPreview | null>(null),
    selected = $state<DriverDocumentRecord | null>(null),
    pending = $state<Body | null>(null),
    inspected = $state(false);
  const snapshot = $derived(selected?.snapshot ?? preview?.snapshot ?? null);
  let listGeneration = 0,
    detailGeneration = 0;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    hash = /^[0-9a-f]{64}$/;
  function address(a: DeliveryManifestAddress) {
    return [
      a.name,
      a.addressLine1,
      a.addressLine2,
      [a.city, a.province, a.postalCode].filter(Boolean).join(' · '),
      a.country,
    ].filter(Boolean);
  }
  function restore() {
    pending = null;
    storageError = '';
    inspected = false;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const value = JSON.parse(raw) as Body;
      if (
        !value ||
        !uuid.test(value.operationKey) ||
        !hash.test(value.sourceHash) ||
        !Number.isFinite(Date.parse(value.expectedLoadUpdatedAt)) ||
        typeof value.reason !== 'string' ||
        !value.reason.trim() ||
        value.reason.length > 300 ||
        value.confirmDriverPublication !== true ||
        Object.keys(value).some(
          (k) =>
            ![
              'operationKey',
              'sourceHash',
              'expectedLoadUpdatedAt',
              'reason',
              'confirmDriverPublication',
            ].includes(k),
        )
      )
        throw new Error('Invalid intent');
      pending = value;
    } catch {
      storageError =
        'Demande locale illisible. Vérifiez les archives avant de préparer une nouvelle publication.';
    }
  }
  async function reload() {
    const generation = ++listGeneration,
      identity = scope;
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<DriverDocumentSummary>>(endpoint, {
        query: { page, pageSize: 5 },
      });
      if (identity !== scope || generation !== listGeneration) return false;
      if (!Array.isArray(result?.items) || !Number.isInteger(result.total))
        throw new Error('Historique invalide.');
      items = result.items;
      total = result.total;
      return true;
    } catch (e) {
      if (identity === scope && generation === listGeneration)
        error = e instanceof Error ? e.message : 'Historique indisponible.';
      return false;
    } finally {
      if (identity === scope && generation === listGeneration) loading = false;
    }
  }
  $effect(() => {
    scope;
    untrack(() => {
      ++listGeneration;
      ++detailGeneration;
      items = [];
      total = 0;
      page = 1;
      drawer = false;
      preview = null;
      selected = null;
      busy = false;
      detailLoading = false;
      actionError = '';
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
    if (!canRead || !canManage || busy || pending || storageError) return;
    const identity = scope,
      generation = ++detailGeneration;
    selected = null;
    preview = null;
    reason = '';
    actionError = '';
    drawer = true;
    detailLoading = true;
    try {
      const result = await api<DriverDocumentPreview>(`${endpoint}/preview`);
      if (identity === scope && generation === detailGeneration) preview = result;
    } catch (e) {
      if (identity === scope && generation === detailGeneration)
        actionError = e instanceof Error ? e.message : 'Aperçu indisponible.';
    } finally {
      if (identity === scope && generation === detailGeneration) detailLoading = false;
    }
  }
  async function openRecord(id: string) {
    if (!canRead || busy) return;
    const identity = scope,
      generation = ++detailGeneration;
    selected = null;
    preview = null;
    actionError = '';
    drawer = true;
    detailLoading = true;
    try {
      const result = await api<DriverDocumentRecord>(`${endpoint}/${encodeURIComponent(id)}`);
      if (identity === scope && generation === detailGeneration) selected = result;
    } catch (e) {
      if (identity === scope && generation === detailGeneration)
        actionError = e instanceof Error ? e.message : 'Édition indisponible.';
    } finally {
      if (identity === scope && generation === detailGeneration) detailLoading = false;
    }
  }
  async function issue() {
    if (!preview?.canIssue || !canManage || busy || pending || !reason.trim() || storageError)
      return;
    const identity = scope,
      key = storageKey;
    const body: Body = {
      operationKey: crypto.randomUUID(),
      sourceHash: preview.sourceHash,
      expectedLoadUpdatedAt: preview.snapshot.load.updatedAt,
      reason: reason.trim(),
      confirmDriverPublication: true,
    };
    if (
      !(await confirmAction(
        'Publier ces adresses, ressources et codes colis au chauffeur de cette mission ? Cette édition remplace la précédente dans son espace. Aucun chargement ou livraison ne sera confirmé.',
        {
          title: 'Publier le document chauffeur',
          confirmLabel: 'Publier au chauffeur',
          dangerous: false,
        },
      ))
    )
      return;
    if (identity !== scope || busy || pending || !canManage) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(body));
      pending = body;
      inspected = false;
    } catch {
      actionError = 'Impossible de conserver la demande avant envoi. Aucune publication effectuée.';
      return;
    }
    await sendPending();
  }
  async function sendPending() {
    if (!pending || busy || !canRead || !canManage) return;
    const body = $state.snapshot(pending),
      identity = scope,
      key = storageKey,
      path = endpoint;
    busy = true;
    actionError = '';
    try {
      const result = await api<DriverDocumentRecord>(path, { method: 'POST', body });
      if (
        !result?.id ||
        result.sourceHash !== body.sourceHash ||
        !hash.test(result.snapshotHash) ||
        !Number.isInteger(result.revision) ||
        result.revision < 1
      )
        throw new Error('Reçu invalide.');
      sessionStorage.removeItem(key);
      if (identity !== scope) return;
      pending = null;
      preview = null;
      selected = result;
      drawer = true;
      page = 1;
      await reload();
      onChange?.();
    } catch (e) {
      if (identity === scope) {
        inspected = false;
        actionError = `${e instanceof ApiError ? e.message : 'Réponse incertaine.'} La demande exacte est conservée. Vérifiez les archives ou reprenez cette même demande; aucun renvoi automatique.`;
      }
    } finally {
      if (identity === scope) busy = false;
    }
  }
  async function inspect() {
    drawer = false;
    inspected = await reload();
  }
  async function acknowledge() {
    const identity = scope,
      key = storageKey;
    if (
      !inspected ||
      busy ||
      !(await confirmAction(
        'Vous avez vérifié les éditions publiées. Oublier cette demande locale n’annule aucune publication.',
        { title: 'Archives vérifiées', confirmLabel: 'Terminer la vérification', dangerous: false },
      ))
    )
      return;
    if (identity !== scope) return;
    try {
      sessionStorage.removeItem(key);
      pending = null;
      storageError = '';
      actionError = '';
      preview = null;
      inspected = false;
    } catch {
      storageError = 'Impossible de libérer la demande locale.';
    }
  }
  async function file(record: DriverDocumentSummary) {
    if (busy || !canRead || (!record.ready && !canManage)) return;
    const identity = scope,
      path = `${endpoint}/${encodeURIComponent(record.id)}/file`;
    busy = true;
    actionError = '';
    try {
      if (!record.ready) {
        const ready = await api<{ ready: boolean }>(path, { method: 'POST' });
        if (!ready?.ready) throw new Error('PDF non confirmé.');
      }
      if (identity !== scope) return;
      const token = getAccessToken(),
        response = await fetch(`/api/v1${path}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new ApiError(response.status, payload?.message ?? 'PDF indisponible.');
      }
      const blob = await response.blob();
      if (identity !== scope) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${record.number}-r${record.revision}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (selected?.id === record.id) selected = { ...selected, ready: true };
      await reload();
    } catch (e) {
      if (identity === scope)
        actionError = `${e instanceof Error ? e.message : 'PDF indisponible.'} Reprenez ce fichier sans créer une nouvelle édition.`;
    } finally {
      if (identity === scope) busy = false;
    }
  }
</script>

{#if canRead}
  <Card>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="max-w-prose">
        <h2 class="text-sm font-semibold text-ink">Document de tournée chauffeur</h2>
        <p class="mt-1 text-xs text-ink-muted">
          Adresses, arrêts et codes colis publiés volontairement. Sans notes internes, prix,
          contacts privés ni détails de marchandises. Ce document n’est pas un POD.
        </p>
      </div>
      {#if canManage}<Button
          variant="secondary"
          onclick={openPreview}
          disabled={busy || loading || !!error || !!pending || !!storageError}
          >{total ? 'Nouvelle publication' : 'Préparer une publication'}</Button
        >{/if}
    </div>
    {#if pending || storageError}<div
        class="mt-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm"
        role="status"
      >
        <p>
          {storageError ||
            'Une publication attend sa confirmation. La demande exacte est conservée.'}
        </p>
        {#if pending}<p class="mt-1 break-words text-xs">Motif privé : {pending.reason}</p>{/if}
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
      </div>{/if}
    {#if actionError && !drawer}<div class="mt-3"><ErrorNotice message={actionError} /></div>{/if}
    {#if loading}<div class="mt-4"><Skeleton rows={2} /></div>
    {:else if error}<div class="mt-4">
        <ErrorNotice
          message={error}
          onretry={() => {
            void reload();
          }}
        />
      </div>
    {:else if !items.length}<p class="mt-4 rounded-md bg-surface-muted p-4 text-sm text-ink-muted">
        Aucun document publié. Affectez le chauffeur, relisez la tournée, puis publiez une première
        édition.
      </p>
    {:else}<ol class="mt-4 divide-y divide-edge-soft">
        {#each items as record (record.id)}<li class="py-3 first:pt-0 last:pb-0">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span class="font-mono text-sm font-medium">{record.number}</span>
                <Badge tone="neutral">Édition {record.revision}</Badge>
                <p class="mt-1 text-xs text-ink-muted">
                  {formatDateTime(record.issuedAt)} · {record.ready
                    ? 'PDF préparé'
                    : 'PDF à préparer'}
                </p>
                <p class="mt-1 break-words text-sm">Motif privé : {record.reason}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button variant="ghost" onclick={() => openRecord(record.id)} disabled={busy}
                  >Consulter</Button
                ><Button
                  variant="secondary"
                  onclick={() => file(record)}
                  disabled={busy || (!record.ready && !canManage)}
                  >{record.ready ? 'Télécharger' : 'Préparer le PDF'}</Button
                >
              </div>
            </div>
          </li>{/each}
      </ol>
      <p class="mt-3 text-xs text-ink-muted">
        Seule la dernière édition compatible avec la mission est proposée au chauffeur. Une adresse
        ou une affectation modifiée exige une nouvelle publication. Un PDF déjà téléchargé ne peut
        pas être retiré de son appareil.
      </p>
      {#if total > 5}<nav
          aria-label="Pages des documents chauffeur"
          class="mt-3 flex items-center justify-between gap-2 text-xs"
        >
          <Button
            variant="ghost"
            disabled={busy || page <= 1}
            onclick={() => {
              page--;
            }}>Précédent</Button
          ><span>Page {page} / {Math.ceil(total / 5)}</span><Button
            variant="ghost"
            disabled={busy || page * 5 >= total}
            onclick={() => {
              page++;
            }}>Suivant</Button
          >
        </nav>{/if}
    {/if}
  </Card>
  <Drawer
    bind:open={drawer}
    title={selected
      ? `${selected.number} · édition ${selected.revision}`
      : 'Aperçu chauffeur avant publication'}
    width="xl"
    dismissible={!busy}
  >
    {#if detailLoading}<Skeleton rows={5} />{:else}
      {#if actionError}<div class="mb-4"><ErrorNotice message={actionError} /></div>{/if}
      {#if snapshot}<div class="space-y-5">
          <section
            class="rounded-md bg-surface-muted p-4"
            aria-label="Résumé du document chauffeur"
          >
            <h3 class="font-semibold">{snapshot.load.loadNumber}</h3>
            <p class="mt-1 text-sm">
              {snapshot.load.driverName ?? 'Chauffeur non affecté'} · {snapshot.load.carrierName ??
                'Transporteur non affecté'}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              Véhicule {snapshot.load.vehicleNumber ?? 'non affecté'} · Remorque {snapshot.load
                .trailerNumber ?? 'non affectée'}
            </p>
            <p class="mt-2 text-xs">
              {snapshot.shipments.length} expéditions · {snapshot.shipments.reduce(
                (n, s) => n + s.packageCodes.length,
                0,
              )} codes colis
            </p>
            <p class="mt-2 text-xs text-ink-muted">
              {selected
                ? 'Copie figée. Le statut de livraison courant ne figure pas sur ce document.'
                : `Version source : ${formatDateTime(snapshot.load.updatedAt)}`}
            </p>
          </section>
          {#if preview?.blockers.length}<div
              class="rounded-md bg-warn-soft p-3 text-sm"
              role="status"
            >
              <p class="font-medium">Publication indisponible</p>
              <ul class="mt-2 list-disc space-y-1 pl-4">
                {#each preview.blockers as blocker}<li>{blocker}</li>{/each}
              </ul>
            </div>{/if}
          {#if snapshot.stops.length}<section>
              <h3 class="text-sm font-semibold">Arrêts publiés</h3>
              <ol class="mt-2 space-y-3">
                {#each snapshot.stops as stop}<li>
                    <p class="text-sm font-medium">
                      {stop.sequence}. {stop.type === 'PICKUP'
                        ? 'Ramassage'
                        : stop.type === 'DELIVERY'
                          ? 'Livraison'
                          : stop.type}
                    </p>
                    <address class="mt-1 text-xs not-italic text-ink-muted">
                      {#each address(stop.location) as line}<span class="block break-words"
                          >{line}</span
                        >{/each}
                    </address>
                  </li>{/each}
              </ol>
            </section>{/if}
          <section class="space-y-4" aria-label="Expéditions publiées">
            {#each snapshot.shipments as shipment}<article class="border-t border-edge-soft pt-3">
                <h3 class="font-mono text-sm font-semibold">{shipment.shipmentNumber}</h3>
                <div class="mt-3 grid gap-4 sm:grid-cols-2">
                  {#each [{ title: 'Origine', value: shipment.origin }, { title: 'Destination', value: shipment.destination }] as side}<address
                      class="text-xs not-italic"
                    >
                      <p class="mb-1 font-medium text-ink-muted">{side.title}</p>
                      {#each address(side.value) as line}<span class="block break-words"
                          >{line}</span
                        >{/each}
                    </address>{/each}
                </div>
                <p class="mt-3 text-xs text-ink-muted">
                  {shipment.trackingEnabled
                    ? 'Codes colis déclarés pour la tournée'
                    : 'Suivi colis non activé; aucun colis supposé'}
                </p>
                <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                  {#each shipment.packageCodes as code}<li>{code}</li>{/each}
                </ul>
              </article>{/each}
          </section>
          {#if selected}<p class="text-xs text-ink-muted">
              Motif interne non diffusé : {selected.reason}
            </p>{:else if preview && canManage}<Field label="Motif interne de publication"
              ><Textarea
                bind:value={reason}
                maxlength={300}
                rows={2}
                required
                disabled={busy || !!pending}
                placeholder="Ex. tournée prête pour le chauffeur"
              /></Field
            >{/if}
        </div>{/if}
    {/if}
    {#snippet footer()}<div class="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onclick={() => {
            drawer = false;
          }}
          disabled={busy}>Fermer</Button
        >{#if selected}<Button
            variant="secondary"
            onclick={() => file(selected!)}
            disabled={busy || (!selected.ready && !canManage)}
            >{selected.ready ? 'Télécharger le PDF' : 'Préparer le PDF'}</Button
          >{:else if preview && canManage}<Button
            onclick={issue}
            loading={busy}
            disabled={!preview.canIssue || !reason.trim() || !!pending || !!storageError}
            >Publier au chauffeur</Button
          >{/if}
      </div>{/snippet}
  </Drawer>
{/if}
