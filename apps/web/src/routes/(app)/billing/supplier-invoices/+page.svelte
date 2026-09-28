<script lang="ts">
  import { untrack } from 'svelte';
  import { page as route } from '$app/stores';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Drawer,
    Field,
    Input,
    Select,
    Textarea,
    Table,
    Skeleton,
    EntityPicker,
  } from '$lib/components/ui';
  import SupplierInvoiceEvidence from '$lib/components/billing/SupplierInvoiceEvidence.svelte';
  import SupplierCredits from '$lib/components/billing/SupplierCredits.svelte';
  import { formatDate, formatDateTime, formatMoney } from '$lib/format';
  import {
    CURRENCIES,
    SUPPLIER_INVOICE_AMOUNT,
    SUPPLIER_INVOICE_QUANTITY,
    supplierInvoiceTotals,
    validateSupplierInvoice,
    type SupplierInvoiceInput,
    type Paginated,
  } from '@pulsar/shared';
  import {
    readSupplierInvoiceIntent,
    rememberSupplierInvoiceIntent,
    type SupplierInvoiceIntent,
  } from '$lib/billing/supplier-invoice-intent';

  const base = '/billing/supplier-invoices';
  type Row = {
    id: string;
    number: string;
    externalNumber: string;
    supplierSnapshot: { name: string; code: string };
    invoiceDate: string;
    dueDate: string | null;
    currency: string;
    totalAmount: string;
    status: string;
    updatedAt: string;
  };
  type Detail = Row &
    Omit<SupplierInvoiceInput, 'lines' | 'dueDate'> & {
      dueDate: string | null;
      netAmount: string;
      taxAmount: string;
      originalEvidenceId: string | null;
      qualificationNote: string | null;
      closedAt: string | null;
      purchaseVisible: boolean;
      lines: (SupplierInvoiceInput['lines'][number] & {
        id: string;
        hasPurchaseLink: boolean;
        purchaseSnapshot?: {
          orderNumber: string;
          description: string;
          quantity: string;
          unit: string;
          unitPrice: string;
          currency: string;
        };
      })[];
      operations: {
        kind: string;
        createdAt: string;
        actor: { firstName: string; lastName: string };
      }[];
    };
  const canRead = $derived(!!$auth?.user.permissions.includes('billing.supplier-invoices.read'));
  const canManage = $derived(
    !!$auth?.user.permissions.includes('billing.supplier-invoices.manage'),
  );
  const canQualify = $derived(
    !!$auth?.user.permissions.includes('billing.supplier-invoices.qualify'),
  );
  const canPurchase = $derived(
    !!$auth?.tenant.enabledModules.includes('purchasing') &&
      !!$auth?.user.permissions.includes('purchasing.read'),
  );
  const storageKey = $derived(`pulsar:supplier-invoice:${$auth?.tenant.id}:${$auth?.user.id}`);
  const labels: Record<string, string> = {
    DRAFT: 'Brouillon',
    QUALIFIED: 'Qualifiée — document figé',
    CANCELLED: 'Annulée',
    CREATED: 'Création',
    UPDATED: 'Modification',
  };
  const blank = (): SupplierInvoiceInput => ({
    supplierId: '',
    externalNumber: '',
    invoiceDate: '',
    currency: 'CAD',
    notes: '',
    lines: [{ description: '', quantity: '1', unit: 'unité', netAmount: '' }],
    taxes: [],
  });
  let form = $state<SupplierInvoiceInput>(blank()),
    supplierLabel = $state(''),
    sourceLabels = $state<Record<number, string>>({});
  let savedForm = $state('');
  let failedDetailId = $state('');
  let rows = $state<Row[]>([]),
    page = $state(1),
    total = $state(0),
    search = $state(''),
    loading = $state(true),
    error = $state(''),
    notice = $state('');
  let open = $state(false),
    detail = $state<Detail | null>(null),
    detailLoading = $state(false),
    busy = $state(false),
    fileBusy = $state(false);
  let creditBusy = $state(false);
  let pending = $state<SupplierInvoiceIntent | null>(null),
    storageError = $state(''),
    closeMode = $state<'' | 'qualify' | 'cancel'>(''),
    closeNote = $state(''),
    confirmed = $state(false),
    evidenceId = $state('');
  let evidence = $state<{ id: string; caption: string; document: { fileName: string } }[]>([]);
  const dirty = $derived(!!detail && JSON.stringify(form) !== savedForm);
  const missingSourceAccess = $derived(
    !!detail?.lines.some((l) => l.hasPurchaseLink) && !detail?.purchaseVisible,
  );
  const locked = $derived(
    busy ||
      fileBusy ||
      creditBusy ||
      !!pending ||
      !!storageError ||
      detailLoading ||
      !!failedDetailId,
  );
  const editable = $derived(
    canManage && (!detail || detail.status === 'DRAFT') && !missingSourceAccess,
  );
  const totals = $derived.by(() => {
    try {
      return supplierInvoiceTotals(form);
    } catch {
      return null;
    }
  });
  let generation = 0;
  let openedLink = '';
  const linkedInvoice = $derived($route.url.searchParams.get('invoiceId') ?? '');
  const linkedCredit = $derived($route.url.searchParams.get('creditId') ?? '');
  $effect(() => {
    const id = linkedInvoice;
    const key = `${$auth?.tenant.id}:${id}:${linkedCredit}`;
    if (canRead && id && key !== openedLink) {
      openedLink = key;
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) untrack(() => void inspect(id));
      else error = 'Lien de facture invalide.';
    }
  });
  $effect(() => {
    void storageKey;
    try {
      pending = readSupplierInvoiceIntent(storageKey);
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
    if (canRead) void load();
    else loading = false;
  });
  async function load() {
    const g = ++generation;
    loading = true;
    try {
      const r = await api<Paginated<Row>>(base, { query: { page, pageSize: 20, search } });
      if (g === generation) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  function resetClose() {
    closeMode = '';
    closeNote = '';
    confirmed = false;
    evidenceId = '';
  }
  function create() {
    failedDetailId = '';
    detail = null;
    form = blank();
    supplierLabel = '';
    sourceLabels = {};
    evidence = [];
    error = '';
    resetClose();
    open = true;
  }
  async function inspect(id: string) {
    failedDetailId = '';
    open = true;
    detailLoading = true;
    error = '';
    resetClose();
    evidence = [];
    try {
      const d = await api<Detail>(`${base}/${id}`);
      detail = d;
      form = {
        supplierId: d.supplierId,
        externalNumber: d.externalNumber,
        invoiceDate: d.invoiceDate.slice(0, 10),
        dueDate: d.dueDate?.slice(0, 10),
        currency: d.currency,
        notes: d.notes,
        taxes: d.taxes.map((t) => ({ ...t })),
        lines: d.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          netAmount: l.netAmount,
          ...(l.purchaseLineId ? { purchaseLineId: l.purchaseLineId } : {}),
        })),
      };
      supplierLabel = d.supplierSnapshot.name;
      savedForm = JSON.stringify(form);
      sourceLabels = Object.fromEntries(
        d.lines.map((l, i) => [
          i,
          l.purchaseSnapshot
            ? `${l.purchaseSnapshot.orderNumber} · ${l.purchaseSnapshot.description}`
            : '',
        ]),
      );
    } catch (e) {
      error = (e as Error).message;
      detail = null;
      failedDetailId = id;
    } finally {
      detailLoading = false;
    }
  }
  function clearPending() {
    localStorage.removeItem(storageKey);
    pending = null;
  }
  async function execute(p: SupplierInvoiceIntent, recovering = false) {
    if (busy || fileBusy || storageError) return;
    busy = true;
    error = '';
    notice = '';
    try {
      rememberSupplierInvoiceIntent(storageKey, p);
      pending = p;
      const r = await api<{ id: string }>(p.path, { method: p.method, body: p.body });
      clearPending();
      notice = 'Dossier enregistré. Aucun stock, paiement ou écriture comptable créé.';
      await inspect(r.id);
      await load();
    } catch (e) {
      error = (e as Error).message;
      if (
        !recovering &&
        e instanceof ApiError &&
        e.statusCode >= 400 &&
        e.statusCode < 500 &&
        ![401, 408, 429].includes(e.statusCode)
      )
        try {
          clearPending();
        } catch {
          storageError =
            'Impossible de réconcilier la demande locale. Faites vérifier le registre.';
        }
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
      clearPending();
      notice = 'Enregistrement retrouvé, aucun renvoi.';
      await inspect(r.id);
      await load();
    } catch (e) {
      error =
        e instanceof ApiError && e.statusCode === 404
          ? 'Aucune demande confirmée. Vous pouvez reprendre exactement la demande conservée.'
          : (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (locked || !editable) return;
    form.lines = form.lines.map((l) => ({ ...l, purchaseLineId: l.purchaseLineId || undefined }));
    try {
      validateSupplierInvoice(form);
    } catch (e) {
      error = (e as Error).message;
      return;
    }
    await execute({
      path: detail ? `${base}/${detail.id}` : base,
      method: detail ? 'PUT' : 'POST',
      body: {
        ...$state.snapshot(form),
        operationKey: crypto.randomUUID(),
        ...(detail ? { expectedUpdatedAt: detail.updatedAt } : {}),
      },
    });
  }
  async function closeDocument() {
    if (!detail || !closeMode || !confirmed || locked) return;
    await execute({
      path: `${base}/${detail.id}/${closeMode}`,
      method: 'POST',
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: detail.updatedAt,
        note: closeNote,
        ...(closeMode === 'qualify' ? { evidenceId } : {}),
      },
    });
  }
</script>

{#snippet recovery()}
  {#if pending}<div
      class="space-y-2 rounded-lg border border-warning/40 bg-surface-muted p-3"
      role="status"
    >
      <p class="text-sm">
        Une demande attend confirmation. Son contenu et sa clé sont conservés après rechargement;
        aucune nouvelle demande tant qu’elle n’est pas vérifiée.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || fileBusy} onclick={verify}
          >Vérifier la demande</Button
        ><Button
          variant="secondary"
          disabled={busy || fileBusy || !!storageError}
          onclick={() => {
            if (pending) void execute(pending, true);
          }}>Reprendre la même demande</Button
        >
      </div>
    </div>{/if}
{/snippet}

<div class="space-y-5" data-tour="supplier-invoice-register">
  <PageHeader
    title="Factures fournisseur"
    subtitle="Conserver les factures reçues, vérifier leurs lignes et figer leur source documentaire."
  >
    {#snippet actions()}{#if canManage}<Button disabled={locked} onclick={create}
          >Saisir une facture</Button
        >{/if}{/snippet}
  </PageHeader>
  {#if !canRead}<p role="alert">Le droit de lecture des factures fournisseur est requis.</p>{:else}
    <p class="text-sm text-ink-muted">
      Registre documentaire distinct des factures transporteur. Qualifiée ne signifie pas
      comptabilisée ou payée.
    </p>
    {#if error && !open}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
    {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
    {#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
    {#if !open}{@render recovery()}{/if}
    <form
      class="flex flex-wrap items-end gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        page = 1;
        void load();
      }}
    >
      <div class="min-w-0 flex-1">
        <Field label="Rechercher une facture"
          ><Input
            bind:value={search}
            placeholder="Numéro, référence fournisseur ou fournisseur"
          /></Field
        >
      </div>
      <Button type="submit" variant="secondary" disabled={loading}>Rechercher</Button>
      <Button href="/billing/data" variant="ghost">Fournisseurs et données</Button>
    </form>
    {#if loading}<Skeleton rows={5} />{:else if !rows.length}<div
        class="rounded-xl border border-edge p-8 text-center"
      >
        <h2 class="font-semibold">Aucune facture dans ce registre</h2>
        <p class="mt-2 text-sm text-ink-muted">
          Saisissez le document reçu, même sans commande d’achat ou module Entrepôt.
        </p>
      </div>{:else}
      <Table
        >{#snippet head()}<th>Dossier / facture reçue</th><th>Fournisseur</th><th
            >Date / échéance</th
          ><th>Total déclaré</th><th>État</th><th><span class="sr-only">Ouvrir</span></th>{/snippet}
        {#snippet body()}{#each rows as row (row.id)}<tr
              ><td
                ><span class="font-medium">{row.number}</span>
                <p class="text-xs text-ink-muted break-words">{row.externalNumber}</p></td
              ><td>{row.supplierSnapshot.name}</td><td
                >{formatDate(row.invoiceDate.slice(0, 10))}
                <p class="text-xs text-ink-muted">{formatDate(row.dueDate?.slice(0, 10))}</p></td
              ><td class="whitespace-nowrap tabular-nums"
                >{formatMoney(row.totalAmount, row.currency)}</td
              ><td>{labels[row.status]}</td><td
                ><Button variant="ghost" onclick={() => inspect(row.id)}>Ouvrir {row.number}</Button
                ></td
              ></tr
            >{/each}{/snippet}</Table
      >
      <div class="flex items-center justify-between gap-2 text-sm">
        <span>{total} facture(s) · page {page}</span>
        <div class="flex gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1 || loading}
            onclick={() => {
              page--;
              void load();
            }}>Précédent</Button
          ><Button
            variant="secondary"
            disabled={page * 20 >= total || loading}
            onclick={() => {
              page++;
              void load();
            }}>Suivant</Button
          >
        </div>
      </div>
    {/if}
  {/if}
</div>

<Drawer
  bind:open
  width="xl"
  title={detail ? `${detail.number} · ${labels[detail.status]}` : 'Saisir une facture fournisseur'}
  dismissible={!busy && !fileBusy && !creditBusy && !detailLoading}
>
  <div class="space-y-5 min-w-0">
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
    {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
    {@render recovery()}
    {#if detailLoading}<Skeleton rows={8} />{:else if failedDetailId}
      <p class="text-sm text-ink-muted">
        Le dossier n’a pas pu être chargé. Aucune nouvelle facture ne sera créée à partir de cet
        écran incomplet.
      </p>
      <Button variant="secondary" onclick={() => inspect(failedDetailId)}
        >Recharger le dossier</Button
      >
    {:else}
      {#if missingSourceAccess}<p class="rounded-lg bg-surface-muted p-3 text-sm">
          Ce dossier possède des liens Achats non accessibles. La facture reste lisible; ses sources
          commerciales sont masquées et sa modification est bloquée.
        </p>{/if}
      {#if editable}
        <form
          class="space-y-5"
          onsubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={locked || !!closeMode} class="space-y-5 min-w-0">
            <EntityPicker
              endpoint="/billing/data/suppliers"
              label="Fournisseur"
              bind:value={form.supplierId}
              selectedLabel={supplierLabel}
              onselect={(item) => {
                supplierLabel = String(item.name);
              }}
              disabled={locked || !!closeMode}
            />
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Numéro de la facture reçue"
                ><Input bind:value={form.externalNumber} required maxlength={100} /></Field
              >
              <Field label="Devise"
                ><Select bind:value={form.currency}
                  >{#each CURRENCIES as c}<option value={c.code}>{c.code} — {c.name}</option
                    >{/each}</Select
                ></Field
              >
              <Field label="Date de facture (date civile)"
                ><Input
                  type="date"
                  bind:value={form.invoiceDate}
                  required
                  min="1900-01-01"
                  max="2199-12-31"
                /></Field
              >
              <Field label="Échéance (facultative)"
                ><Input
                  type="date"
                  value={form.dueDate ?? ''}
                  oninput={(e) => (form.dueDate = e.currentTarget.value || undefined)}
                  min={form.invoiceDate || '1900-01-01'}
                  max="2199-12-31"
                /></Field
              >
            </div>
            <section class="space-y-3" aria-label="Lignes de facture">
              <h3 class="font-semibold">Lignes reçues</h3>
              <p class="text-xs text-ink-muted">
                Recopiez le montant net de chaque ligne après remises. Aucun prix ni taxe n’est
                déduit d’une commande.
              </p>
              {#each form.lines as line, i}<div
                  class="space-y-3 rounded-lg border border-edge p-3 min-w-0"
                >
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-medium">Ligne {i + 1}</h4>
                    <Button
                      variant="ghost"
                      disabled={locked || form.lines.length <= 1}
                      onclick={() => {
                        form.lines = form.lines.filter((_, j) => j !== i);
                        sourceLabels = {};
                      }}>Retirer ligne {i + 1}</Button
                    >
                  </div>
                  <Field label={`Description ligne ${i + 1}`}
                    ><Input bind:value={line.description} required maxlength={500} /></Field
                  >
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label={`Quantité ligne ${i + 1}`}
                      ><Input
                        bind:value={line.quantity}
                        inputmode="decimal"
                        required
                        pattern={SUPPLIER_INVOICE_QUANTITY.source}
                      /></Field
                    ><Field label={`Unité ligne ${i + 1}`}
                      ><Input bind:value={line.unit} required maxlength={30} /></Field
                    ><Field label={`Net ligne ${i + 1} (${form.currency})`}
                      ><Input
                        bind:value={line.netAmount}
                        inputmode="decimal"
                        required
                        pattern={SUPPLIER_INVOICE_AMOUNT.source}
                      /></Field
                    >
                  </div>
                  {#if canPurchase && form.supplierId}<EntityPicker
                      endpoint={`${base}/sources/${form.supplierId}`}
                      label={`Ligne d’achat liée ${i + 1} (facultative)`}
                      labelKey="nameSnapshot"
                      detailKey="sourceLabel"
                      bind:value={
                        () => line.purchaseLineId ?? '',
                        (value) => {
                          line.purchaseLineId = value || undefined;
                        }
                      }
                      selectedLabel={sourceLabels[i] || ''}
                      disabled={locked || !!closeMode}
                      onselect={(item) => {
                        sourceLabels[i] = String(item.sourceLabel ?? item.nameSnapshot);
                      }}
                    />{/if}
                  {#if line.purchaseLineId}<Button
                      variant="ghost"
                      disabled={locked}
                      onclick={() => {
                        line.purchaseLineId = undefined;
                        sourceLabels[i] = '';
                      }}>Retirer le lien d’achat</Button
                    >{/if}
                </div>{/each}
              <Button
                variant="secondary"
                disabled={locked || form.lines.length >= 100}
                onclick={() => {
                  form.lines.push({ description: '', quantity: '1', unit: 'unité', netAmount: '' });
                }}>Ajouter une ligne</Button
              >
            </section>
            <section class="space-y-3" aria-label="Taxes déclarées">
              <h3 class="font-semibold">Taxes déclarées</h3>
              <p class="text-xs text-ink-muted">
                Montants figurant sur la facture, sans déduction fiscale ni juridiction supposée.
                Aucune taxe = total égal au net.
              </p>
              {#each form.taxes as tax, i}<div
                  class="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <Field label={`Libellé taxe ${i + 1}`}
                    ><Input bind:value={tax.label} required maxlength={100} /></Field
                  ><Field label={`Montant taxe ${i + 1}`}
                    ><Input
                      bind:value={tax.amount}
                      required
                      inputmode="decimal"
                      pattern={SUPPLIER_INVOICE_AMOUNT.source}
                    /></Field
                  ><Button
                    variant="ghost"
                    onclick={() => {
                      form.taxes = form.taxes.filter((_, j) => j !== i);
                    }}>Retirer taxe {i + 1}</Button
                  >
                </div>{/each}
              <Button
                variant="secondary"
                disabled={locked || form.taxes.length >= 20}
                onclick={() => {
                  form.taxes.push({ label: '', amount: '' });
                }}>Ajouter une taxe déclarée</Button
              >
            </section>
            <Field label="Notes de vérification"
              ><Textarea bind:value={form.notes} maxlength={4000} /></Field
            >
            {#if totals}<div class="rounded-lg bg-surface-muted p-3 text-sm space-y-1">
                <p>Net : {formatMoney(totals.netAmount, form.currency)}</p>
                <p>Taxes : {formatMoney(totals.taxAmount, form.currency)}</p>
                <p class="font-semibold">
                  Total déclaré : {formatMoney(totals.totalAmount, form.currency)}
                </p>
              </div>{/if}
          </fieldset>
          <Button type="submit" disabled={locked || !!closeMode || !form.supplierId}
            >{detail ? 'Enregistrer le brouillon' : 'Créer le brouillon'}</Button
          >
        </form>
      {:else if detail}
        <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-ink-muted">Fournisseur capturé</dt>
            <dd>{detail.supplierSnapshot.name} · {detail.supplierSnapshot.code}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Facture reçue</dt>
            <dd>{detail.externalNumber}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Date civile</dt>
            <dd>{formatDate(detail.invoiceDate.slice(0, 10))}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Échéance civile</dt>
            <dd>{formatDate(detail.dueDate?.slice(0, 10))}</dd>
          </div>
        </dl>
        <ul class="divide-y divide-edge">
          {#each detail.lines as l}<li class="py-3 text-sm break-words">
              <p class="font-medium">{l.description}</p>
              <p>{l.quantity} {l.unit} · net {formatMoney(l.netAmount, detail.currency)}</p>
              {#if l.purchaseSnapshot}<p class="mt-1 text-xs text-ink-muted">
                  Achat capturé : {l.purchaseSnapshot.orderNumber} · {l.purchaseSnapshot.quantity}
                  {l.purchaseSnapshot.unit} à {l.purchaseSnapshot.unitPrice}
                  {l.purchaseSnapshot.currency} par unité. Lien documentaire, pas un rapprochement validé.
                </p>{/if}
            </li>{/each}
        </ul>
        {#each detail.taxes as t}<p class="text-sm">
            {t.label} : {formatMoney(t.amount, detail.currency)}
          </p>{/each}
        <p class="font-semibold">
          Total déclaré : {formatMoney(detail.totalAmount, detail.currency)}
        </p>
        {#if detail.notes}<p class="text-sm whitespace-pre-wrap break-words">{detail.notes}</p>{/if}
      {/if}
      {#if detail}
        {#key detail.id}<SupplierInvoiceEvidence
            id={detail.id}
            status={detail.status}
            disabled={busy || !!pending || !!closeMode}
            bind:busy={fileBusy}
            onloaded={(r) => (evidence = r)}
          />{/key}
        {#if detail.status === 'DRAFT' && !missingSourceAccess}
          <section
            class="space-y-3 border-t border-edge pt-4"
            aria-label="Qualification documentaire"
          >
            <h3 class="font-semibold">Vérifier le document enregistré</h3>
            <p class="text-sm text-ink-muted">
              Enregistrez vos changements puis actualisez pour les relire. La qualification fige les
              lignes enregistrées et l’original choisi; ce n’est ni une approbation de paiement ni
              une écriture comptable.
            </p>
            {#if dirty}<p class="text-sm text-warning">
                Modifications non enregistrées : enregistrez le brouillon avant de le qualifier ou
                de l’annuler.
              </p>{/if}
            <div class="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={locked}
                onclick={() => {
                  if (detail) void inspect(detail.id);
                }}>Actualiser le dossier</Button
              >{#if canQualify}<Button
                  variant="secondary"
                  disabled={locked || dirty}
                  onclick={() => {
                    resetClose();
                    closeMode = 'qualify';
                  }}>Préparer la qualification</Button
                >{/if}{#if canManage}<Button
                  variant="ghost"
                  disabled={locked || dirty}
                  onclick={() => {
                    resetClose();
                    closeMode = 'cancel';
                  }}>Annuler ce brouillon</Button
                >{/if}
            </div>
            {#if closeMode}<form
                class="space-y-3 rounded-lg border border-edge p-3"
                onsubmit={(e) => {
                  e.preventDefault();
                  void closeDocument();
                }}
              >
                <p class="text-sm font-medium">
                  {detail.externalNumber} · total enregistré {formatMoney(
                    detail.totalAmount,
                    detail.currency,
                  )}
                </p>
                {#if closeMode === 'qualify'}<Field label="Document original reçu"
                    ><Select bind:value={evidenceId} required disabled={locked}
                      ><option value="">Choisir explicitement l’original…</option
                      >{#each evidence as f}<option value={f.id}
                          >{f.document.fileName} — {f.caption}</option
                        >{/each}</Select
                    ></Field
                  >{/if}
                <Field
                  label={closeMode === 'qualify'
                    ? 'Compte rendu de vérification'
                    : 'Motif d’annulation'}
                  ><Textarea
                    bind:value={closeNote}
                    required
                    minlength={10}
                    maxlength={2000}
                    disabled={locked}
                  /></Field
                >
                <label class="flex items-start gap-2 text-sm"
                  ><input type="checkbox" bind:checked={confirmed} disabled={locked} /><span
                    >{closeMode === 'qualify'
                      ? 'J’ai vérifié le fournisseur, le numéro, les lignes enregistrées, les taxes et l’original reçu. Je confirme leur gel documentaire, sans paiement.'
                      : 'Je confirme l’annulation de ce brouillon. Son numéro et ses pièces resteront conservés.'}</span
                  ></label
                >
                <div class="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={locked ||
                      !confirmed ||
                      closeNote.trim().length < 10 ||
                      (closeMode === 'qualify' && !evidenceId)}
                    >{closeMode === 'qualify'
                      ? 'Confirmer la qualification'
                      : 'Confirmer l’annulation'}</Button
                  ><Button variant="ghost" disabled={locked} onclick={resetClose}
                    >Revenir à la saisie</Button
                  >
                </div>
              </form>{/if}
          </section>
        {:else if detail.closedAt}<section class="space-y-2 border-t border-edge pt-4">
            <h3 class="font-semibold">{labels[detail.status]}</h3>
            <p class="text-xs text-ink-muted">{formatDateTime(detail.closedAt)}</p>
            <p class="text-sm whitespace-pre-wrap break-words">{detail.qualificationNote}</p>
            {#if detail.originalEvidenceId}<p class="text-sm">
                Original : {evidence.find((f) => f.id === detail?.originalEvidenceId)?.document
                  .fileName ?? 'Consultez les pièces du dossier.'}
              </p>{/if}
          </section>{/if}
        {#if detail.status === 'QUALIFIED'}
          <Button
            href={`/billing/suppliers/${detail.supplierId}`}
            variant="secondary"
            disabled={creditBusy || busy || fileBusy}>Dossier du fournisseur</Button
          >
          <Button
            href={`/billing/supplier-schedules?invoiceId=${detail.id}`}
            variant="secondary"
            disabled={creditBusy || busy || fileBusy}>Échéancier de la facture</Button
          >
          {#key detail.id}<SupplierCredits
              invoice={detail}
              initialCreditId={detail.id === linkedInvoice ? linkedCredit : ''}
              bind:active={creditBusy}
            />{/key}
        {/if}
        <section class="space-y-2 border-t border-edge pt-4">
          <h3 class="font-semibold">Historique récent</h3>
          <p class="text-xs text-ink-muted">
            30 dernières opérations. Les reprises identiques ne créent pas une nouvelle opération.
          </p>
          {#each detail.operations as op}<p class="text-xs">
              {labels[op.kind]} · {op.actor.firstName}
              {op.actor.lastName} · {formatDateTime(op.createdAt)}
            </p>{/each}
        </section>
      {/if}
    {/if}
  </div>
</Drawer>
