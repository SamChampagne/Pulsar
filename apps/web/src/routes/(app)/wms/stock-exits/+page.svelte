<script lang="ts">
  import { page } from '$app/stores';
  import { beforeNavigate } from '$app/navigation';
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Textarea,
    Select,
    EntityPicker,
    Drawer,
    Skeleton,
  } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';
  import StockExitPurchase from '$lib/components/wms/StockExitPurchase.svelte';
  import StockExitEvidence from '$lib/components/wms/StockExitEvidence.svelte';
  import SupplierReturnReports from '$lib/components/wms/SupplierReturnReports.svelte';
  import {
    STOCK_EXIT_LABELS,
    type StockExitView,
    type StockExitReview,
    type Paginated,
    StockExitKind,
  } from '@pulsar/shared';
  import {
    readStockExitIntent,
    rememberStockExitIntent,
    type StockExitIntent,
  } from '$lib/wms/stock-exit-intent';
  const canManage = $derived($auth?.user.permissions.includes('wms.manage'));
  const canReadPurchases = $derived(
    $auth?.tenant.enabledModules.includes('purchasing') &&
      $auth.user.permissions.includes('purchasing.read'),
  );
  let linkPurchase = $state(false),
    purchaseSourceId = $state(''),
    purchaseSourceToken = $state(''),
    purchaseLabel = $state('');
  $effect(() => {
    void itemId;
    void lotId;
    void binId;
    void supplierId;
    void kind;
    void linkPurchase;
    untrack(() => {
      purchaseSourceId = '';
      purchaseSourceToken = '';
      purchaseLabel = '';
    });
  });
  const storageKey = $derived(`pulsar:stock-exit:${$auth?.tenant.id}:${$auth?.user.id}`);
  let pending = $state<StockExitIntent | null>(null),
    storageError = $state(''),
    error = $state(''),
    success = $state(''),
    busy = $state(false);
  let rows = $state<StockExitView[]>([]),
    loading = $state(false),
    current = $state(1),
    total = $state(0),
    status = $state('');
  let open = $state(false),
    creating = $state(false),
    selected = $state<StockExitView | null>(null),
    review = $state<StockExitReview | null>(null),
    reviewLoading = $state(false);
  let kind = $state<StockExitKind>(StockExitKind.DISPOSAL),
    itemId = $state(''),
    lotId = $state(''),
    binId = $state(''),
    quantity = $state(''),
    reason = $state(''),
    supplierId = $state(''),
    reference = $state(''),
    destination = $state(''),
    completionNote = $state(''),
    cancelReason = $state(''),
    confirmed = $state(false);
  let listGeneration = 0,
    detailGeneration = 0;
  const lotFilter = $derived($page.url.searchParams.get('lotId') ?? '');
  const orderFilter = $derived($page.url.searchParams.get('purchaseOrderId') ?? '');
  const validQuantity = $derived(/^\d{1,9}(\.\d{1,3})?$/.test(quantity) && Number(quantity) > 0);
  const canPost = $derived(
    canManage &&
      selected &&
      $auth?.user.permissions.includes(
        selected.kind === 'DISPOSAL' ? 'wms.stock.dispose' : 'wms.stock.return',
      ),
  );
  $effect(() => {
    try {
      pending = readStockExitIntent(storageKey);
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
  });
  $effect(() => {
    void lotFilter;
    void orderFilter;
    void status;
    untrack(() => {
      void load(1);
    });
  });
  $effect(() => {
    const id = $page.url.searchParams.get('id');
    if (id)
      untrack(() => {
        void show(id);
      });
  });
  beforeNavigate((n) => {
    if (busy) n.cancel();
  });
  async function load(p = 1) {
    const g = ++listGeneration;
    loading = true;
    error = '';
    current = p;
    try {
      const r = await api<Paginated<StockExitView>>('/wms/stock-exits', {
        query: {
          page: p,
          pageSize: 15,
          lotId: lotFilter || undefined,
          purchaseOrderId: orderFilter || undefined,
          status: status || undefined,
        },
      });
      if (g === listGeneration) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === listGeneration) {
        rows = [];
        error = (e as Error).message;
      }
    } finally {
      if (g === listGeneration) loading = false;
    }
  }
  function prepare() {
    if (pending || storageError) return;
    detailGeneration++;
    selected = null;
    review = null;
    kind = StockExitKind.DISPOSAL;
    itemId = $page.url.searchParams.get('itemId') ?? '';
    lotId = lotFilter;
    binId = '';
    quantity = '';
    reason = '';
    supplierId = '';
    reference = '';
    destination = '';
    linkPurchase = false;
    purchaseSourceId = '';
    purchaseSourceToken = '';
    purchaseLabel = '';
    creating = true;
    open = true;
    error = '';
  }
  async function show(id: string) {
    const g = ++detailGeneration;
    creating = false;
    open = true;
    selected = null;
    review = null;
    confirmed = false;
    completionNote = '';
    cancelReason = '';
    error = '';
    try {
      const r = await api<StockExitView>(`/wms/stock-exits/${encodeURIComponent(id)}`);
      if (g === detailGeneration) selected = r;
    } catch (e) {
      if (g === detailGeneration) error = (e as Error).message;
    }
  }
  async function examine() {
    if (!selected || busy) return;
    const id = selected.id,
      g = detailGeneration;
    reviewLoading = true;
    review = null;
    confirmed = false;
    error = '';
    try {
      const r = await api<StockExitReview>(`/wms/stock-exits/${id}/review`);
      if (g === detailGeneration) review = r;
    } catch (e) {
      if (g === detailGeneration) error = (e as Error).message;
    } finally {
      if (g === detailGeneration) reviewLoading = false;
    }
  }
  async function send(p: StockExitIntent, recover = false) {
    if (busy || storageError) return;
    try {
      rememberStockExitIntent(storageKey, p);
      pending = p;
    } catch (e) {
      error = (e as Error).message;
      return;
    }
    busy = true;
    error = '';
    success = '';
    try {
      const path =
        p.action === 'create'
          ? '/wms/stock-exits'
          : `/wms/stock-exits/${encodeURIComponent(p.id!)}/${p.action}`;
      const r = await api<{ id: string; replayed: boolean }>(path, {
        method: 'POST',
        body: p.body,
      });
      localStorage.removeItem(storageKey);
      pending = null;
      success =
        p.action === 'create'
          ? 'Dossier préparé. Aucun stock modifié.'
          : p.action === 'cancel'
            ? 'Brouillon annulé. Aucun stock modifié.'
            : 'Sortie enregistrée une seule fois. Le reste du lot conserve sa disposition.';
      await load(current);
      await show(r.id);
      window.dispatchEvent(new CustomEvent('wms:stock-changed'));
    } catch (e) {
      error = (e as Error).message;
      if (
        !recover &&
        e instanceof ApiError &&
        e.statusCode >= 400 &&
        e.statusCode < 500 &&
        ![408, 429].includes(e.statusCode)
      ) {
        try {
          localStorage.removeItem(storageKey);
          pending = null;
        } catch {
          storageError = 'Impossible de retirer la demande refusée; faites vérifier le registre.';
        }
      }
      review = null;
      confirmed = false;
    } finally {
      busy = false;
    }
  }
  function create() {
    if (
      !canManage ||
      !itemId ||
      !lotId ||
      !binId ||
      !/^\d{1,9}(\.\d{1,3})?$/.test(quantity) ||
      Number(quantity) <= 0 ||
      reason.trim().length < 3 ||
      (kind === 'SUPPLIER_RETURN' && linkPurchase && (!purchaseSourceId || !purchaseSourceToken))
    )
      return;
    void send({
      action: 'create',
      body: {
        operationKey: crypto.randomUUID(),
        kind,
        itemId,
        lotId,
        binId,
        quantity,
        reason,
        ...(kind === StockExitKind.SUPPLIER_RETURN ? { supplierId, reference, destination } : {}),
        ...(kind === 'SUPPLIER_RETURN' && linkPurchase
          ? { purchaseSourceId, purchaseSourceToken }
          : {}),
      },
    });
  }
  function post() {
    if (
      !selected ||
      !review ||
      !canPost ||
      !confirmed ||
      review.blockedReasons.length ||
      completionNote.trim().length < 10
    )
      return;
    void send({
      action: 'post',
      id: selected.id,
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: review.expectedUpdatedAt,
        reviewToken: review.reviewToken,
        completionNote,
        confirmed: true,
      },
    });
  }
  function cancel() {
    if (!selected || !canManage || cancelReason.trim().length < 3) return;
    void send({
      action: 'cancel',
      id: selected.id,
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: selected.updatedAt,
        reason: cancelReason,
      },
    });
  }
  const label = (s: string) =>
    s === 'DRAFT' ? 'À traiter' : s === 'POSTED' ? 'Sortie enregistrée' : 'Annulé';
