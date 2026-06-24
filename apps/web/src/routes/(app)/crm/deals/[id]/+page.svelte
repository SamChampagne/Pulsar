<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
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

  interface DealDetail {
    id: string;
    title: string;
    stage: string;
    amount: string | number | null;
    currency: string;
    ownerUserId: string | null;
    expectedCloseDate: string | null;
    companyId: string;
    company: { id: string; name: string } | null;
  }

  interface LineItem {
    id: string;
    name: string;
    quantity: number;
    unitPrice: string | number;
    discountPct: string | number;
    lineTotal: string | number;
    productId: string | null;
  }

  interface Product {
    id: string;
    name: string;
    unitPrice: string | number;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let deal = $state<DealDetail | null>(null);
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

  // Inline edit state: { lineId, field, value }
  let editingCell = $state<{ lineId: string; field: 'quantity' | 'unitPrice' | 'discountPct'; value: string } | null>(null);
  let saving = $state(false);

  let deletingId = $state<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadDeal() {
    loading = true;
    error = '';
    notFound = false;
    try {
      deal = await api<DealDetail>(`/crm/deals/${page.params.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : 'Impossible de charger l\'affaire';
      }
    } finally {
      loading = false;
    }
  }

  async function loadLines() {
    if (!deal) return;
    linesLoading = true;
    linesError = '';
    try {
      const result = await api<{ items: LineItem[] }>(`/crm/deals/${deal.id}/line-items`);
      lines = result.items;
    } catch (e) {
      linesError = e instanceof ApiError ? e.message : 'Impossible de charger les lignes';
    } finally {
      linesLoading = false;
    }
  }

  async function reloadAll() {
    if (!deal) return;
    // Reload both the deal header (amount changes) and the lines
    try {
      const [freshDeal, freshLines] = await Promise.all([
        api<DealDetail>(`/crm/deals/${deal.id}`),
        api<{ items: LineItem[] }>(`/crm/deals/${deal.id}/line-items`),
      ]);
      deal = freshDeal;
      lines = freshLines.items;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors du rechargement');
    }
  }

  async function loadProducts() {
    if (products.length > 0) return; // already loaded
    productsLoading = true;
    try {
      const result = await api<{ items: Product[] }>('/crm/products', {
        query: { active: 'true', pageSize: 100 },
      });
      products = result.items;
    } catch {
      // non-blocking: catalog picker just won't populate
    } finally {
      productsLoading = false;
    }
  }

  // ── Line mutations ────────────────────────────────────────────────────────────

  async function addLine() {
    if (!deal) return;
    adding = true;
    addError = '';
    try {
      if (addMode === 'catalog') {
        if (!selectedProductId) { addError = 'Sélectionnez un produit.'; adding = false; return; }
        await api(`/crm/deals/${deal.id}/line-items`, {
          method: 'POST',
          body: { productId: selectedProductId, quantity: addQty },
        });
      } else {
        if (!freeName.trim()) { addError = 'Le nom est requis.'; adding = false; return; }
        if (freeUnitPrice <= 0) { addError = 'Le prix unitaire doit être positif.'; adding = false; return; }
        await api(`/crm/deals/${deal.id}/line-items`, {
          method: 'POST',
          body: { name: freeName.trim(), unitPrice: freeUnitPrice, quantity: addQty },
        });
      }
      // Reset form
      selectedProductId = '';
      freeName = '';
      freeUnitPrice = 0;
      addQty = 1;
      showAddForm = false;
      await reloadAll();
    } catch (e) {
      addError = e instanceof ApiError ? e.message : 'Erreur lors de l\'ajout';
    } finally {
      adding = false;
    }
  }

  function startEdit(line: LineItem, field: 'quantity' | 'unitPrice' | 'discountPct') {
    editingCell = { lineId: line.id, field, value: String(line[field]) };
  }

  async function commitEdit() {
    if (!editingCell || !deal) return;
    const { lineId, field, value } = editingCell;
    const parsed = Number(value);
    if (isNaN(parsed) || parsed < 0) {
      editingCell = null;
      return;
    }
    editingCell = null;
    saving = true;
    try {
      await api(`/crm/deals/${deal.id}/line-items/${lineId}`, {
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
    if (!deal) return;
    deletingId = lineId;
    try {
      await api(`/crm/deals/${deal.id}/line-items/${lineId}`, { method: 'DELETE' });
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la suppression');
    } finally {
      deletingId = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function stageTone(stage: string): Tone {
    switch (stage) {
      case 'WON':       return 'ok';
      case 'LOST':      return 'danger';
      case 'PROPOSAL':  return 'warn';
      case 'QUALIFIED': return 'info';
      default:          return 'neutral';
    }
  }

  function stageLabel(stage: string): string {
    switch (stage) {
      case 'LEAD':      return 'Prospect';
      case 'QUALIFIED': return 'Qualifié';
      case 'PROPOSAL':  return 'Proposition';
      case 'WON':       return 'Gagné';
      case 'LOST':      return 'Perdu';
      default:          return stage;
    }
  }

  function formatAmount(amount: string | number | null, currency: string): string {
    if (amount == null) return '—';
    const n = Number(amount);
    if (isNaN(n)) return '—';
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currency || 'CAD',
      maximumFractionDigits: 2,
    }).format(n);
  }

  function lineTotal(line: LineItem): string {
    const total = Number(line.lineTotal);
    if (isNaN(total)) return '—';
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: deal?.currency ?? 'CAD',
      maximumFractionDigits: 2,
    }).format(total);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  $effect(() => {
    void loadDeal();
  });

  $effect(() => {
    if (deal) void loadLines();
  });

  $effect(() => {
    if (showAddForm && addMode === 'catalog') void loadProducts();
  });
</script>

{#if loading}
  <PageHeader title="Chargement…" />
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if notFound}
  <PageHeader title="Affaire introuvable" />
  <ErrorNotice message="Cette affaire n'existe pas ou vous n'y avez pas accès." />
  <div class="mt-4">
    <Button variant="secondary" onclick={() => goto('/crm/deals')}>
      ← Retour aux affaires
    </Button>
  </div>
{:else if error}
  <PageHeader title="Erreur" />
  <ErrorNotice message={error} onretry={loadDeal} />
{:else if deal}
  <!-- ── Hero ─────────────────────────────────────────────────────────────────── -->
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="mb-1 flex items-center gap-2">
        <Button variant="secondary" onclick={() => goto('/crm/deals')}>
          ← Affaires
        </Button>
      </div>
      <h1 class="mt-2 text-2xl font-bold text-ink">{deal.title}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</Badge>
        {#if deal.company}
          <a
            href="/crm/companies/{deal.company.id}"
            class="text-sm text-accent hover:underline"
          >{deal.company.name}</a>
        {/if}
      </div>
    </div>
    <a
      href="/crm/coach?dealId={deal.id}"
      class="flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-accent hover:text-accent"
    >
      🧠 Coach
    </a>
  </div>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Left column ── -->
    <div class="space-y-6 lg:col-span-2">

      <!-- Deal meta -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Informations</h2>
        <div class="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Étape</div>
            <Badge tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</Badge>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Montant total</div>
            <div class="text-base font-semibold text-accent">{formatAmount(deal.amount, deal.currency)}</div>
          </div>
          {#if deal.company}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Société</div>
              <a href="/crm/companies/{deal.company.id}" class="text-ink hover:underline hover:text-accent">
                {deal.company.name}
              </a>
            </div>
          {/if}
          {#if deal.ownerUserId}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Responsable</div>
              <div class="font-mono text-xs text-ink">{deal.ownerUserId.slice(0, 8)}…</div>
            </div>
          {/if}
          {#if deal.expectedCloseDate}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Clôture prévue</div>
              <div class="text-ink">{formatDate(deal.expectedCloseDate)}</div>
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
          {#if !showAddForm}
            <Button variant="primary" onclick={() => { showAddForm = true; addMode = 'catalog'; }}>
              + Ajouter une ligne
            </Button>
          {/if}
        </div>

        <!-- Add-line form -->
        {#if showAddForm}
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
                        <option value={p.id}>{p.name} ({formatAmount(p.unitPrice, deal.currency)})</option>
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
          <p class="text-xs text-ink-faint">Aucune ligne. Ajoutez un produit ou une ligne libre.</p>
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
                  <th class="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {#each lines as line (line.id)}
                  <tr class="border-b border-edge/50 last:border-0 hover:bg-surface-muted/40">
                    <td class="py-2 pr-3 text-ink font-medium">{line.name}</td>

                    <!-- Qty cell — click to edit -->
                    <td class="py-2 px-2 text-right">
                      {#if editingCell?.lineId === line.id && editingCell.field === 'quantity'}
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
                          class="cursor-pointer rounded px-1 py-0.5 text-ink hover:bg-surface-muted"
                          title="Cliquer pour modifier"
                          onclick={() => startEdit(line, 'quantity')}
                        >{line.quantity}</span>
                      {/if}
                    </td>

                    <!-- unitPrice cell -->
                    <td class="py-2 px-2 text-right">
                      {#if editingCell?.lineId === line.id && editingCell.field === 'unitPrice'}
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
                          class="cursor-pointer rounded px-1 py-0.5 text-ink-muted hover:bg-surface-muted"
                          title="Cliquer pour modifier"
                          onclick={() => startEdit(line, 'unitPrice')}
                        >{formatAmount(line.unitPrice, deal.currency)}</span>
                      {/if}
                    </td>

                    <!-- discountPct cell -->
                    <td class="py-2 px-2 text-right">
                      {#if editingCell?.lineId === line.id && editingCell.field === 'discountPct'}
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
                          class="cursor-pointer rounded px-1 py-0.5 text-ink-muted hover:bg-surface-muted"
                          title="Cliquer pour modifier"
                          onclick={() => startEdit(line, 'discountPct')}
                        >{Number(line.discountPct).toFixed(1)} %</span>
                      {/if}
                    </td>

                    <td class="py-2 pl-3 text-right font-semibold text-ink">{lineTotal(line)}</td>

                    <!-- Delete -->
                    <td class="py-2 pl-2 text-right">
                      <button
                        disabled={deletingId === line.id || saving}
                        onclick={() => void deleteLine(line.id)}
                        class="rounded p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                        title="Supprimer la ligne"
                      >✕</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="border-t border-edge">
                  <td colspan="4" class="py-2 pr-3 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                    Total affaire
                  </td>
                  <td class="py-2 pl-3 text-right text-sm font-bold text-accent">
                    {formatAmount(deal.amount, deal.currency)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}
      </Card>
    </div>

    <!-- ── Right column: stage progress ── -->
    <div class="space-y-6">
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Étape</h2>
        <div class="space-y-1.5">
          {#each [
            { key: 'LEAD',      label: 'Prospect',    tone: 'neutral' as Tone },
            { key: 'QUALIFIED', label: 'Qualifié',    tone: 'info'    as Tone },
            { key: 'PROPOSAL',  label: 'Proposition', tone: 'warn'    as Tone },
            { key: 'WON',       label: 'Gagné',       tone: 'ok'      as Tone },
            { key: 'LOST',      label: 'Perdu',       tone: 'danger'  as Tone },
          ] as s (s.key)}
            <div class={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${deal.stage === s.key ? 'bg-surface-muted font-semibold' : 'text-ink-faint'}`}>
              <Badge tone={s.tone}>{s.label}</Badge>
              {#if deal.stage === s.key}
                <span class="ml-auto text-[10px] font-semibold text-ink-muted">← actuel</span>
              {/if}
            </div>
          {/each}
        </div>
      </Card>

      <Card>
        <h2 class="mb-2 text-sm font-semibold text-ink">Actions</h2>
        <div class="space-y-2">
          <a
            href="/crm/coach?dealId={deal.id}"
            class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
          >
            🧠 Coaching IA
          </a>
          {#if deal.company}
            <a
              href="/crm/companies/{deal.company.id}"
              class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
            >
              🏢 Voir la société
            </a>
          {/if}
          <a
            href="/crm/pipeline"
            class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
          >
            ← Pipeline
          </a>
        </div>
      </Card>
    </div>
  </div>
{/if}
