<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    Button,
    Field,
    Input,
    Textarea,
    EntityPicker,
    Skeleton,
    Badge,
  } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  import type { ServiceJob } from './types';
  import LotChoice from '$lib/components/wms/LotChoice.svelte';
  import {
    readPartIntent,
    rememberPartIntent,
    clearPartIntent,
    type PartIntent,
  } from './part-intent';
  type Part = {
    lotId: string | null;
    lotSnapshot: {
      code: string;
      supplierLot: string | null;
      manufacturedOn: string | null;
      expiresOn: string | null;
    } | null;
    id: string;
    quantity: string;
    returnedQuantity: string;
    remainingQuantity: string;
    billingLocked: boolean;
    creditReturnOptions: { id: string; number: string; available: string }[];
    returnCount: number;
    returns: {
      id: string;
      quantity: string;
      reason: string;
      createdAt: string;
      movementId: string;
    }[];
    nameSnapshot: string;
    codeSnapshot: string;
    unitSnapshot: string;
    binSnapshot: string;
    note: string;
    createdAt: string;
    movementId: string;
    returnMovementId: string | null;
    returnedAt: string | null;
    returnReason: string | null;
  };
  let {
    job,
    busy = $bindable(false),
    formOpen = $bindable(false),
    onchanged,
    onjournal,
  }: {
    job: ServiceJob;
    busy?: boolean;
    formOpen?: boolean;
    onchanged: () => Promise<void>;
    onjournal: () => Promise<void>;
  } = $props();
  const scope = $derived(`${$auth?.tenant.id}:${$auth?.user.id}:${job.id}`);
  const permissions = $derived(($auth?.user.permissions ?? []) as string[]);
  const canWrite = $derived(
    $auth?.tenant.enabledModules.includes('wms') &&
      ['services.manage', 'wms.read', 'wms.manage'].every((p) => permissions.includes(p)),
  );
  let rows = $state<Part[]>([]),
    current = $state(1),
    total = $state(0),
    loading = $state(true),
    error = $state(''),
    storageError = $state('');
  let pending = $state<PartIntent | null>(null),
    returning = $state<Part | null>(null),
    productId = $state(''),
    binId = $state(''),
    quantity = $state<number | undefined>(1),
    note = $state(''),
    confirmed = $state(false);
  let creditLineId = $state('');
  let lotId = $state(''),
    lotReady = $state(false),
    stockUnit = $state('');
  const returnLimit = $derived(
    returning
      ? Math.min(
          Number(returning.remainingQuantity),
          returning.billingLocked
            ? Number(
                returning.creditReturnOptions.find((c) => c.id === creditLineId)?.available ?? 0,
              )
            : Infinity,
        )
      : 0,
  );
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    try {
      const data = await api<Paginated<Part>>(`/services/jobs/${job.id}/parts`, {
        query: { page: current, pageSize: 10 },
      });
      if (g === generation) {
        rows = data.items;
        total = data.total;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Pièces indisponibles.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void load();
  });
  $effect(() => {
    void productId;
    binId = '';
    lotId = '';
  });
  $effect(() => {
    void binId;
    lotId = '';
  });
  $effect(() => {
    void productId;
    void binId;
    void lotId;
    void quantity;
    void note;
    void creditLineId;
    confirmed = false;
  });
  onMount(() => {
    try {
      pending = readPartIntent(scope);
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'Stockage indisponible.';
    }
  });
  function start(part: Part | null) {
    if (!canWrite || busy || pending || storageError) return;
    returning = part;
    note = '';
    productId = '';
    binId = '';
    lotId = '';
    creditLineId = part?.creditReturnOptions[0]?.id ?? '';
    quantity = part
      ? Math.min(
          Number(part.remainingQuantity),
          part.billingLocked ? Number(part.creditReturnOptions[0]?.available ?? 0) : Infinity,
        )
      : 1;
    confirmed = false;
    error = '';
    formOpen = true;
  }
  async function send(request: PartIntent, recovery = false) {
    if (busy || !canWrite || request.jobId !== job.id) return;
    const requestScope = scope;
    busy = true;
    error = '';
    try {
      await api(
        `/services/jobs/${encodeURIComponent(request.jobId)}/parts${request.partId ? `/${encodeURIComponent(request.partId)}/return` : ''}`,
        { method: 'POST', body: request.body },
      );
      clearPartIntent(requestScope, request.body.operationKey);
      pending = null;
      formOpen = false;
      await onchanged();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Réponse incertaine.';
      if (!recovery && e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode)) {
        clearPartIntent(requestScope, request.body.operationKey);
        pending = null;
        // Refresh the version, but do not silently submit the revised request.
        try {
          await onchanged();
        } catch {
          /* The visible error remains; reopen to refresh. */
        }
      } else formOpen = false;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (busy || pending || storageError || !confirmed || !note.trim() || !canWrite) return;
    if (!returning && (!productId || !binId || !lotReady)) return;
    if (!quantity || quantity <= 0 || (returning && quantity > returnLimit)) return;
    const request: PartIntent = {
      jobId: job.id,
      ...(returning ? { partId: returning.id } : {}),
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: job.updatedAt,
        ...(returning
          ? { reason: note.trim(), quantity, ...(returning.billingLocked ? { creditLineId } : {}) }
          : {
              catalogItemId: productId,
              binId,
              ...(lotId ? { lotId } : {}),
              quantity,
              note: note.trim(),
            }),
      },
    };
    try {
      rememberPartIntent(scope, request);
      pending = request;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Stockage indisponible.';
      return;
    }
    await send(request);
  }