</script>

<svelte:head><title>Sorties documentées | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-4">
  <PageHeader
    title="Sorties documentées"
    eyebrow="Entrepôt · Disposition du stock"
    subtitle="Destruction, rebut et retour fournisseur : préparer, revoir, puis enregistrer la sortie physique."
  >
    {#snippet actions()}{#if lotFilter || orderFilter}<Button
          variant="ghost"
          href="/wms/stock-exits">Tous les dossiers</Button
        >{/if}{#if canManage}<Button
          onclick={prepare}
          disabled={busy || !!pending || !!storageError}>Préparer une sortie</Button
        >{/if}{/snippet}
  </PageHeader>
  <p class="max-w-3xl text-sm text-ink-muted">
    Un dossier vise un lot et un emplacement. Le brouillon ne réserve rien. La validation retire la
    quantité indiquée, même en quarantaine, sans libérer le reste du lot ni créer d’avoir ou de
    transport.
  </p>
  {#if storageError}<p role="alert" class="text-danger">{storageError}</p>{/if}
  {#if pending}<section
      aria-label="Reprise de sortie"
      class="space-y-2 rounded-lg border border-edge p-4"
    >
      <h2 class="font-semibold">Une demande attend confirmation</h2>
      <p class="text-sm text-ink-muted">
        Reprenez exactement la même demande; ne préparez pas une deuxième sortie après une réponse
        perdue.
      </p>
      <Button
        disabled={busy || !!storageError}
        onclick={() => {
          if (pending) void send(pending, true);
        }}>Reprendre la même demande</Button
      >
    </section>{/if}
  {#if success}<p role="status" class="text-sm">{success}</p>{/if}
  {#if error && !open}<p role="alert" class="text-danger">{error}</p>{/if}
  <div class="flex flex-wrap items-end gap-3">
    <div class="w-56">
      <Field label="Statut des dossiers"
        ><Select bind:value={status}
          ><option value="">Tous les statuts</option><option value="DRAFT">À traiter</option><option
            value="POSTED">Sorties enregistrées</option
          ><option value="CANCELLED">Annulés</option></Select
        ></Field
      >
    </div>
    <Button variant="secondary" disabled={loading} onclick={() => load(current)}
      >Actualiser le registre</Button
    >
  </div>
  {#if loading}<Skeleton rows={5} />{:else if !error && rows.length === 0}<div
      class="rounded-lg border border-edge p-8"
    >
      <h2 class="font-semibold">Aucune sortie dans ce périmètre</h2>
      <p class="mt-2 text-sm text-ink-muted">
        Depuis un lot, préparez une destruction ou un retour, puis confirmez uniquement après
        vérification physique.
      </p>
    </div>{:else}<ul class="divide-y divide-edge rounded-lg border border-edge bg-surface">
      {#each rows as r (r.id)}<li>
          <button
            class="grid w-full gap-3 p-4 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent md:grid-cols-[8rem_minmax(0,1fr)_10rem]"
            onclick={() => show(r.id)}
            ><span class="font-mono text-sm">{r.number}</span><span class="min-w-0"
              ><span class="block font-medium"
                >{STOCK_EXIT_LABELS[r.kind]} · {r.snapshot.lot.code}</span
              ><span class="mt-1 block text-sm text-ink-muted break-words"
                >{r.snapshot.item.name} · {r.quantity}
                {r.unitSnapshot} · {r.snapshot.bin.code}</span
              ></span
            ><span class="text-sm text-ink-muted">{label(r.status)}</span></button
          >
        </li>{/each}
    </ul>{/if}
  {#if total > 15}<div class="flex items-center gap-3">
      <Button
        variant="secondary"
        disabled={current === 1 || loading}
        onclick={() => load(current - 1)}>Page précédente</Button
      ><span class="text-sm">Page {current}</span><Button
        variant="secondary"
        disabled={current * 15 >= total || loading}
        onclick={() => load(current + 1)}>Page suivante</Button
      >
    </div>{/if}
</div>
<Drawer
  bind:open
  title={creating ? 'Préparer une sortie' : (selected?.number ?? 'Lecture du dossier')}
  width="xl"
  dismissible={!busy}
  onclose={() => {
    detailGeneration++;
    reviewLoading = false;
  }}
>
  {#if error}<p role="alert" class="mb-4 text-sm text-danger">{error}</p>{/if}
  {#if pending}<p class="mb-3 text-sm text-ink-muted">
      Demande en attente : fermez ce panneau et utilisez « Reprendre la même demande » dans le
      registre.
    </p>{/if}
  {#if creating}<form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <Field label="Type de sortie"
        ><Select bind:value={kind} disabled={busy || !!pending}
          ><option value="DISPOSAL">Destruction / rebut</option><option value="SUPPLIER_RETURN"
            >Retour fournisseur</option
          ></Select
        ></Field
      >
      <EntityPicker
        endpoint="/wms/items"
        label="Article suivi par lot"
        bind:value={itemId}
        disabled={busy || !!pending}
        onselect={() => {
          lotId = '';
          binId = '';
        }}
      />
      {#if itemId}<EntityPicker
          endpoint={`/wms/items/${itemId}/lots`}
          label="Lot à sortir"
          labelKey="code"
          bind:value={lotId}
          disabled={busy || !!pending}
          onselect={() => {
            binId = '';
          }}
        />{/if}
      {#if itemId && lotId}<EntityPicker
          endpoint="/wms/stock-exits/sources"
          label="Emplacement source"
          filters={{ itemId, lotId }}
          bind:value={binId}
          disabled={busy || !!pending}
        />{/if}
      <p class="text-xs text-ink-muted">
        Les quantités affichées ne sont pas réservées. Un article non suivi par lot n’entre pas dans
        ce parcours.
      </p>
      <Field
        label="Quantité dans l’unité de l’article"
        error={quantity && !validQuantity
          ? 'Quantité positive, jusqu’à 3 décimales avec un point (ex. 2.125).'
          : ''}
        ><Input
          bind:value={quantity}
          inputmode="decimal"
          maxlength={13}
          required
          disabled={busy || !!pending}
        /></Field
      >
      <Field label="Motif de sortie"
        ><Textarea bind:value={reason} maxlength={1000} disabled={busy || !!pending} /></Field
      >
      {#if kind === 'SUPPLIER_RETURN'}<EntityPicker
          endpoint="/wms/data/suppliers"
          label="Fournisseur du retour"
          filters={{ active: 'true' }}
          bind:value={supplierId}
          disabled={busy || !!pending}
        /><Field label="Référence de retour / autorisation fournisseur"
          ><Input
            bind:value={reference}
            maxlength={200}
            required
            disabled={busy || !!pending}
          /></Field
        ><Field label="Destination de retour confirmée"
          ><Textarea
            bind:value={destination}
            maxlength={1000}
            disabled={busy || !!pending}
          /></Field
        >
        <p class="text-xs text-ink-muted">
          Vérifiez l’accord et la destination hors Pulsar. Aucun courriel, avoir, remplacement ou
          shipment automatique.
        </p>
        {#if canReadPurchases}<section
            class="space-y-3 rounded-lg border border-edge p-4"
            aria-label="Rapprochement d’achat facultatif"
          >
            <label class="flex items-start gap-2 text-sm"
              ><input
                type="checkbox"
                bind:checked={linkPurchase}
                disabled={busy || !!pending}
              /><span>Rattacher à une réception d’achat</span></label
            >
            {#if linkPurchase}
              <p class="text-xs text-ink-muted">
                Même fournisseur, article, lot, site et unité. Le cumul inclut les brouillons non
                annulés, sans réserver de stock. Le lien sera figé à la préparation.
              </p>
              {#if supplierId && itemId && lotId && binId}<EntityPicker
                  endpoint="/wms/stock-exits/purchase-sources"
                  label="Réception d’achat d’origine"
                  filters={{ supplierId, itemId, lotId, binId }}
                  bind:value={purchaseSourceId}
                  selectedLabel={purchaseLabel}
                  disabled={busy || !!pending}
                  onselect={(r) => {
                    purchaseSourceToken = String(r.token ?? '');
                    purchaseLabel = String(r.name ?? '');
                  }}
                />
                {#if purchaseSourceId && !purchaseSourceToken}<p
                    role="alert"
                    class="text-sm text-danger"
                  >
                    Preuve de réception incomplète : choisissez une autre réception ou préparez
                    explicitement un retour autonome. Aucun achat ne sera supposé.
                  </p>{/if}
              {:else}<p class="text-sm text-ink-muted">
                  Choisissez d’abord l’article, le lot, l’emplacement et le fournisseur.
                </p>{/if}
            {/if}
          </section>{/if}
      {/if}
      <Button
        type="submit"
        disabled={busy ||
          !!pending ||
          !!storageError ||
          !itemId ||
          !lotId ||
          !binId ||
          !validQuantity ||
          reason.trim().length < 3 ||
          (kind === 'SUPPLIER_RETURN' &&
            linkPurchase &&
            (!purchaseSourceId || !purchaseSourceToken)) ||
          (kind === 'SUPPLIER_RETURN' &&
            (!supplierId || reference.trim().length < 3 || destination.trim().length < 10))}
        >Préparer sans modifier le stock</Button
      >
    </form>{:else if selected}<section class="space-y-4" aria-label="Dossier de sortie">
      <div>
        <h2 class="text-lg font-semibold">{STOCK_EXIT_LABELS[selected.kind]}</h2>
        <p class="text-sm text-ink-muted">
          {label(selected.status)} · {selected.snapshot.item.name}
        </p>
      </div>
      <dl class="grid gap-3 rounded-lg bg-surface-muted p-4 sm:grid-cols-2">
        <div>
          <dt class="text-xs text-ink-muted">Lot et quantité</dt>
          <dd class="font-medium">
            {selected.snapshot.lot.code} · {selected.quantity}
            {selected.unitSnapshot}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Emplacement capturé</dt>
          <dd>{selected.snapshot.bin.code} · {selected.snapshot.bin.locationName}</dd>
        </div>
      </dl>
      <p class="whitespace-pre-wrap text-sm break-words">{selected.reason}</p>
      {#if selected.snapshot.supplier}<div class="space-y-2 text-sm">
          <p>
            Fournisseur capturé : {selected.snapshot.supplier.name} · {selected.snapshot.supplier
              .code}
          </p>
          <p>Référence : {selected.reference}</p>
          <p class="whitespace-pre-wrap break-words">Destination : {selected.destination}</p>
        </div>{/if}
      {#if selected.kind === 'SUPPLIER_RETURN' && canReadPurchases}<StockExitPurchase
          id={selected.id}
        />{/if}
      <p class="text-xs text-ink-muted">
        Préparé par {selected.createdBy.firstName}
        {selected.createdBy.lastName} · {formatDateTime(selected.createdAt)}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" href={`/wms/items/${selected.itemId}/lots?lotId=${selected.lotId}`}
          >Voir le lot</Button
        >{#if selected.movementId}<Button
            variant="secondary"
            href={`/wms/movements?refType=stock-exit&refId=${selected.id}`}
            >Voir la preuve de stock</Button
          >{/if}
      </div>
      {#if selected.status === 'DRAFT'}<section
          aria-label="Revue de sortie"
          class="space-y-3 border-t border-edge pt-4"
        >
          <h3 class="font-semibold">Revoir les effets avant d’enregistrer</h3>
          <p class="text-sm text-ink-muted">
            Aucune réservation. Une modification du lot ou de ses mouvements impose une nouvelle
            revue. Le brouillon n’est pas modifiable : annulez-le en cas d’erreur.
          </p>
          <Button
            variant="secondary"
            disabled={busy || reviewLoading || !!pending}
            onclick={examine}>Examiner les effets</Button
          >
          {#if reviewLoading}<Skeleton rows={3} />{/if}
          {#if review}<div class="space-y-2 rounded-lg bg-surface-muted p-4">
              <p class="font-mono text-sm">
                {review.onHand}
                {review.unit} → −{review.quantity} → {review.remaining}
                {review.unit}
              </p>
              <p class="text-sm">
                {review.disposition === 'QUARANTINED'
                  ? 'Le lot restera en quarantaine, même après cette sortie.'
                  : 'La disposition du lot ne change pas.'}
              </p>
              {#each review.blockedReasons as b}<p role="alert" class="text-sm text-danger">
                  {b}
                </p>{/each}
            </div>{/if}
          {#if canPost}<Field label="Compte rendu de sortie physique"
              ><Textarea
                bind:value={completionNote}
                maxlength={2000}
                disabled={busy || !!pending}
              /></Field
            ><label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={confirmed} disabled={busy || !!pending} /><span
                >Je confirme la destruction/le rebut effectué ou la remise physique au retour, la
                quantité et le compte rendu. Ce n’est pas une simple réservation.</span
              ></label
            ><Button
              variant="danger"
              disabled={busy ||
                !!pending ||
                !!storageError ||
                !review ||
                !!review.blockedReasons.length ||
                !confirmed ||
                completionNote.trim().length < 10}
              onclick={post}>Enregistrer la sortie physique</Button
            >{:else}<p class="text-sm text-ink-muted">
              La confirmation exige le droit {selected.kind === 'DISPOSAL'
                ? 'wms.stock.dispose'
                : 'wms.stock.return'}, en plus de la gestion WMS.
            </p>{/if}
        </section>
        {#if canManage}<section
            class="space-y-3 border-t border-edge pt-4"
            aria-label="Annulation du brouillon"
          >
            <h3 class="font-semibold">Annuler sans toucher au stock</h3>
            <Field label="Motif d’annulation"
              ><Input
                bind:value={cancelReason}
                maxlength={1000}
                disabled={busy || !!pending}
              /></Field
            ><Button
              variant="secondary"
              disabled={busy || !!pending || !!storageError || cancelReason.trim().length < 3}
              onclick={cancel}>Annuler le brouillon</Button
            >
          </section>{/if}
      {:else}<div class="space-y-2 border-t border-edge pt-4">
          <p class="text-sm whitespace-pre-wrap break-words">
            {selected.completionNote ?? selected.cancellationReason}
          </p>
          <p class="text-xs text-ink-muted">
            {selected.closedBy?.firstName}
            {selected.closedBy?.lastName} · {formatDateTime(selected.closedAt)}
          </p>
          <p class="text-sm text-ink-muted">
            Dossier fermé, preuve conservée. Aucun retour arrière ni remise en stock automatique.
          </p>
        </div>{/if}
      {#key selected.id}<StockExitEvidence
          id={selected.id}
          status={selected.status}
          bind:busy
          disabled={!!pending || !!storageError}
        />{/key}
      {#if selected.kind === 'SUPPLIER_RETURN' && selected.status === 'POSTED'}
        {#key selected.id}<SupplierReturnReports
            id={selected.id}
            quantity={selected.quantity}
            unit={selected.unitSnapshot}
            bind:busy
            disabled={!!pending || !!storageError}
          />{/key}
      {/if}
    </section>{:else if !error}<Skeleton rows={5} />{/if}
</Drawer>
