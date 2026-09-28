<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { CURRENCIES, formatLedgerAmount } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    PageHeader,
    Card,
    Button,
    Field,
    Input,
    Select,
    Textarea,
    Table,
    Skeleton,
    ErrorNotice,
    EmptyState,
    Badge,
  } from '$lib/components/ui';
  import LedgerCurrencyEvidence from '$lib/components/billing/LedgerCurrencyEvidence.svelte';
  import {
    readQualificationIntent,
    rememberQualificationIntent,
    type QualificationIntent,
  } from '$lib/billing/qualification-intent';
  interface Entry {
    id: string;
    date: string;
    memo: string | null;
    currency: string | null;
    sourceType: string | null;
    blockedReason: string | null;
    currencyQualification: { state: string; currency: string | null; version: number } | null;
  }
  interface Detail extends Entry {
    anchorEntryId?: string | null;
    source?: {
      kind: 'PAYMENT' | 'CUSTOMER_INVOICE' | 'CARRIER_INVOICE' | 'FIXED_ASSET';
      id: string;
      number: string;
      currency: string | null;
      total: string;
      status: string;
      allocationCount?: number;
      allocatedAmount?: string;
      unallocatedAmount?: string;
      allocationState?: 'FULL' | 'PARTIAL';
      reversalId?: string | null;
      netAmount?: string;
      taxAmount?: string;
      name?: string;
      accumulatedAmount?: string;
      cost?: string;
      salvageValue?: string;
      recordedBookValue?: string;
      firstPeriod?: string;
      lastPeriod?: string;
      unrecordedMonthCount?: number;
      periods?: {
        period: string;
        amount: string;
        entryId: string;
        lines: { accountCode: string; accountType: string; debit: string; credit: string }[];
      }[];
      adjustment?: {
        carrierInvoiceNumber: string;
        acceptedAt: string;
        expectedLinesAmount: string;
        receivedLinesAmount: string;
        expectedTotalWithFrozenTax: string;
        payableAdjustment: string;
        reconciliationVariance: string;
        reconciliationGrossVariance: string;
      } | null;
      issuedCreditCount?: number;
      knownCreditCount?: number;
      withdrawBlockedReason?: string | null;
      entryIds: string[];
    } | null;
    lines: { id: string; debit: string; credit: string; account: { code: string; name: string } }[];
    history: {
      version: number;
      createdAt: string;
      actor: { firstName: string; lastName: string };
      snapshot: {
        state: string;
        currency: string | null;
        reason: string;
        evidence: { id: string; sha256: string; caption: string };
      };
    }[];
  }
  interface Review {
    reviewToken: string;
    snapshot: {
      state: string;
      currency: string | null;
      version: number;
      impact: {
        previousCurrency: string | null;
        nextCurrency: string | null;
        totalDebit: string;
        entryCount: number;
        groupTotal?: string;
      };
      evidence: { caption: string };
    };
  }
  const base = '/billing/ledger-qualification';
  const key = $derived(`pulsar:ledger-qualification:${$auth?.tenant.id}:${$auth?.user.id}`);
  const canQualify = $derived(!!$auth?.user.permissions.includes('billing.ledger.qualify'));
  let items = $state<Entry[]>([]),
    total = $state(0),
    listPage = $state(1),
    search = $state(''),
    loading = $state(true),
    error = $state('');
  let selected = $state(''),
    detail = $state<Detail | null>(null),
    detailLoading = $state(false),
    detailError = $state(''),
    busy = $state(false),
    evidenceBusy = $state(false),
    notice = $state('');
  let proofs = $state<{ id: string; caption: string }[]>([]),
    evidenceId = $state(''),
    currency = $state(''),
    reason = $state(''),
    review = $state<Review | null>(null),
    reviewedBody = $state<QualificationIntent['body'] | null>(null);
  let pending = $state<QualificationIntent | null>(null),
    storageError = $state('');
  const locked = $derived(busy || evidenceBusy || !!pending || !!storageError);
  const action = $derived(
    detail?.currencyQualification?.state === 'QUALIFIED' ? 'WITHDRAW' : 'QUALIFY',
  );
  const withdrawalBlocked = $derived(
    action === 'WITHDRAW' ? detail?.source?.withdrawBlockedReason : null,
  );
  const money = (v: string) => formatLedgerAmount(v);
  function label(e: Entry) {
    return e.currencyQualification?.state === 'QUALIFIED'
      ? `Qualifiée ${e.currencyQualification.currency}`
      : e.currencyQualification?.state === 'WITHDRAWN'
        ? 'Qualification retirée'
        : e.blockedReason
          ? 'Source métier'
          : 'À qualifier';
  }
  let listSeq = 0,
    detailSeq = 0;
  async function loadList() {
    const s = ++listSeq;
    loading = true;
    error = '';
    try {
      const r = await api<{ items: Entry[]; total: number }>(base, {
        query: { page: listPage, pageSize: 20, search },
      });
      if (s === listSeq) {
        items = r.items;
        total = r.total;
      }
    } catch (e) {
      if (s === listSeq) error = (e as Error).message;
    } finally {
      if (s === listSeq) loading = false;
    }
  }
  async function open(id: string) {
    const s = ++detailSeq;
    selected = id;
    detail = null;
    proofs = [];
    evidenceId = '';
    currency = '';
    reason = '';
    review = null;
    reviewedBody = null;
    detailError = '';
    detailLoading = true;
    try {
      const r = await api<Detail>(base + '/' + id);
      if (s === detailSeq) {
        detail = r;
        currency = r.source?.currency ?? '';
      }
    } catch (e) {
      if (s === detailSeq) detailError = (e as Error).message;
    } finally {
      if (s === detailSeq) {
        detailLoading = false;
        await tick();
        if (s === detailSeq && window.innerWidth < 1280)
          document.getElementById('qualification-dossier')?.scrollIntoView({ block: 'start' });
      }
    }
  }
  function invalidate() {
    review = null;
    reviewedBody = null;
  }
  async function prepare() {
    if (!detail || locked || !canQualify || withdrawalBlocked) return;
    busy = true;
    detailError = '';
    notice = '';
    invalidate();
    const d = {
      action: action as 'QUALIFY' | 'WITHDRAW',
      currency: action === 'WITHDRAW' ? '' : currency,
      reason,
      evidenceId,
      expectedVersion: detail.currencyQualification?.version ?? 0,
    };
    try {
      review = await api<Review>(base + '/' + detail.id + '/review', { method: 'POST', body: d });
      reviewedBody = {
        ...d,
        confirmed: true,
        reviewToken: review.reviewToken,
        operationKey: crypto.randomUUID(),
      };
    } catch (e) {
      detailError = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function send(p: QualificationIntent, recovering: boolean) {
    busy = true;
    detailError = '';
    notice = '';
    try {
      rememberQualificationIntent(key, p);
      pending = p;
      await api(base + '/' + p.entryId + '/confirm', { method: 'POST', body: p.body });
      localStorage.removeItem(key);
      pending = null;
      notice = 'Décision enregistrée. L’écriture originale est inchangée.';
      await Promise.all([loadList(), open(p.entryId)]);
    } catch (e) {
      detailError = (e as Error).message;
      if (!recovering && e instanceof ApiError && [400, 404, 409, 422].includes(e.statusCode)) {
        try {
          localStorage.removeItem(key);
          pending = null;
          invalidate();
        } catch {
          storageError = 'Impossible de réconcilier la demande locale.';
        }
      }
    } finally {
      busy = false;
    }
  }
  async function confirm() {
    if (!detail || !reviewedBody || locked || !canQualify) return;
    const p: QualificationIntent = { entryId: detail.id, body: { ...reviewedBody } };
    const yes = await confirmAction(
      action === 'QUALIFY'
        ? 'Les rapports et budgets incluront cette écriture dans la devise déclarée. Aucun montant original ne sera converti ou modifié.'
        : 'Les rapports et budgets excluront de nouveau cette écriture sans devise. Ceci n’est pas une contrepassation.',
      {
        title:
          action === 'QUALIFY'
            ? 'Confirmer la devise historique ?'
            : 'Retirer cette qualification ?',
        confirmLabel: 'Confirmer la décision',
      },
    );
    if (yes) await send(p, false);
  }
  async function reconcile() {
    if (!pending || busy) return;
    busy = true;
    detailError = '';
    try {
      await api(base + '/requests/' + pending.body.operationKey);
      const id = pending.entryId;
      localStorage.removeItem(key);
      pending = null;
      notice = 'Confirmation retrouvée; aucune décision ajoutée.';
      await Promise.all([loadList(), open(id)]);
    } catch (e) {
      detailError =
        e instanceof ApiError && e.statusCode === 404
          ? 'Aucune confirmation retrouvée. Vous pouvez reprendre exactement la même demande.'
          : (e as Error).message;
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    try {
      pending = readQualificationIntent(key);
    } catch (e) {
      storageError = (e as Error).message;
    }
    void loadList();
    const id = pending?.entryId ?? page.url.searchParams.get('entryId');
    if (id) void open(id);
  });
</script>

<svelte:head><title>Reprise du journal · Pulsar</title></svelte:head>
<PageHeader
  title="Reprise du journal"
  eyebrow="Finance · Historique"
  subtitle="Qualifier une devise sur preuve, sans réécrire l’écriture d’origine."
/>
<a
  class="mb-4 inline-block text-sm text-accent hover:underline"
  href="/billing/ledger?unqualified=true">Retour au grand livre</a
>
<div
  class="mb-5 rounded-lg border border-edge bg-surface-muted p-3 text-sm text-ink-muted"
  data-tour="ledger-qualification"
>
  Reprenez les écritures manuelles, les paiements avec leur contrepassation et les factures avec
  leurs avoirs, après rapprochement du dossier source. Les dotations historiques sont regroupées par
  immobilisation, sans reconstruire leur plan futur. La qualification actuelle s’applique aussi aux
  rapports et budgets des anciennes périodes; ce n’est ni une conversion ni une clôture comptable.
</div>
{#if storageError}<p role="alert" class="mb-4 text-danger">{storageError}</p>{/if}
{#if notice}<p role="status" class="mb-4 text-sm">{notice}</p>{/if}
{#if pending}<Card
    ><div class="space-y-3">
      <h2 class="font-semibold">Confirmation conservée</h2>
      <p class="text-sm text-ink-muted">
        Une réponse reste à vérifier. La même clé et la même décision sont conservées après
        rechargement; ne créez pas une nouvelle demande.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || evidenceBusy} onclick={reconcile}
          >Vérifier la confirmation</Button
        >{#if canQualify}<Button
            disabled={busy || evidenceBusy || !!storageError}
            onclick={() => {
              if (pending) void send(pending, true);
            }}>Reprendre la même demande</Button
          >{/if}
      </div>
    </div></Card
  >{/if}
<div class="mt-4 grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
  <section class="min-w-0 space-y-3" aria-label="Écritures historiques">
    <form
      class="flex items-end gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        listPage = 1;
        void loadList();
      }}
    >
      <div class="min-w-0 flex-1">
        <Field label="Rechercher dans les libellés"
          ><Input bind:value={search} disabled={locked} maxlength={200} /></Field
        >
      </div>
      <Button type="submit" variant="secondary" disabled={locked || loading}>Rechercher</Button>
    </form>
    <ErrorNotice message={error} onretry={loadList} />
    {#if loading}<Skeleton rows={5} />{:else if !error}
      {#each items as e (e.id)}<button
          class="block w-full rounded-lg border p-3 text-left transition-colors hover:bg-surface-muted disabled:opacity-60 {selected ===
          e.id
            ? 'border-accent bg-surface-muted'
            : 'border-edge bg-surface'}"
          disabled={locked}
          onclick={() => open(e.id)}
          ><span class="mb-1 block text-xs text-ink-muted">{e.date.slice(0, 10)} · {label(e)}</span
          ><span class="block break-words text-sm font-medium">{e.memo || 'Sans libellé'}</span
          ><span class="mt-1 block text-xs text-ink-muted"
            >{e.sourceType || 'Sans source attribuée'}</span
          ></button
        >{:else}<EmptyState
          title="Aucun historique trouvé"
          message="Aucune écriture sans devise originale ne correspond à cette recherche."
        />{/each}
      <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <Button
          variant="ghost"
          disabled={locked || listPage <= 1}
          onclick={() => {
            listPage--;
            void loadList();
          }}>Précédent</Button
        ><span>{total} écriture(s) · page {listPage}</span><Button
          variant="ghost"
          disabled={locked || listPage * 20 >= total}
          onclick={() => {
            listPage++;
            void loadList();
          }}>Suivant</Button
        >
      </div>
    {/if}
  </section>
  <section
    id="qualification-dossier"
    class="min-w-0 scroll-mt-24 space-y-4 {selected ? 'order-first xl:order-none' : ''}"
    aria-label="Dossier de qualification"
  >
    {#if selected}<div class="xl:hidden">
        <Button
          variant="ghost"
          disabled={locked}
          onclick={() => {
            detailSeq++;
            selected = '';
            detail = null;
            detailLoading = false;
            detailError = '';
            invalidate();
          }}>Choisir une autre écriture</Button
        >
      </div>{/if}
    <ErrorNotice message={detailError} />
    {#if detailLoading}<Skeleton rows={6} />{:else if detail}<Card
        ><div class="space-y-4">
          <div>
            <h2 class="break-words font-semibold">{detail.memo || 'Écriture historique'}</h2>
            <p class="mt-1 text-xs text-ink-muted">
              {detail.date.slice(0, 10)} · Devise originale : {detail.currency ?? 'non renseignée'} ·
              version de qualification {detail.currencyQualification?.version ?? 0}
            </p>
          </div>
          <Badge tone={detail.currencyQualification?.state === 'QUALIFIED' ? 'ok' : 'warn'}
            >{label(detail)}</Badge
          >
          {#if detail.source?.kind === 'PAYMENT'}
            <section
              class="space-y-3 rounded-lg bg-surface-muted p-4"
              aria-label="Rapprochement du paiement"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-semibold">Paiement {detail.source.number}</h3>
                <Badge tone="neutral"
                  >{detail.source.status === 'CANCELLED' ? 'Annulé' : 'Comptabilisé'}</Badge
                >
              </div>
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-ink-muted">Montant déclaré</dt>
                  <dd class="font-mono">{money(detail.source.total)} {detail.source.currency}</dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Affecté et comptabilisé</dt>
                  <dd class="font-mono">
                    {money(detail.source.allocatedAmount ?? detail.source.total)}
                    {detail.source.currency}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Reste non comptabilisé</dt>
                  <dd class="font-mono">
                    {money(detail.source.unallocatedAmount ?? '0')}
                    {detail.source.currency}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Affectations vérifiées</dt>
                  <dd>{detail.source.allocationCount}</dd>
                </div>
                <div class="col-span-2">
                  <dt class="text-ink-muted">Portée de la décision</dt>
                  <dd>
                    {detail.source.reversalId
                      ? 'Original et contrepassation, ensemble'
                      : 'Original et future contrepassation, si annulation'}
                  </dd>
                </div>
              </dl>
              {#if detail.source.allocationState === 'PARTIAL'}
                <div
                  class="space-y-1 rounded-md border border-edge p-3 text-sm"
                  role="note"
                  aria-label="Paiement partiellement affecté"
                >
                  <p class="font-medium">Reprise de la portion affectée seulement</p>
                  <p class="text-ink-muted">
                    Le reste de {money(detail.source.unallocatedAmount ?? '0')}
                    {detail.source.currency} demeure non comptabilisé. Ce n’est ni un crédit client, ni
                    une avance fournisseur, ni une preuve de mouvement bancaire. Le rapprochement bancaire
                    reste bloqué; aucune affectation n’est ajoutée.
                  </p>
                </div>
              {/if}
              <p class="text-xs text-ink-muted">
                Tiers, devise, total affecté et lignes du journal concordent. La preuve humaine
                reste obligatoire. Aucun solde de facture ne sera modifié.
              </p>
              <a class="text-sm text-accent hover:underline" href="/billing/payments"
                >Ouvrir le registre des paiements</a
              >
            </section>
          {:else if detail.source?.kind === 'FIXED_ASSET'}
            <section
              class="space-y-3 rounded-lg bg-surface-muted p-4"
              aria-label="Rapprochement de l’immobilisation"
            >
              <h3 class="font-semibold break-words">
                {detail.source.number} · {detail.source.name}
              </h3>
              <p class="text-sm text-ink-muted">
                Devise d’origine non renseignée : à attester sur preuve pour l’ensemble des
                dotations.
              </p>
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-ink-muted">Coût enregistré</dt>
                  <dd class="font-mono">{money(detail.source.cost ?? '0')}</dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Valeur résiduelle</dt>
                  <dd class="font-mono">{money(detail.source.salvageValue ?? '0')}</dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Cumul rapproché du journal</dt>
                  <dd class="font-mono">{money(detail.source.accumulatedAmount ?? '0')}</dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Dotations vérifiées</dt>
                  <dd>{detail.source.entryIds.length}</dd>
                </div>
              </dl>
              <p class="text-sm">
                Périodes enregistrées : {detail.source.firstPeriod} → {detail.source.lastPeriod}.
              </p>
              <div
                class="rounded-md border border-edge p-3 text-sm"
                role="note"
                aria-label="Plan futur non repris"
              >
                Seules les écritures de dotation déjà enregistrées peuvent être qualifiées,
                ensemble. Aucun plan futur, écriture d’acquisition, mois manquant ou nouveau montant
                n’est créé. Le registre d’immobilisations reste en lecture seule.
                {#if detail.source.unrecordedMonthCount}<p class="mt-2">
                    {detail.source.unrecordedMonthCount} mois sans dotation entre ces périodes : ils sont
                    signalés, jamais complétés automatiquement.
                  </p>{/if}
              </div>
              <details>
                <summary class="cursor-pointer text-sm">Voir les périodes conservées</summary>
                <ul class="mt-2 max-h-64 overflow-y-auto divide-y divide-edge text-sm">
                  {#each detail.source.periods ?? [] as p}<li class="py-2">
                      <div class="flex justify-between gap-3">
                        <span>{p.period}</span><span class="font-mono">{money(p.amount)}</span>
                      </div>
                      {#each p.lines as line}<p class="mt-1 text-xs text-ink-muted">
                          <span class="font-mono">{line.accountCode}</span> · {line.accountType ===
                          'EXPENSE'
                            ? 'Charge — débit'
                            : 'Cumul — crédit'}
                          {money(line.accountType === 'EXPENSE' ? line.debit : line.credit)}
                        </p>{/each}
                    </li>{/each}
                </ul>
              </details>
              <a
                class="text-sm text-accent hover:underline"
                href={`/billing/fixed-assets?assetId=${encodeURIComponent(detail.source.id)}`}
                >Ouvrir l’immobilisation</a
              >
            </section>
          {:else if detail.source}
            <section
              class="space-y-3 rounded-lg bg-surface-muted p-4"
              aria-label="Rapprochement de la facture"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-semibold">
                  Facture {detail.source.kind === 'CUSTOMER_INVOICE' ? 'client' : 'transporteur'}
                  {detail.source.number}
                </h3>
                <Badge tone="neutral">{detail.source.currency}</Badge>
              </div>
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-ink-muted">Montant hors taxes</dt>
                  <dd class="font-mono">
                    {money(detail.source.netAmount ?? '0')}
                    {detail.source.currency}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">Taxes figées</dt>
                  <dd class="font-mono">
                    {money(detail.source.taxAmount ?? '0')}
                    {detail.source.currency}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-muted">
                    {detail.source.adjustment ? 'Payable accepté' : 'Total original'}
                  </dt>
                  <dd class="font-mono">{money(detail.source.total)} {detail.source.currency}</dd>
                </div>
                <div>
                  <dt class="text-ink-muted">
                    {detail.source.adjustment
                      ? 'Acceptation historique'
                      : detail.source.kind === 'CUSTOMER_INVOICE'
                        ? 'Avoirs émis vérifiés'
                        : 'Écritures liées'}
                  </dt>
                  <dd>
                    {detail.source.adjustment
                      ? formatDateTime(detail.source.adjustment.acceptedAt)
                      : detail.source.kind === 'CUSTOMER_INVOICE'
                        ? (detail.source.issuedCreditCount ?? 0)
                        : detail.source.entryIds.length}
                  </dd>
                </div>
              </dl>
              {#if detail.source.adjustment}
                <div
                  class="space-y-3 rounded-md border border-edge p-3 text-sm"
                  role="note"
                  aria-label="Montant transporteur accepté"
                >
                  <div>
                    <h4 class="font-medium">Montant transporteur accepté après litige</h4>
                    <p class="mt-1 break-words text-ink-muted">
                      Pièce transporteur : {detail.source.adjustment.carrierInvoiceNumber}.
                      Acceptation du montant reçu retrouvée dans l’historique.
                    </p>
                  </div>
                  <dl class="grid grid-cols-2 gap-3">
                    <div>
                      <dt class="text-ink-muted">Lignes attendues conservées</dt>
                      <dd class="font-mono">
                        {money(detail.source.adjustment.expectedLinesAmount)}
                        {detail.source.currency}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-ink-muted">Lignes reçues capturées</dt>
                      <dd class="font-mono">
                        {money(detail.source.adjustment.receivedLinesAmount)}
                        {detail.source.currency}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-ink-muted">Attendu + taxes figées</dt>
                      <dd class="font-mono">
                        {money(detail.source.adjustment.expectedTotalWithFrozenTax)}
                        {detail.source.currency}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-ink-muted">Écart du payable</dt>
                      <dd class="font-mono">
                        {money(detail.source.adjustment.payableAdjustment)}
                        {detail.source.currency}
                      </dd>
                    </div>
                  </dl>
                  <p class="text-ink-muted">
                    Le journal correspond au payable accepté, pas aux anciennes lignes attendues.
                    Les taxes restent celles déjà capturées : aucune nouvelle ventilation, aucun
                    recalcul fiscal ni modification des montants. Le justificatif doit étayer ce
                    dossier ajusté.
                  </p>
                  <details class="text-ink-muted">
                    <summary class="cursor-pointer">Écarts du rapprochement historique</summary>
                    <p class="mt-2">
                      Net des écarts de lignes : {money(
                        detail.source.adjustment.reconciliationVariance,
                      )}
                      {detail.source.currency}; somme des écarts absolus : {money(
                        detail.source.adjustment.reconciliationGrossVariance,
                      )}
                      {detail.source.currency}. Ces valeurs comparent les lignes reçues aux lignes
                      attendues, sans ajouter les taxes figées.
                    </p>
                  </details>
                </div>
              {/if}
              <p class="text-xs text-ink-muted">
                {detail.source.entryIds.length} écriture(s) historique(s) sans devise à qualifier ensemble.
                {detail.source.adjustment
                  ? 'Tiers, payable accepté, taxes et comptes originaux concordent; les lignes attendues restent distinctes.'
                  : 'Tiers, lignes, taxes et comptes originaux concordent; la preuve humaine reste obligatoire.'}
                Aucun solde, taux ni montant n’est recalculé.
              </p>
              {#if detail.source.knownCreditCount}<p class="text-xs text-ink-muted">
                  {detail.source.knownCreditCount} avoir(s) à devise déjà connue, vérifié(s) mais non
                  modifié(s). Ils empêcheront le retrait isolé de cette qualification.
                </p>{/if}
              <a class="text-sm text-accent hover:underline" href="/invoices"
                >Ouvrir le registre des factures</a
              >
            </section>
          {/if}
          {#if detail.source?.kind === 'FIXED_ASSET'}<div>
              <h3 class="text-sm font-semibold">Première dotation — {detail.source.firstPeriod}</h3>
              <p class="text-xs text-ink-muted">
                Écriture d’ancrage du dossier. La décision couvre toutes les périodes listées
                ci-dessus.
              </p>
            </div>{/if}
          <Table
            >{#snippet head()}<th>Compte original</th><th>Débit</th><th>Crédit</th
              >{/snippet}{#snippet body()}{#each detail?.lines ?? [] as l (l.id)}<tr
                  ><td
                    ><span class="font-mono">{l.account.code}</span><span
                      class="block text-xs text-ink-muted">{l.account.name}</span
                    ></td
                  ><td class="font-mono">{l.debit}</td><td class="font-mono">{l.credit}</td></tr
                >{/each}{/snippet}</Table
          >
          {#if detail.blockedReason}<p
              class="rounded-md bg-surface-muted p-3 text-sm"
              role="status"
            >
              {detail.blockedReason}
            </p>{/if}
          {#if detail.anchorEntryId}<Button
              variant="secondary"
              disabled={locked}
              onclick={() => open(detail!.anchorEntryId!)}
              >{detail.sourceType === 'customer-credit'
                ? 'Revoir avec la facture originale'
                : detail.sourceType === 'depreciation'
                  ? 'Revoir toutes les dotations de l’immobilisation'
                  : 'Revoir avec le paiement original'}</Button
            >{/if}
          {#key detail.id}<LedgerCurrencyEvidence
              id={detail.id}
              status={detail.blockedReason ? 'BLOCKED' : 'ELIGIBLE'}
              disabled={busy || !!pending || !!storageError}
              bind:busy={evidenceBusy}
              onloaded={(r) => {
                proofs = r;
              }}
            />{/key}
          {#if withdrawalBlocked}<p role="status" class="rounded-md bg-surface-muted p-3 text-sm">
              {withdrawalBlocked}
            </p>{/if}
          {#if !detail.blockedReason && canQualify && !withdrawalBlocked}<div
              class="space-y-3 border-t border-edge pt-4"
            >
              <h3 class="font-semibold">
                {action === 'QUALIFY'
                  ? 'Déclarer la devise historique'
                  : 'Retirer la qualification actuelle'}
              </h3>
              {#if action === 'WITHDRAW'}<p class="text-sm text-ink-muted">
                  Retirez d’abord la qualification {detail.currencyQualification?.currency} avant de déclarer
                  une autre devise. L’historique et les preuves restent conservés.
                </p>{:else if detail.source?.currency}<Field
                  label={detail.source.kind === 'PAYMENT'
                    ? 'Devise du paiement source'
                    : 'Devise de la facture source'}
                  ><Input value={detail.source.currency} readonly /></Field
                >
                <p class="text-xs text-ink-muted">
                  La reprise ne convertit pas le dossier. Sa devise doit être attestée par la
                  preuve.
                </p>{:else}<Field label="Devise attestée"
                  ><Select bind:value={currency} disabled={locked} onchange={invalidate}
                    ><option value="">Choisir explicitement</option>{#each CURRENCIES as c}<option
                        value={c.code}>{c.code}</option
                      >{/each}</Select
                  ></Field
                >{/if}
              <Field label="Preuve de la décision"
                ><Select bind:value={evidenceId} disabled={locked} onchange={invalidate}
                  ><option value="">Choisir un justificatif conservé</option
                  >{#each proofs as p}<option value={p.id}>{p.caption}</option>{/each}</Select
                ></Field
              >
              <Field label="Motif documenté (10 caractères minimum)"
                ><Textarea
                  bind:value={reason}
                  maxlength={2000}
                  disabled={locked}
                  oninput={invalidate}
                /></Field
              >
              <Button
                variant="secondary"
                disabled={locked ||
                  !evidenceId ||
                  reason.trim().length < 10 ||
                  (action === 'QUALIFY' && !currency)}
                onclick={prepare}>Préparer la revue</Button
              >
              {#if review}<div
                  class="space-y-3 rounded-lg border border-accent p-4"
                  aria-label="Revue de qualification"
                  role="region"
                >
                  <h3 class="font-semibold">Effet de la décision</h3>
                  <p class="text-sm">
                    {review.snapshot.impact.previousCurrency ?? 'Exclue : devise inconnue'} → {review
                      .snapshot.impact.nextCurrency ?? 'Exclue : qualification retirée'}
                  </p>
                  <p class="text-sm">
                    {detail.source?.kind === 'FIXED_ASSET'
                      ? 'Première écriture — débit et crédit équilibrés'
                      : 'Débit et crédit équilibrés'} : {money(review.snapshot.impact.totalDebit)}.
                    Montants, dates et comptes d’origine inchangés.
                  </p>
                  <p class="text-sm text-ink-muted">Preuve : {review.snapshot.evidence.caption}</p>
                  {#if detail.source?.kind === 'FIXED_ASSET'}<p
                      class="rounded-md bg-surface-muted p-3 text-sm"
                    >
                      La décision couvre {detail.source.entryIds.length} dotations, pour un cumul de {money(
                        review.snapshot.impact.groupTotal ?? '0',
                      )}
                      {review.snapshot.currency ?? detail.currencyQualification?.currency}. Aucun
                      plan futur n’est activé; les données d’origine restent inchangées.
                    </p>{/if}
                  {#if detail.source?.adjustment}
                    <p class="text-sm">
                      La décision porte sur le payable accepté de {money(detail.source.total)}
                      {detail.source.currency}. L’écart de {money(
                        detail.source.adjustment.payableAdjustment,
                      )}
                      {detail.source.currency} avec l’attendu taxes figées incluses ne produit aucune
                      écriture complémentaire.
                    </p>
                  {/if}
                  {#if detail.source?.kind === 'PAYMENT' && detail.source.allocationState === 'PARTIAL'}
                    <p class="rounded-md bg-surface-muted p-3 text-sm">
                      Seuls {money(detail.source.allocatedAmount ?? '0')}
                      {detail.source.currency} déjà comptabilisés sont concernés. Le reste déclaré de
                      {money(detail.source.unallocatedAmount ?? '0')}
                      {detail.source.currency} ne sera ni comptabilisé ni affecté aux factures.
                    </p>
                  {/if}
                  {#if detail.source}<p class="text-sm">
                      {review.snapshot.impact.entryCount} écriture(s) existante(s) concernée(s).
                      {#if detail.source.kind === 'PAYMENT'}Une annulation ultérieure reprendra la
                        qualification de l’original; un retrait les exclura ensemble des rapports.
                      {:else if detail.source.kind === 'FIXED_ASSET'}Le retrait exclura toutes ces
                        dotations ensemble, sans contrepassation et sans modifier le cumul de
                        l’actif.
                      {:else if detail.source.kind === 'CUSTOMER_INVOICE'}La facture et ses avoirs
                        historiques seront qualifiés ensemble. Un nouvel avoir gardera une devise
                        connue et empêchera le retrait isolé de la qualification.
                      {:else}Seule la devise du journal transporteur existant est qualifiée. Aucun
                        payable, taxe ou règlement n’est modifié.{/if}
                    </p>{/if}
                  <Button disabled={locked} onclick={confirm}>Confirmer après revue</Button>
                </div>{/if}
            </div>{:else if !canQualify}<p class="text-sm text-ink-muted">
              Lecture seule. Le droit spécifique de qualification du journal est requis pour déposer
              une preuve et confirmer une décision.
            </p>{/if}
        </div></Card
      >
      {#if detail.history.length}<Card
          ><h2 class="mb-3 font-semibold">Historique des décisions</h2>
          <ol class="divide-y divide-edge">
            {#each detail.history as h (h.version)}<li class="space-y-1 py-3 text-sm">
                <p class="font-medium">
                  Version {h.version} · {h.snapshot.state === 'QUALIFIED'
                    ? 'Qualification ' + h.snapshot.currency
                    : 'Qualification retirée'}
                </p>
                <p class="whitespace-pre-wrap break-words">{h.snapshot.reason}</p>
                <p class="text-xs text-ink-muted">
                  {formatDateTime(h.createdAt)} · {h.actor.firstName}
                  {h.actor.lastName}
                </p>
                <p class="text-xs text-ink-muted">Preuve : {h.snapshot.evidence.caption}</p>
              </li>{/each}
          </ol>
          <p class="mt-2 text-xs text-ink-muted">
            Les 30 dernières décisions. Les versions antérieures restent conservées dans le
            registre.
          </p></Card
        >{/if}
    {:else if !detailError}<Card
        ><EmptyState
          title="Sélectionnez une écriture"
          message="Examinez les lignes d’origine, conservez votre justificatif puis préparez la revue avant confirmation."
        /></Card
      >{/if}
  </section>
</div>
