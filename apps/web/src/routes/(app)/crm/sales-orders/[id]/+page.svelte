<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate, formatMoney } from '$lib/format';
  import { computeLineTotal } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Badge,
    Card,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ────────────────────────────────────────────────────────────────────

  type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'INVOICED' | 'CANCELLED';

  interface SalesOrder {
    id: string;
    number: string;
    status: SalesOrderStatus;
    totalAmount: string | number;
    currency: string;
    ownerUserId: string | null;
    notes: string | null;
    company: { id: string; name: string } | null;
    companyId: string;
  }

  interface LineItem {
    id: string;
    name: string;
    quantity: number;
    unitPrice: string | number;
    discountPct: string | number;
    productId: string | null;
  }

  interface Product {
    id: string;
    name: string;
    unitPrice: string | number;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let order = $state<SalesOrder | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');

  let lines = $state<LineItem[]>([]);
  let linesLoading = $state(false);
  let linesError = $state('');

  let products = $state<Product[]>([]);
  let productsLoading = $state(false);

  // Add-line form state
  let showAddForm = $state(false);
  let addMode = $state<'catalog' | 'free'>('catalog');
  let selectedProductId = $state('');
  let addQty = $state(1);
  let freeName = $state('');
  let freeUnitPrice = $state(0);
  let adding = $state(false);
  let addError = $state('');

  // Inline edit state
  let editingCell = $state<{ lineId: string; field: 'quantity' | 'unitPrice' | 'discountPct'; value: string } | null>(null);
  let saving = $state(false);

  let deletingId = $state<string | null>(null);

  // Status action state
  let transitioning = $state(false);
  let transitionError = $state('');

  // CRM module settings (gates direct invoicing of a fulfilled order)
  let directInvoicing = $state(false);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const isDraft = $derived(order?.status === 'DRAFT');

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadOrder() {
    loading = true;
    error = '';
    notFound = false;
    try {
      order = await api<SalesOrder>(`/crm/sales-orders/${page.params.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : "Impossible de charger la commande";
      }
    } finally {
      loading = false;
    }
  }

  async function loadLines() {
    if (!order) return;
    linesLoading = true;
    linesError = '';
    try {
      const result = await api<{ items: LineItem[] }>(`/crm/sales-orders/${order.id}/line-items`);
      lines = result.items;
    } catch (e) {
      linesError = e instanceof ApiError ? e.message : 'Impossible de charger les lignes';
    } finally {
      linesLoading = false;
    }
  }

  async function reloadAll() {
    if (!order) return;
    try {
      const [freshOrder, freshLines] = await Promise.all([
        api<SalesOrder>(`/crm/sales-orders/${order.id}`),
        api<{ items: LineItem[] }>(`/crm/sales-orders/${order.id}/line-items`),
      ]);
      order = freshOrder;
      lines = freshLines.items;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors du rechargement');
    }
  }

  async function loadSettings() {
    try {
      const res = await api<{ values: Record<string, unknown> }>('/modules/crm/settings');
      directInvoicing = res.values?.salesOrderDirectInvoicing === true;
    } catch {
      // non-blocking — leave invoicing hidden if settings can't be read
    }
  }

  async function loadProducts() {
    if (products.length > 0) return;
    productsLoading = true;
    try {
      const result = await api<{ items: Product[] }>('/crm/products', {
        query: { active: 'true', pageSize: 100 },
      });
      products = result.items;
    } catch {
      // non-blocking
    } finally {
      productsLoading = false;
    }
  }

  // ── Line mutations ────────────────────────────────────────────────────────────

  async function addLine() {
    if (!order) return;
    adding = true;
    addError = '';
    try {
      if (addMode === 'catalog') {
        if (!selectedProductId) { addError = 'Sélectionnez un produit.'; adding = false; return; }
        await api(`/crm/sales-orders/${order.id}/line-items`, {
          method: 'POST',
          body: { productId: selectedProductId, quantity: addQty },
        });
      } else {
        if (!freeName.trim()) { addError = 'Le nom est requis.'; adding = false; return; }
        if (freeUnitPrice <= 0) { addError = 'Le prix unitaire doit être positif.'; adding = false; return; }
        await api(`/crm/sales-orders/${order.id}/line-items`, {
          method: 'POST',
          body: { name: freeName.trim(), unitPrice: freeUnitPrice, quantity: addQty },
        });
      }
      selectedProductId = '';
      freeName = '';
      freeUnitPrice = 0;
      addQty = 1;
      showAddForm = false;
      await reloadAll();
    } catch (e) {
      addError = e instanceof ApiError ? e.message : "Erreur lors de l'ajout";
    } finally {
      adding = false;
    }
  }

  function startEdit(line: LineItem, field: 'quantity' | 'unitPrice' | 'discountPct') {
    if (!isDraft) return;
    editingCell = { lineId: line.id, field, value: String(line[field]) };
  }

  async function commitEdit() {
    if (!editingCell || !order) return;
    const { lineId, field, value } = editingCell;
    const parsed = Number(value);
    if (isNaN(parsed) || parsed < 0) {
      editingCell = null;
      return;
    }
    editingCell = null;
    saving = true;
    try {
      await api(`/crm/sales-orders/${order.id}/line-items/${lineId}`, {
        method: 'PATCH',
        body: { [field]: parsed },
      });
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la mise à jour');
    } finally {
      saving = false;
    }
  }

  async function deleteLine(lineId: string) {
    if (!order) return;
    deletingId = lineId;
    try {
      await api(`/crm/sales-orders/${order.id}/line-items/${lineId}`, { method: 'DELETE' });
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la suppression');
    } finally {
      deletingId = null;
    }
  }

  // ── Status transitions ────────────────────────────────────────────────────────

  // Buttons for transitions that have endpoints: confirm, fulfill, invoice, cancel
  // DRAFT → CONFIRMED (confirm) | CANCELLED (cancel)
  // CONFIRMED → FULFILLED (fulfill) | CANCELLED (cancel)
  // FULFILLED → INVOICED (invoice) — gated by the salesOrderDirectInvoicing CRM setting
  type TransitionVerb = 'confirm' | 'fulfill' | 'invoice' | 'cancel';

  interface StatusAction {
    verb: TransitionVerb;
    label: string;
    variant: 'primary' | 'secondary' | 'danger';
  }

  function allowedActions(status: SalesOrderStatus): StatusAction[] {
    switch (status) {
      case 'DRAFT':
        return [
          { verb: 'confirm', label: 'Confirmer', variant: 'primary' },
          { verb: 'cancel',  label: 'Annuler',   variant: 'danger'  },
        ];
      case 'CONFIRMED':
        return [
          { verb: 'fulfill', label: 'Exécuter', variant: 'primary' },
          { verb: 'cancel',  label: 'Annuler',  variant: 'danger'  },
        ];
      case 'FULFILLED':
        return directInvoicing
          ? [{ verb: 'invoice', label: 'Facturer', variant: 'primary' }]
          : [];
      default:
        return [];
    }
  }

  async function doTransition(verb: TransitionVerb) {
    if (!order) return;
    transitioning = true;
    transitionError = '';
    try {
      await api(`/crm/sales-orders/${order.id}/${verb}`, { method: 'POST' });
      await reloadAll();
      if (verb === 'invoice') toast.success('Commande facturée');
    } catch (e) {
      transitionError = e instanceof ApiError ? e.message : 'Erreur lors du changement de statut';
    } finally {
      transitioning = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const STATUS_LABELS: Record<SalesOrderStatus, string> = {
    DRAFT: 'Brouillon',
    CONFIRMED: 'Confirmée',
    FULFILLED: 'Exécutée',
    INVOICED: 'Facturée',
    CANCELLED: 'Annulée',
  };

  const STATUS_TONES: Record<SalesOrderStatus, Tone> = {
    DRAFT: 'neutral',
    CONFIRMED: 'info',
    FULFILLED: 'ok',
    INVOICED: 'info',
    CANCELLED: 'danger',
  };

  function statusLabel(status: SalesOrderStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusTone(status: SalesOrderStatus): Tone {
    return STATUS_TONES[status] ?? 'neutral';
  }

  function lineTotal(line: LineItem): string {
    const total = computeLineTotal({
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
    });
    if (isNaN(total)) return '—';
    return formatMoney(total, order?.currency ?? 'CAD');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  $effect(() => {
    void loadOrder();
    void loadSettings();
  });

  $effect(() => {
    if (order) void loadLines();
  });

  $effect(() => {
    if (showAddForm && addMode === 'catalog') void loadProducts();
  });
</script>

{#if loading}
  <PageHeader title="Chargement…" />
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if notFound}
  <PageHeader title="Commande introuvable" />
  <ErrorNotice message="Cette commande n'existe pas ou vous n'y avez pas accès." />
  <div class="mt-4">
    <Button variant="secondary" onclick={() => goto('/crm/sales-orders')}>
      ← Retour aux commandes
    </Button>
  </div>
{:else if error}
  <PageHeader title="Erreur" />
  <ErrorNotice message={error} onretry={loadOrder} />
{:else if order}
  <!-- ── Hero ───────────────────────────────────────────────────────────────────── -->
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="mb-1 flex items-center gap-2">
        <Button variant="secondary" onclick={() => goto('/crm/sales-orders')}>
          ← Commandes
        </Button>
      </div>
      <h1 class="mt-2 font-mono text-2xl font-bold text-ink">{order.number}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
        {#if order.company}
          <a
            href="/crm/companies/{order.company.id}"
            class="text-sm text-accent hover:underline"
          >{order.company.name}</a>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Left column ── -->
    <div class="space-y-6 lg:col-span-2">

      <!-- Order meta -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Informations</h2>
        <div class="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Statut</div>
            <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Montant total</div>
            <div class="text-base font-semibold text-accent">
              {formatMoney(order.totalAmount, order.currency)}
            </div>
          </div>
          {#if order.company}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Société</div>
              <a href="/crm/companies/{order.company.id}" class="text-ink hover:underline hover:text-accent">
                {order.company.name}
              </a>
            </div>
          {/if}
          {#if order.ownerUserId}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Responsable</div>
              <div class="font-mono text-xs text-ink">{order.ownerUserId.slice(0, 8)}…</div>
            </div>
          {/if}
          {#if order.notes}
            <div class="col-span-2 sm:col-span-3">
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Notes</div>
              <div class="text-ink">{order.notes}</div>
            </div>
          {/if}
        </div>
      </Card>

      <!-- Line items editor -->
      <Card>
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-ink">
            Lignes ({lines.length})
          </h2>
          {#if isDraft && !showAddForm}
            <Button variant="primary" onclick={() => { showAddForm = true; addMode = 'catalog'; }}>
              + Ajouter une ligne
            </Button>
          {/if}
        </div>

        {#if !isDraft}
          <div class="mb-3 rounded-md border border-edge bg-surface-muted/40 px-3 py-2 text-xs text-ink-muted">
            Commande verrouillée (non DRAFT) — les lignes ne peuvent plus être modifiées.
          </div>
        {/if}

        <!-- Add-line form (DRAFT only) -->
        {#if showAddForm && isDraft}
          <div class="mb-4 rounded-md border border-edge bg-surface-muted/40 p-3">
            <div class="mb-2 flex gap-2">
              <button
                class={`rounded px-3 py-1 text-xs font-medium transition-colors ${addMode === 'catalog' ? 'bg-accent text-white' : 'bg-surface border border-edge text-ink-muted hover:border-accent hover:text-ink'}`}
                onclick={() => { addMode = 'catalog'; void loadProducts(); }}
              >Depuis le catalogue</button>
              <button
                class={`rounded px-3 py-1 text-xs font-medium transition-colors ${addMode === 'free' ? 'bg-accent text-white' : 'bg-surface border border-edge text-ink-muted hover:border-accent hover:text-ink'}`}
                onclick={() => { addMode = 'free'; }}
              >Ligne libre</button>
            </div>

            {#if addMode === 'catalog'}
              <div class="flex flex-wrap items-end gap-2">
                <div class="flex-1 min-w-32">
                  <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Produit</label>
                  {#if productsLoading}
                    <div class="text-xs text-ink-faint">Chargement…</div>
                  {:else}
                    <select
                      bind:value={selectedProductId}
                      class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">— Sélectionner —</option>
                      {#each products as p (p.id)}
                        <option value={p.id}>{p.name} ({formatMoney(p.unitPrice, order.currency)})</option>
                      {/each}
                    </select>
                  {/if}
                </div>
                <div class="w-20">
                  <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Qté</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    bind:value={addQty}
                    class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            {:else}
              <div class="flex flex-wrap items-end gap-2">
                <div class="flex-1 min-w-40">
                  <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Nom</label>
                  <input
                    type="text"
                    bind:value={freeName}
                    placeholder="Ex : Prestation sur mesure"
                    class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div class="w-28">
                  <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Prix unitaire</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    bind:value={freeUnitPrice}
                    class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div class="w-20">
                  <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Qté</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    bind:value={addQty}
                    class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            {/if}

            {#if addError}
              <p class="mt-1.5 text-xs text-danger">{addError}</p>
            {/if}

            <div class="mt-3 flex gap-2">
              <Button variant="primary" loading={adding} onclick={() => void addLine()}>
                Ajouter
              </Button>
              <Button variant="secondary" onclick={() => { showAddForm = false; addError = ''; }}>
                Annuler
              </Button>
            </div>
          </div>
        {/if}

        <!-- Lines table -->
        {#if linesLoading}
          <Skeleton rows={3} />
        {:else if linesError}
          <p class="text-xs text-danger">{linesError}</p>
        {:else if lines.length === 0}
          <p class="text-xs text-ink-faint">Aucune ligne pour le moment.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-edge text-[11px] uppercase tracking-wide text-ink-muted">
                  <th class="py-2 pr-3 text-left font-semibold">Désignation</th>
                  <th class="py-2 px-2 text-right font-semibold w-20">Qté</th>
                  <th class="py-2 px-2 text-right font-semibold w-28">Prix unit.</th>
                  <th class="py-2 px-2 text-right font-semibold w-24">Remise %</th>
                  <th class="py-2 pl-3 text-right font-semibold w-28">Total ligne</th>
                  {#if isDraft}
                    <th class="py-2 pl-2 w-10"></th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each lines as line (line.id)}
                  <tr class="border-b border-edge/50 last:border-0 hover:bg-surface-muted/40">
                    <td class="py-2 pr-3 text-ink font-medium">{line.name}</td>

                    <!-- Qty cell -->
                    <td class="py-2 px-2 text-right">
                      {#if isDraft && editingCell?.lineId === line.id && editingCell.field === 'quantity'}
                        <input
                          type="number"
                          min="1"
                          step="1"
                          class="w-16 rounded border border-accent px-1 py-0.5 text-right text-xs focus:outline-none"
                          bind:value={editingCell.value}
                          onblur={() => void commitEdit()}
                          onkeydown={(e) => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') editingCell = null; }}
                          autofocus
                        />
                      {:else}
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                        <span
                          class={`rounded px-1 py-0.5 text-ink ${isDraft ? 'cursor-pointer hover:bg-surface-muted' : ''}`}
                          title={isDraft ? 'Cliquer pour modifier' : undefined}
                          onclick={() => startEdit(line, 'quantity')}
                        >{line.quantity}</span>
                      {/if}
                    </td>

                    <!-- unitPrice cell -->
                    <td class="py-2 px-2 text-right">
                      {#if isDraft && editingCell?.lineId === line.id && editingCell.field === 'unitPrice'}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          class="w-24 rounded border border-accent px-1 py-0.5 text-right text-xs focus:outline-none"
                          bind:value={editingCell.value}
                          onblur={() => void commitEdit()}
                          onkeydown={(e) => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') editingCell = null; }}
                          autofocus
                        />
                      {:else}
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                        <span
                          class={`rounded px-1 py-0.5 text-ink-muted ${isDraft ? 'cursor-pointer hover:bg-surface-muted' : ''}`}
                          title={isDraft ? 'Cliquer pour modifier' : undefined}
                          onclick={() => startEdit(line, 'unitPrice')}
                        >{formatMoney(line.unitPrice, order.currency)}</span>
                      {/if}
                    </td>

                    <!-- discountPct cell -->
                    <td class="py-2 px-2 text-right">
                      {#if isDraft && editingCell?.lineId === line.id && editingCell.field === 'discountPct'}
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          class="w-20 rounded border border-accent px-1 py-0.5 text-right text-xs focus:outline-none"
                          bind:value={editingCell.value}
                          onblur={() => void commitEdit()}
                          onkeydown={(e) => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') editingCell = null; }}
                          autofocus
                        />
                      {:else}
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                        <span
                          class={`rounded px-1 py-0.5 text-ink-muted ${isDraft ? 'cursor-pointer hover:bg-surface-muted' : ''}`}
                          title={isDraft ? 'Cliquer pour modifier' : undefined}
                          onclick={() => startEdit(line, 'discountPct')}
                        >{Number(line.discountPct).toFixed(1)} %</span>
                      {/if}
                    </td>

                    <td class="py-2 pl-3 text-right font-semibold text-ink">{lineTotal(line)}</td>

                    <!-- Delete (DRAFT only) -->
                    {#if isDraft}
                      <td class="py-2 pl-2 text-right">
                        <button
                          disabled={deletingId === line.id || saving}
                          onclick={() => void deleteLine(line.id)}
                          class="rounded p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          title="Supprimer la ligne"
                        >✕</button>
                      </td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="border-t border-edge">
                  <td colspan={4} class="py-2 pr-3 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                    Total commande
                  </td>
                  <td class="py-2 pl-3 text-right text-sm font-bold text-accent">
                    {formatMoney(order.totalAmount, order.currency)}
                  </td>
                  {#if isDraft}
                    <td></td>
                  {/if}
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}
      </Card>
    </div>

    <!-- ── Right column ── -->
    <div class="space-y-6">
      <!-- Status panel -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Statut</h2>
        <div class="space-y-1.5">
          {#each (
            [
              { key: 'DRAFT',     label: 'Brouillon', tone: 'neutral' as Tone },
              { key: 'CONFIRMED', label: 'Confirmée', tone: 'info'    as Tone },
              { key: 'FULFILLED', label: 'Exécutée',  tone: 'ok'      as Tone },
              { key: 'INVOICED',  label: 'Facturée',  tone: 'info'    as Tone },
              { key: 'CANCELLED', label: 'Annulée',   tone: 'danger'  as Tone },
            ] as const
          ) as s (s.key)}
            <div class={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${order.status === s.key ? 'bg-surface-muted font-semibold' : 'text-ink-faint'}`}>
              <Badge tone={s.tone}>{s.label}</Badge>
              {#if order.status === s.key}
                <span class="ml-auto text-[10px] font-semibold text-ink-muted">← actuel</span>
              {/if}
            </div>
          {/each}
        </div>
      </Card>

      <!-- Actions card -->
      {#if allowedActions(order.status).length > 0}
        <Card>
          <h2 class="mb-2 text-sm font-semibold text-ink">Actions</h2>
          {#if transitionError}
            <p class="mb-2 text-xs text-danger">{transitionError}</p>
          {/if}
          <div class="space-y-2">
            {#each allowedActions(order.status) as action (action.verb)}
              <div class={action.variant === 'danger' ? 'w-full border-danger/40 text-danger hover:bg-danger/10' : 'w-full'}>
                <Button
                  variant={action.variant === 'danger' ? 'secondary' : action.variant}
                  loading={transitioning}
                  onclick={() => void doTransition(action.verb)}
                >
                  {action.label}
                </Button>
              </div>
            {/each}
          </div>
        </Card>
      {/if}

      <!-- Navigation -->
      <Card>
        <h2 class="mb-2 text-sm font-semibold text-ink">Navigation</h2>
        <div class="space-y-2">
          {#if order.company}
            <a
              href="/crm/companies/{order.company.id}"
              class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Voir la société
            </a>
          {/if}
          <a
            href="/crm/sales-orders"
            class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
          >
            ← Toutes les commandes
          </a>
        </div>
      </Card>
    </div>
  </div>
{/if}