</script>

<section aria-label="Pièces de l’intervention" class="space-y-4">
  {#if $auth?.tenant.enabledModules.includes('wms') && permissions.includes('wms.read')}<Button
      variant="ghost"
      disabled={busy || formOpen}
      onclick={onjournal}>Ouvrir le journal WMS de cette intervention</Button
    >{/if}
  <div>
    <h3 class="font-semibold">Pièces consommées</h3>
    <p class="mt-2 text-sm leading-6 text-ink-muted">
      Une confirmation retire réellement la quantité du stock WMS. Le Catalogue identifie le
      produit; cette intervention conserve son utilisation. Un retour réduit les pièces restant à
      facturer, mais ne modifie jamais une facture existante.
    </p>
  </div>
  {#if !canWrite}<p class="text-sm text-ink-muted">
      Historique en lecture seule. Pour agir : Entrepôt activé et droits services.manage, wms.read
      et wms.manage.
    </p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if pending}<div class="rounded-md border border-edge bg-surface-muted p-4 text-sm">
      <p>
        Une opération attend confirmation. Ne la recréez pas : reprenez exactement la demande
        conservée, même après une coupure. Le serveur ne l’applique qu’une fois.
      </p>
      <Button
        variant="secondary"
        disabled={busy || !canWrite}
        onclick={() => {
          if (pending) return send(pending, true);
        }}>Vérifier / reprendre l’opération</Button
      >
    </div>{/if}
  {#if formOpen && !pending}<form
      class="space-y-4 rounded-md border border-edge p-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h4 class="font-medium">{returning ? 'Retour de pièces au stock' : 'Consommer une pièce'}</h4>
      {#if returning}<p class="text-sm">
          {returning.nameSnapshot} → {returning.binSnapshot}. Restant retournable :
          {returning.remainingQuantity}
          {returning.unitSnapshot} sur {returning.quantity} sorties. Confirmez uniquement les pièces physiquement
          revenues, en une ou plusieurs fois.
        </p>
        {#if returning.lotSnapshot}<div
            class="rounded-md bg-surface-muted p-3 text-sm"
            aria-label="Lot de retour"
          >
            <p class="font-medium">Retour au lot {returning.lotSnapshot.code}</p>
            <p class="mt-1 text-xs text-ink-muted">
              Lot et emplacement repris de la sortie d’origine, même si la correspondance du produit
              a changé. Aucun choix d’un autre lot.
            </p>
          </div>{/if}
        {#if returning.billingLocked}<Field label="Avoir validé autorisant ce retour"
            ><select
              class="w-full rounded-md border border-edge bg-surface p-2 text-sm"
              bind:value={creditLineId}
              >{#each returning.creditReturnOptions as credit}<option value={credit.id}
                  >{credit.number} · {credit.available}
                  {returning.unitSnapshot} disponible(s)</option
                >{/each}</select
            ></Field
          >
          <p class="text-xs text-ink-muted">
            L’avoir ne remet pas automatiquement les pièces en stock. Ce retour sera lié à sa ligne,
            sans nouveau crédit financier.
          </p>{/if}
        <Field label={`Quantité retournée (${returning.unitSnapshot})`}>
          <Input
            type="number"
            min={0.001}
            max={returnLimit}
            step={0.001}
            required
            bind:value={quantity}
          />
        </Field>
      {:else}<EntityPicker
          endpoint="/services/references/parts"
          label="Produit du Catalogue"
          detailKey="code"
          bind:value={productId}
        />
        {#key productId}<EntityPicker
            endpoint="/services/references/part-bins"
            label="Emplacement source"
            detailKey="available"
            filters={{ catalogItemId: productId }}
            bind:value={binId}
            disabled={!productId}
          />{/key}
        <LotChoice
          outgoing
          catalogItemId={productId}
          stockLinkModule="services"
          {binId}
          bind:value={lotId}
          bind:ready={lotReady}
          bind:unit={stockUnit}
          disabled={busy || !binId}
        />
        {#if stockUnit}<p class="text-xs text-ink-muted">Unité de stock : {stockUnit}</p>{/if}
        <Field label="Quantité consommée"
          ><Input
            type="number"
            min={0.001}
            max={1000000000}
            step={0.001}
            required
            bind:value={quantity}
          /></Field
        >
        <p class="text-xs text-ink-muted">
          Le stock de l’emplacement est le total de l’article; pour un article suivi, choisissez le
          lot physique et vérifiez son propre solde. Le disponible n’est pas réservé. Il sera
          revérifié à la confirmation. Produit absent ? Vérifiez sa correspondance dans Services →
          Données → Articles → Stock WMS.
        </p>
      {/if}
      <Field label={returning ? 'Motif du retour' : 'Utilisation des pièces'}
        ><Textarea required maxlength={1000} bind:value={note} /></Field
      >
      <label class="flex items-start gap-2 text-sm"
        ><input type="checkbox" bind:checked={confirmed} />Je confirme le mouvement physique et la
        quantité.</label
      >
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => {
            formOpen = false;
          }}>Annuler la saisie</Button
        >
        <Button
          type="submit"
          loading={busy}
          disabled={!confirmed ||
            !note.trim() ||
            !quantity ||
            quantity <= 0 ||
            (!!returning && quantity > returnLimit) ||
            (!returning && (!productId || !binId || !quantity || !lotReady))}
          >{returning ? 'Confirmer le retour de stock' : 'Confirmer la sortie de stock'}</Button
        >
      </div>
    </form>{/if}
  {#if !formOpen && !pending && canWrite && job.status === 'IN_PROGRESS' && job.project.status === 'ACTIVE'}<Button
      disabled={busy || !!storageError}
      onclick={() => start(null)}>Consommer une pièce</Button
    >{/if}
  {#if job.status === 'PLANNED'}<p class="text-sm text-ink-muted">
      Démarrez l’intervention avant de consommer des pièces.
    </p>{/if}
  {#if loading}<Skeleton rows={2} />{:else if !rows.length}<p
      class="rounded-md border border-dashed border-edge p-4 text-sm text-ink-muted"
    >
      Aucune pièce consommée. Choisir une prestation ou démarrer le travail ne modifie pas le stock.
    </p>
  {:else}<div class="divide-y divide-edge rounded-md border border-edge">
      {#each rows as row (row.id)}<article
          class="space-y-2 p-4"
          aria-label={`Pièce ${row.codeSnapshot}`}
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-medium">{row.nameSnapshot}</h4>
            <Badge tone={Number(row.remainingQuantity) === 0 ? 'neutral' : 'info'}
              >{Number(row.remainingQuantity) === 0
                ? 'Retourné intégralement'
                : Number(row.returnedQuantity) > 0
                  ? 'Retour partiel'
                  : 'Consommé'}</Badge
            >
          </div>
          <p class="text-xs text-ink-muted">{row.codeSnapshot} · quantités en {row.unitSnapshot}</p>
          {#if row.lotSnapshot}<div
              class="rounded-md border border-edge px-3 py-2 text-sm"
              aria-label={`Lot consommé ${row.lotSnapshot.code}`}
            >
              <p class="break-words font-medium">Lot {row.lotSnapshot.code}</p>
              <p class="mt-1 text-xs text-ink-muted">
                Lot fournisseur : {row.lotSnapshot.supplierLot ?? 'non renseigné'} · Péremption déclarée
                : {row.lotSnapshot.expiresOn ?? 'non renseignée'}
              </p>
              <p class="mt-1 text-xs text-ink-muted">
                Fabrication déclarée : {row.lotSnapshot.manufacturedOn ?? 'non renseignée'}
              </p>
              <p class="mt-1 text-xs text-ink-muted">
                Identité capturée à la sortie. Les retours de cette consommation restent dans ce
                lot.
              </p>
            </div>{:else}<p class="text-xs text-ink-muted">
              Consommation sans lot capturé — aucun lot historique déduit.
            </p>{/if}
          <dl class="grid grid-cols-3 gap-3 rounded-md bg-surface-muted p-3 text-sm">
            <div>
              <dt class="text-xs text-ink-muted">Sorties</dt>
              <dd class="mt-1 font-mono">{row.quantity}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Retournées</dt>
              <dd class="mt-1 font-mono">{row.returnedQuantity}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Conservées</dt>
              <dd class="mt-1 font-mono">{row.remainingQuantity}</dd>
            </div>
          </dl>
          <p class="text-xs text-ink-muted">
            {row.binSnapshot} · {fmtUserInstant(row.createdAt)}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">{row.note}</p>
          {#if row.returns.length}<details class="text-sm">
              <summary class="cursor-pointer">Historique des retours ({row.returnCount})</summary>
              <ol class="mt-3 space-y-3">
                {#each row.returns as entry (entry.id)}<li class="border-l-2 border-edge pl-3">
                    <p class="font-medium">
                      {entry.quantity}
                      {row.unitSnapshot} · {fmtUserInstant(entry.createdAt)}
                    </p>
                    <p class="whitespace-pre-wrap break-words text-ink-muted">{entry.reason}</p>
                    <p class="mt-1 break-all text-xs text-ink-muted">
                      Mouvement : {entry.movementId}
                    </p>
                  </li>{/each}
              </ol>
              {#if row.returnCount > row.returns.length}<p class="mt-2 text-xs text-ink-muted">
                  Les 5 derniers retours sont affichés. Le journal WMS conserve tous les mouvements.
                </p>{/if}
            </details>{/if}
          <details class="text-xs text-ink-muted">
            <summary class="cursor-pointer">Traçabilité WMS</summary>
            <p class="mt-2 break-all">Sortie : {row.movementId}</p>
            {#if row.returnMovementId}<p class="break-all">Retour : {row.returnMovementId}</p>{/if}
          </details>
          {#if row.billingLocked && Number(row.remainingQuantity) > 0}<p
              class="rounded-md bg-surface-muted p-3 text-sm text-ink-muted"
            >
              Pièces liées à une facture. Pour corriger un brouillon, ouvrez-le depuis les travaux à
              facturer du projet, supprimez-le dans Facturation, puis effectuez le retour et
              préparez un nouveau brouillon. Pour une facture validée, préparez et validez un avoir
              dans Facturation, puis sélectionnez-le lors du retour physique.
            </p>{/if}
          {#if canWrite && job.project.status === 'ACTIVE' && Number(row.remainingQuantity) > 0 && (!row.billingLocked || row.creditReturnOptions.length > 0)}<Button
              variant="ghost"
              disabled={formOpen || busy || !!pending || !!storageError}
              onclick={() => start(row)}>Retourner une quantité</Button
            >{/if}
        </article>{/each}
    </div>{/if}
  <div class="flex flex-wrap items-center justify-end gap-2 text-sm">
    <span class="mr-auto text-ink-muted"
      >{total} consommation(s) · quantités par article, sans total mélangeant les unités</span
    ><Button
      variant="ghost"
      disabled={current === 1 || loading || busy || formOpen}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span>{current}/{Math.max(1, Math.ceil(total / 10))}</span><Button
      variant="ghost"
      disabled={current * 10 >= total || loading || busy || formOpen}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</section>
