<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import {
    Button,
    Field,
    Input,
    Select,
    Textarea,
    Skeleton,
    EntityPicker,
  } from '$lib/components/ui';
  import SupplierCreditEvidence from './SupplierCreditEvidence.svelte';
  import { formatDate, formatDateTime, formatMoney } from '$lib/format';
  import {
    validateSupplierCredit,
    supplierCreditTotals,
    type SupplierCreditInput,
    type supplierCreditBalance,
    type Paginated,
  } from '@pulsar/shared';
  import {
    readSupplierCreditIntent,
    rememberSupplierCreditIntent,
    type SupplierCreditIntent,
  } from '$lib/billing/supplier-credit-intent';
  let {
    invoice,
    initialCreditId = '',
    active = $bindable(false),
  }: {
    invoice: {
      id: string;
      currency: string;
      invoiceDate: string;
      lines: { id: string; description: string; netAmount: string }[];
      taxes: { label: string; amount: string }[];
    };
    active?: boolean;
    initialCreditId?: string;
  } = $props();
  let busy = $state(false);
  type Row = {
    id: string;
    number: string;
    externalNumber: string;
    status: string;
    totalAmount: string;
    creditDate: string;
    updatedAt: string;
  };
  type Detail = Row &
    SupplierCreditInput & {
      netAmount: string;
      taxAmount: string;
      closedAt: string | null;
      originalEvidenceId: string | null;
      qualificationNote: string | null;
      hasReturnLink: boolean;
      returnVisible: boolean;
      returnSnapshot?: {
        number: string;
        revision: number;
        accepted: string;
        received: string;
        refused: string;
        unit: string;
        reference: string;
        reportedAt: string;
      };
      operations: {
        kind: string;
        createdAt: string;
        actor: { firstName: string; lastName: string };
      }[];
    };
  const base = '/billing/supplier-credits';
  const labels: Record<string, string> = {
    DRAFT: 'Brouillon',
    QUALIFIED: 'Qualifié — figé',
    CANCELLED: 'Annulé',
    CREATED: 'Création',
    UPDATED: 'Modification',
  };
  const canManage = $derived(!!$auth?.user.permissions.includes('billing.supplier-credits.manage'));
  const canQualify = $derived(
    !!$auth?.user.permissions.includes('billing.supplier-credits.qualify'),
  );
  const canWms = $derived(
    !!$auth?.tenant.enabledModules.includes('wms') &&
      !!$auth?.user.permissions.includes('wms.read'),
  );
  const storageKey = $derived(
    `pulsar:supplier-credit:${$auth?.tenant.id}:${$auth?.user.id}:${invoice.id}`,
  );
  const blank = (): SupplierCreditInput => ({
    invoiceId: invoice.id,
    externalNumber: '',
    creditDate: '',
    reason: '',
    lines: invoice.lines.map((l) => ({ invoiceLineId: l.id, netAmount: '0' })),
    taxes: invoice.taxes.map((t, position) => ({ position, amount: '0' })),
  });
  let rows = $state<Row[]>([]),
    balance = $state<ReturnType<typeof supplierCreditBalance> | null>(null),
    page = $state(1),
    total = $state(0),
    loading = $state(true),
    error = $state(''),
    notice = $state('');
  let open = $state(false),
    detail = $state<Detail | null>(null),
    form = $state<SupplierCreditInput>(blank()),
    saved = $state(''),
    loadingDetail = $state(false),
    failedId = $state(''),
    fileBusy = $state(false);
  let pending = $state<SupplierCreditIntent | null>(null),
    storageError = $state(''),
    mode = $state<'' | 'qualify' | 'cancel'>(''),
    note = $state(''),
    confirmed = $state(false),
    evidenceId = $state(''),
    returnLabel = $state('');
  let evidence = $state<{ id: string; caption: string; document: { fileName: string } }[]>([]);
  const dirty = $derived(!!detail && JSON.stringify(form) !== saved);
  const inaccessible = $derived(!!detail?.hasReturnLink && !detail.returnVisible);
  const locked = $derived(
    busy || fileBusy || loading || !!pending || !!storageError || loadingDetail || !!failedId,
  );
  const editable = $derived(canManage && (!detail || detail.status === 'DRAFT') && !inaccessible);
  const totals = $derived.by(() => {
    try {
      return supplierCreditTotals(form);
    } catch {
      return null;
    }
  });
  let generation = 0;
  let openedLink = '';
  let linkedPanel = $state<HTMLElement>();
  $effect(() => {
    if (initialCreditId && initialCreditId !== openedLink) {
      openedLink = initialCreditId;
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(initialCreditId))
        untrack(
          () =>
            void inspect(initialCreditId).then(async () => {
              await tick();
              linkedPanel?.focus({ preventScroll: true });
              linkedPanel?.scrollIntoView({ block: 'start' });
            }),
        );
      else error = 'Lien d’avoir invalide.';
    }
  });
  $effect(() => {
    active = busy || fileBusy || loadingDetail;
  });
  $effect(() => {
    void storageKey;
    try {
      pending = readSupplierCreditIntent(storageKey);
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
    void load();
  });
  async function load() {
    const g = ++generation;
    loading = true;
    try {
      const r = await api<Paginated<Row> & { balance: NonNullable<typeof balance> }>(
        `${base}/invoice/${invoice.id}`,
        { query: { page, pageSize: 10 } },
      );
      if (g === generation) {
        rows = r.items;
        total = r.total;
        balance = r.balance;
      }
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  function resetClose() {
    mode = '';
    note = '';
    confirmed = false;
    evidenceId = '';
  }
  function create() {
    detail = null;
    failedId = '';
    form = blank();
    returnLabel = '';
    evidence = [];
    resetClose();
    error = '';
    open = true;
  }
  async function inspect(id: string) {
    open = true;
    loadingDetail = true;
    failedId = '';
    error = '';
    resetClose();
    try {
      const r = await api<Detail>(`${base}/${id}`);
      if (r.invoiceId !== invoice.id) throw Error('Cet avoir appartient à une autre facture.');
      detail = r;
      form = {
        invoiceId: r.invoiceId,
        externalNumber: r.externalNumber,
        creditDate: r.creditDate.slice(0, 10),
        reason: r.reason,
        lines: invoice.lines.map((l) => ({
          invoiceLineId: l.id,
          netAmount: r.lines.find((c) => c.invoiceLineId === l.id)?.netAmount ?? '0',
        })),
        taxes: invoice.taxes.map((t, position) => ({
          position,
          amount: r.taxes.find((c) => c.position === position)?.amount ?? '0',
        })),
        ...(r.returnReportId ? { returnReportId: r.returnReportId } : {}),
      };
      saved = JSON.stringify(form);
      returnLabel = r.returnSnapshot
        ? `${r.returnSnapshot.number} · révision ${r.returnSnapshot.revision}`
        : '';
      evidence = [];
    } catch (e) {
      detail = null;
      failedId = id;
      error = (e as Error).message;
    } finally {
      loadingDetail = false;
    }
  }
  function clear() {
    localStorage.removeItem(storageKey);
    pending = null;
  }
  async function execute(p: SupplierCreditIntent, replay = false) {
    if (busy || fileBusy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      rememberSupplierCreditIntent(storageKey, p);
      pending = p;
      const r = await api<{ id: string }>(p.path, { method: p.method, body: p.body });
      clear();
      notice = 'Avoir enregistré. Aucun paiement ni mouvement de stock.';
      await inspect(r.id);
      await load();
    } catch (e) {
      if (
        !replay &&
        e instanceof ApiError &&
        e.statusCode >= 400 &&
        e.statusCode < 500 &&
        ![401, 408, 429].includes(e.statusCode)
      )
        clear();
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function verify() {
    if (!pending || busy) return;
    busy = true;
    error = '';
    try {
      const r = await api<{ id: string }>(`${base}/requests/${pending.body.operationKey}`);
      clear();
      notice = 'Demande retrouvée, sans nouvel envoi.';
      await inspect(r.id);
      await load();
    } catch (e) {
      error =
        e instanceof ApiError && e.statusCode === 404
          ? 'Demande non retrouvée. Reprenez exactement la même demande.'
          : (e as Error).message;
    } finally {
      busy = false;
    }
  }
  function save() {
    try {
      validateSupplierCredit(form);
      const body = {
        ...form,
        operationKey: crypto.randomUUID(),
        ...(detail ? { expectedUpdatedAt: detail.updatedAt } : {}),
      };
      void execute({
        method: detail ? 'PUT' : 'POST',
        path: detail ? `${base}/${detail.id}` : base,
        body,
      });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  function closeDocument() {
    if (!detail || !mode || dirty || !confirmed) return;
    void execute({
      method: 'POST',
      path: `${base}/${detail.id}/${mode}`,
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: detail.updatedAt,
        note,
        ...(mode === 'qualify' ? { evidenceId } : {}),
      },
    });
  }
</script>

<section aria-label="Avoirs fournisseur" class="space-y-4 border-t border-edge pt-5">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="font-semibold">Avoirs fournisseur</h3>
    {#if canManage}<Button variant="secondary" disabled={locked} onclick={create}
        >Saisir un avoir reçu</Button
      >{/if}
  </div>
  <p class="text-sm text-ink-muted">
    Réductions documentées de cette facture. Le reste créditable n’est pas un solde à payer. Aucun
    retour, remboursement ou écrit comptable n’est créé.
  </p>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if pending}<div class="space-y-2 rounded-lg border border-warning/40 p-3">
      <p class="text-sm">
        Une demande d’avoir attend confirmation. Aucune nouvelle saisie avant vérification.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || fileBusy} onclick={verify}
          >Vérifier la demande d’avoir</Button
        ><Button
          variant="ghost"
          disabled={busy || fileBusy}
          onclick={() => {
            if (pending) void execute(pending, true);
          }}>Reprendre le même avoir</Button
        >
      </div>
    </div>{/if}
  {#if loading}<Skeleton rows={2} />{:else if balance}<dl
      class="grid grid-cols-1 gap-3 rounded-lg bg-surface-raised p-3 text-sm sm:grid-cols-3"
    >
      <div>
        <dt class="text-ink-muted">Facture originale</dt>
        <dd class="font-medium tabular-nums">{formatMoney(balance.original, invoice.currency)}</dd>
      </div>
      <div>
        <dt class="text-ink-muted">Avoirs qualifiés</dt>
        <dd class="font-medium tabular-nums">{formatMoney(balance.credited, invoice.currency)}</dd>
      </div>
      <div>
        <dt class="text-ink-muted">Reste créditable</dt>
        <dd class="font-semibold tabular-nums">
          {formatMoney(balance.remaining, invoice.currency)}
        </dd>
      </div>
    </dl>{/if}
  <Button variant="ghost" disabled={locked} onclick={load}>Actualiser les avoirs</Button>
  {#if !loading && !rows.length}<p class="text-sm text-ink-muted">
      Aucun avoir reçu enregistré. Saisissez uniquement un document effectivement transmis par le
      fournisseur.
    </p>{/if}
  <ul class="divide-y divide-edge">
    {#each rows as r}<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <div>
          <p class="font-medium">{r.number} · {r.externalNumber}</p>
          <p class="text-ink-muted">
            {labels[r.status]} · {formatDate(r.creditDate.slice(0, 10))} · {formatMoney(
              r.totalAmount,
              invoice.currency,
            )}
          </p>
        </div>
        <Button variant="ghost" disabled={locked} onclick={() => inspect(r.id)}
          >Ouvrir {r.number}</Button
        >
      </li>{/each}
  </ul>
  {#if total > 10}<div class="flex items-center gap-2">
      <Button
        variant="ghost"
        disabled={locked || page === 1}
        onclick={() => {
          page--;
          void load();
        }}>Précédent</Button
      ><span class="text-xs">{page} / {Math.ceil(total / 10)}</span><Button
        variant="ghost"
        disabled={locked || page * 10 >= total}
        onclick={() => {
          page++;
          void load();
        }}>Suivant</Button
      >
    </div>{/if}
  {#if open}<section
      bind:this={linkedPanel}
      tabindex="-1"
      aria-label="Dossier avoir fournisseur"
      class="space-y-4 rounded-lg border border-edge p-3 sm:p-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold">
          {loadingDetail
            ? 'Chargement de l’avoir…'
            : failedId
              ? 'Avoir à recharger'
              : detail
                ? `${detail.number} · ${labels[detail.status]}`
                : 'Nouvel avoir reçu'}
        </h4>
        <Button
          variant="ghost"
          disabled={locked}
          onclick={() => {
            open = false;
          }}>Fermer l’avoir</Button
        >
      </div>
      {#if loadingDetail}<Skeleton rows={4} />{:else if failedId}<p class="text-sm">
          Le dossier n’a pas pu être chargé.
        </p>
        <Button variant="secondary" onclick={() => inspect(failedId)}>Recharger l’avoir</Button
        >{:else}
        {#if inaccessible}<p class="text-sm text-warning">
            Le contexte de retour est masqué sans accès WMS. Lecture financière conservée; aucune
            modification ou qualification du lien.
          </p>{/if}
        {#if editable}<form
            class="space-y-3"
            onsubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset class="space-y-3" disabled={locked || !!mode}>
              <div class="grid gap-3 sm:grid-cols-2">
                <Field label="Numéro de l’avoir fournisseur"
                  ><Input bind:value={form.externalNumber} required maxlength={100} /></Field
                ><Field label="Date de l’avoir"
                  ><Input
                    type="date"
                    bind:value={form.creditDate}
                    min={invoice.invoiceDate.slice(0, 10)}
                    required
                  /></Field
                >
              </div>
              <Field label="Motif de l’avoir"
                ><Textarea
                  bind:value={form.reason}
                  required
                  minlength={10}
                  maxlength={2000}
                /></Field
              >
              <p class="text-xs text-ink-muted">
                Montants positifs à retrancher, après remises. Laissez 0 sur les lignes non
                concernées. Aucune quantité physique n’est déduite.
              </p>
              {#each form.lines as l, i}<div class="space-y-1">
                  <Field label={`Crédit net — ${invoice.lines[i].description}`}
                    ><Input bind:value={l.netAmount} inputmode="decimal" required /></Field
                  >
                  <p class="text-xs text-ink-muted">
                    Original : {formatMoney(invoice.lines[i].netAmount, invoice.currency)} · reste qualifiable
                    : {formatMoney(
                      balance?.lines.find((b) => b.invoiceLineId === l.invoiceLineId)?.remaining ??
                        '0',
                      invoice.currency,
                    )}
                  </p>
                </div>{/each}
              {#each form.taxes as t}<Field
                  label={`Crédit taxe ${t.position + 1} — ${invoice.taxes[t.position].label}`}
                  ><Input bind:value={t.amount} inputmode="decimal" required /></Field
                >{/each}
              {#if canWms}<EntityPicker
                  label="Suivi de retour WMS (facultatif)"
                  endpoint={`${base}/returns/${invoice.id}`}
                  bind:value={
                    () => form.returnReportId ?? '',
                    (v) => {
                      form.returnReportId = v || undefined;
                    }
                  }
                  selectedLabel={returnLabel}
                  onselect={(r) => (returnLabel = String(r.name))}
                  disabled={locked || !!mode}
                  detailKey="detail"
                />{/if}
              {#if totals}<p class="font-medium tabular-nums">
                  Total de l’avoir : {formatMoney(totals.totalAmount, invoice.currency)}
                </p>{/if}
            </fieldset>
            <Button type="submit" disabled={locked || !!mode}
              >{detail ? 'Enregistrer l’avoir' : 'Créer le brouillon d’avoir'}</Button
            >
          </form>
        {:else if detail}<div class="space-y-2 text-sm">
            <p>{detail.externalNumber} · {formatDate(detail.creditDate.slice(0, 10))}</p>
            <p class="whitespace-pre-wrap break-words">{detail.reason}</p>
            {#each detail.lines as l}<p>
                {invoice.lines.find((i) => i.id === l.invoiceLineId)?.description} : {formatMoney(
                  l.netAmount,
                  invoice.currency,
                )}
              </p>{/each}{#each detail.taxes as t}<p>
                {invoice.taxes[t.position]?.label} : {formatMoney(t.amount, invoice.currency)}
              </p>{/each}
            <p class="font-semibold">Total : {formatMoney(detail.totalAmount, invoice.currency)}</p>
          </div>{/if}
        {#if detail?.returnSnapshot}<p class="text-xs text-ink-muted">
            Contexte capturé : {detail.returnSnapshot.number}, révision {detail.returnSnapshot
              .revision} · reçu {detail.returnSnapshot.received}, accepté {detail.returnSnapshot
              .accepted}, refusé {detail.returnSnapshot.refused}
            {detail.returnSnapshot.unit}. Aucun montant calculé depuis ces quantités.
          </p>{/if}
        {#if detail}{#key detail.id}<SupplierCreditEvidence
              id={detail.id}
              status={detail.status}
              disabled={busy || !!pending || !!mode || inaccessible}
              bind:busy={fileBusy}
              onloaded={(r) => (evidence = r)}
            />{/key}
          {#if detail.status === 'DRAFT' && !inaccessible}
            {#if dirty}<p class="text-sm text-warning">
                Enregistrez les modifications avant de qualifier ou annuler l’avoir.
              </p>{/if}
            <div class="flex flex-wrap gap-2">
              {#if canQualify}<Button
                  variant="secondary"
                  disabled={locked || dirty}
                  onclick={() => {
                    resetClose();
                    mode = 'qualify';
                  }}>Préparer la qualification de l’avoir</Button
                >{/if}{#if canManage}<Button
                  variant="ghost"
                  disabled={locked || dirty}
                  onclick={() => {
                    resetClose();
                    mode = 'cancel';
                  }}>Annuler le brouillon d’avoir</Button
                >{/if}
            </div>
            {#if mode}<form
                class="space-y-3 border-t border-edge pt-3"
                onsubmit={(e) => {
                  e.preventDefault();
                  closeDocument();
                }}
              >
                <p class="text-sm">
                  {detail.externalNumber} · montant enregistré {formatMoney(
                    detail.totalAmount,
                    invoice.currency,
                  )}. Le solde sera revérifié lors de la confirmation.
                </p>
                {#if mode === 'qualify'}<Field label="Original de l’avoir reçu"
                    ><Select bind:value={evidenceId} required disabled={locked}
                      ><option value="">Choisir l’original…</option>{#each evidence as f}<option
                          value={f.id}>{f.document.fileName} — {f.caption}</option
                        >{/each}</Select
                    ></Field
                  >{/if}
                <Field label="Compte rendu de l’avoir"
                  ><Textarea
                    bind:value={note}
                    required
                    minlength={10}
                    maxlength={2000}
                    disabled={locked}
                  /></Field
                >
                <label class="flex items-start gap-2 text-sm"
                  ><input type="checkbox" bind:checked={confirmed} disabled={locked} /><span
                    >{mode === 'qualify'
                      ? 'Je confirme les montants et l’original reçu. Cet avoir sera figé, sans paiement ni comptabilisation.'
                      : 'Je confirme l’annulation de ce brouillon; numéro et preuves seront conservés.'}</span
                  ></label
                >
                <div class="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={locked ||
                      dirty ||
                      !confirmed ||
                      note.trim().length < 10 ||
                      (mode === 'qualify' && !evidenceId)}
                    >{mode === 'qualify'
                      ? 'Confirmer l’avoir qualifié'
                      : 'Confirmer l’annulation de l’avoir'}</Button
                  ><Button variant="ghost" disabled={locked} onclick={resetClose}
                    >Revenir à l’avoir</Button
                  >
                </div>
              </form>{/if}
          {:else if detail.closedAt}<p class="text-sm">
              {labels[detail.status]} · {formatDateTime(detail.closedAt)}
            </p>
            <p class="text-sm whitespace-pre-wrap break-words">{detail.qualificationNote}</p>
            {#if detail.originalEvidenceId}<p class="text-sm">
                Original : {evidence.find((f) => f.id === detail?.originalEvidenceId)?.document
                  .fileName ?? 'Voir les pièces de l’avoir.'}
              </p>{/if}{/if}
          <details class="text-xs">
            <summary class="cursor-pointer py-2"
              >Historique de l’avoir (30 dernières opérations)</summary
            >{#each detail.operations as op}<p class="py-1">
                {labels[op.kind]} · {op.actor.firstName}
                {op.actor.lastName} · {formatDateTime(op.createdAt)}
              </p>{/each}
          </details>
        {/if}
      {/if}
    </section>{/if}
</section>
