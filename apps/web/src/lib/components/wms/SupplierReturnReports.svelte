<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Input, Textarea, Select, Skeleton } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';
  import {
    SUPPLIER_RETURN_QUANTITY,
    deriveSupplierReturnBalance,
    supplierReturnDecreased,
    type Paginated,
    type SupplierReturnReportInput,
    type SupplierReturnReportView,
  } from '@pulsar/shared';
  import {
    readSupplierReportIntent,
    rememberSupplierReportIntent,
  } from '$lib/wms/supplier-report-intent';
  let {
    id,
    quantity,
    unit,
    disabled = false,
    busy = $bindable(false),
  }: { id: string; quantity: string; unit: string; disabled?: boolean; busy?: boolean } = $props();
  type Response = {
    current: SupplierReturnReportView | null;
    revision: number;
    balance: { awaitingReceipt: string; awaitingDecision: string };
    history: Paginated<SupplierReturnReportView>;
  };
  type Proof = { id: string; caption: string; document: { fileName: string } };
  const key = $derived(`pulsar:supplier-report:${$auth?.tenant.id}:${$auth?.user.id}:${id}`);
  const canManage = $derived(
    (['wms.manage', 'wms.stock.return'] as const).every((p) => $auth?.user.permissions.includes(p)),
  );
  let data = $state<Response | null>(null),
    proofs = $state<Proof[]>([]),
    pending = $state<SupplierReturnReportInput | null>(null),
    page = $state(1);
  let loading = $state(true),
    editing = $state(false),
    error = $state(''),
    storageError = $state(''),
    notice = $state('');
  let received = $state('0'),
    accepted = $state('0'),
    refused = $state('0'),
    evidenceId = $state(''),
    reference = $state(''),
    note = $state(''),
    correctionReason = $state(''),
    reportedAt = $state('');
  let expectedRevision = $state(0);
  let generation = 0;
  $effect(() => {
    void id;
    try {
      pending = readSupplierReportIntent(key);
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
    void load(1);
  });
  async function load(next = page) {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const [r, p] = await Promise.all([
        api<Response>(`/wms/stock-exits/${id}/supplier-reports`, {
          query: { page: next, pageSize: 5 },
        }),
        api<Proof[]>(`/wms/stock-exits/${id}/evidence`),
      ]);
      if (g === generation) {
        data = r;
        proofs = p;
        page = next;
      }
    } catch (e) {
      if (g === generation) {
        data = null;
        error = (e as Error).message;
      }
    } finally {
      if (g === generation) loading = false;
    }
  }
  async function open() {
    await load(1);
    if (!data) return;
    received = data.current?.received ?? '0';
    accepted = data.current?.accepted ?? '0';
    refused = data.current?.refused ?? '0';
    expectedRevision = data.revision;
    evidenceId = '';
    reference = '';
    note = '';
    correctionReason = '';
    // Explicit UTC input avoids interpreting a daylight-saving overlap in the browser's zone.
    reportedAt = new Date().toISOString().slice(0, 23);
    editing = true;
    notice = '';
  }
  const validation = $derived.by(() => {
    try {
      const totals = { received, accepted, refused };
      const balance = deriveSupplierReturnBalance(quantity, totals);
      const date = new Date(`${reportedAt}Z`);
      const correction =
        !!data?.current &&
        (supplierReturnDecreased(data.current, totals) || date < new Date(data.current.reportedAt));
      return { balance, correction, error: '' };
    } catch (e) {
      return { balance: null, correction: false, error: (e as Error).message };
    }
  });
  function clear() {
    localStorage.removeItem(key);
    pending = null;
    editing = false;
  }
  async function submit(reconcile = false) {
    if (busy || disabled || storageError || !canManage) return;
    const recovering = !!pending;
    busy = true;
    error = '';
    notice = '';
    try {
      const p = pending ?? {
        operationKey: crypto.randomUUID(),
        expectedRevision,
        received,
        accepted,
        refused,
        evidenceId,
        reportedAt: new Date(`${reportedAt}Z`).toISOString(),
        reference,
        note,
        ...(correctionReason.trim() ? { correctionReason } : {}),
      };
      rememberSupplierReportIntent(key, p);
      pending = p;
      const r = await api<{ id: string; revision: number; replayed: boolean }>(
        `/wms/stock-exits/${id}/supplier-reports${reconcile ? `/requests/${p.operationKey}` : ''}`,
        reconcile ? {} : { method: 'POST', body: p },
      );
      if (r.revision !== p.expectedRevision + 1)
        throw Error('Confirmation incohérente. Faites vérifier le suivi.');
      clear();
      notice = r.replayed
        ? 'Déclaration déjà enregistrée : aucune copie ajoutée.'
        : 'Suivi fournisseur enregistré. Stock et finance inchangés.';
      await load(1);
    } catch (e) {
      error =
        e instanceof ApiError && e.statusCode === 404 && reconcile
          ? 'Aucune déclaration confirmée. Reprenez exactement la même demande.'
          : (e as Error).message;
      if (
        !recovering &&
        e instanceof ApiError &&
        e.statusCode >= 400 &&
        e.statusCode < 500 &&
        ![401, 408, 429].includes(e.statusCode)
      ) {
        try {
          localStorage.removeItem(key);
          pending = null;
        } catch {
          storageError = 'Impossible de réconcilier la demande locale.';
        }
      }
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-4 border-t border-edge pt-4" aria-label="Suivi chez le fournisseur">
  <div>
    <h3 class="font-semibold">Suivi chez le fournisseur</h3>
    <p class="mt-1 text-xs text-ink-muted">
      Déclaré par votre équipe, à partir d’un justificatif. L’acceptation porte sur le retour, pas
      sur un avoir. Aucune remise en stock ni écriture financière.
    </p>
  </div>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
  {#if loading}<Skeleton rows={3} />{:else if data}
    <dl
      class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-surface-muted p-3 text-sm tabular-nums"
    >
      <div>
        <dt class="text-xs text-ink-muted">Sorti physiquement</dt>
        <dd class="font-medium">{quantity} {unit}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Réception encore attendue</dt>
        <dd class="font-medium">{data.balance.awaitingReceipt} {unit}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Reçu chez le fournisseur</dt>
        <dd>{data.current?.received ?? '0'} {unit}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Décision encore attendue</dt>
        <dd>{data.balance.awaitingDecision} {unit}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Accepté</dt>
        <dd>{data.current?.accepted ?? '0'} {unit}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Refusé</dt>
        <dd>{data.current?.refused ?? '0'} {unit}</dd>
      </div>
    </dl>
    {#if !data.current}<p class="text-sm text-ink-muted">
        Aucun constat fournisseur. Une sortie enregistrée ne prouve pas sa réception : ajoutez un
        justificatif ci-dessus, puis consignez le retour reçu.
      </p>{/if}
    {#if pending}
      <div class="space-y-2 rounded-lg border border-edge p-3">
        <p class="text-sm">
          Déclaration en attente de confirmation : reçus {pending.received}, acceptés {pending.accepted},
          refusés {pending.refused}
          {unit}. Le corps et la clé d’origine sont conservés.
        </p>
        {#if canManage}<div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy || disabled || !!storageError}
              onclick={() => submit(true)}>Vérifier la déclaration</Button
            ><Button
              variant="ghost"
              disabled={busy || disabled || !!storageError}
              onclick={() => submit()}>Reprendre la même déclaration</Button
            >
          </div>{/if}
      </div>
    {:else if canManage && !editing}<Button
        variant="secondary"
        disabled={busy || disabled || !!storageError}
        onclick={open}
        >{data.current
          ? 'Actualiser le suivi fournisseur'
          : 'Consigner le constat fournisseur'}</Button
      >{/if}
    {#if editing && !pending && canManage}
      <form
        class="space-y-3 rounded-lg border border-edge p-3"
        onsubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p class="text-sm font-medium">
          Cumuls depuis le début du retour · version {expectedRevision}
        </p>
        <p class="text-xs text-ink-muted">
          Entrez les totaux, pas seulement les quantités de cette livraison. Un refus ne remet rien
          dans l’entrepôt.
        </p>
        <fieldset disabled={busy || disabled} class="space-y-3">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={`Total reçu (${unit})`}
              ><Input
                bind:value={received}
                inputmode="decimal"
                pattern={SUPPLIER_RETURN_QUANTITY.source}
                required
              /></Field
            >
            <Field label={`Total accepté (${unit})`}
              ><Input
                bind:value={accepted}
                inputmode="decimal"
                pattern={SUPPLIER_RETURN_QUANTITY.source}
                required
              /></Field
            >
            <Field label={`Total refusé (${unit})`}
              ><Input
                bind:value={refused}
                inputmode="decimal"
                pattern={SUPPLIER_RETURN_QUANTITY.source}
                required
              /></Field
            >
          </div>
          {#if validation.error}<p role="alert" class="text-sm text-danger">
              {validation.error}
            </p>{:else if validation.balance}<p class="text-xs text-ink-muted">
              Resteraient à recevoir : {validation.balance.awaitingReceipt}
              {unit} · à décider : {validation.balance.awaitingDecision}
              {unit}.
            </p>{/if}
          <Field label="Date et heure du constat (UTC)"
            ><Input type="datetime-local" step="0.001" bind:value={reportedAt} required /></Field
          >
          <p class="text-xs text-ink-muted">
            Dans votre fuseau : {formatDateTime(`${reportedAt}Z`)}. La date d’enregistrement sera
            conservée séparément.
          </p>
          <Field label="Référence du constat fournisseur"
            ><Input bind:value={reference} maxlength={200} minlength={3} required /></Field
          >
          <Field label="Justificatif du constat"
            ><Select bind:value={evidenceId} required
              ><option value="">Choisir une pièce du dossier</option>{#each proofs as proof}<option
                  value={proof.id}>{proof.caption} — {proof.document.fileName}</option
                >{/each}</Select
            ></Field
          >
          {#if !proofs.length}<p class="text-sm text-ink-muted">
              Conservez d’abord un justificatif dans la section au-dessus, puis rouvrez ce
              formulaire.
            </p>{/if}
          <Field label="Compte rendu fournisseur"
            ><Textarea bind:value={note} maxlength={2000} /></Field
          >
          <Field
            label={validation.correction
              ? 'Motif de correction (obligatoire)'
              : 'Motif de correction (si applicable)'}
            ><Textarea bind:value={correctionReason} maxlength={1000} /></Field
          >
          <p class="text-xs text-ink-muted">
            Une baisse de cumul ou une date antérieure exige un motif. L’historique reste intact.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!!validation.error ||
                !evidenceId ||
                note.trim().length < 10 ||
                reference.trim().length < 3 ||
                (validation.correction && correctionReason.trim().length < 10) ||
                (!!correctionReason && correctionReason.trim().length < 10)}
              >Enregistrer le constat</Button
            ><Button
              variant="ghost"
              onclick={() => {
                editing = false;
              }}>Annuler la saisie</Button
            >
          </div>
        </fieldset>
      </form>
    {/if}
    {#if data.history.total > 0}<details class="border-t border-edge pt-3">
        <summary class="cursor-pointer text-sm font-medium"
          >Historique des constats ({data.history.total})</summary
        >
        <ol class="mt-2 divide-y divide-edge">
          {#each data.history.items as row (row.id)}<li class="space-y-1 py-3 text-sm">
              <p class="font-medium break-words">Version {row.revision} · {row.reference}</p>
              <p class="tabular-nums">
                Reçus {row.received} · acceptés {row.accepted} · refusés {row.refused}
                {unit}
              </p>
              <p class="text-xs text-ink-muted">
                Constat : {formatDateTime(row.reportedAt)} · consigné : {formatDateTime(
                  row.createdAt,
                )} par {row.createdBy.firstName}
                {row.createdBy.lastName}
              </p>
              <p class="whitespace-pre-wrap break-words">{row.note}</p>
              {#if row.correctionReason}<p class="whitespace-pre-wrap break-words">
                  Correction : {row.correctionReason}
                </p>{/if}
              <p class="text-xs text-ink-muted break-words">
                Pièce du dossier : {proofs.find((p) => p.id === row.evidenceId)?.document
                  .fileName ?? 'Consulter les justificatifs'}
              </p>
            </li>{/each}
        </ol>
        {#if data.history.total > 5}<div class="flex items-center gap-3">
            <Button variant="ghost" disabled={page === 1 || busy} onclick={() => load(page - 1)}
              >Précédent</Button
            ><span class="text-xs">Page {page}</span><Button
              variant="ghost"
              disabled={page * 5 >= data.history.total || busy}
              onclick={() => load(page + 1)}>Suivant</Button
            >
          </div>{/if}
      </details>{/if}
  {:else}<Button variant="secondary" disabled={busy} onclick={() => load()}
      >Recharger le suivi</Button
    >{/if}
</section>
