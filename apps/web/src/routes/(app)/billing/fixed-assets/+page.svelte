<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Card,
    Table,
    Badge,
    Button,
    EmptyState,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Local types aligned to the real API shapes ───────────────────────────────

  /** Returned by GET /billing/fixed-assets and GET /billing/fixed-assets/:id */
  interface FixedAsset {
    id: string;
    assetCode: string;
    name: string;
    category: string | null;
    acquisitionDate: string;
    /** Decimal serialised as string by Prisma */
    cost: string;
    /** Decimal serialised as string by Prisma */
    salvageValue: string;
    usefulLifeMonths: number;
    method: string;
    status: 'DRAFT' | 'ACTIVE' | 'DISPOSED';
    /** Decimal serialised as string by Prisma */
    accumulatedDepreciation: string;
    depreciationExpenseAccountCode: string;
    accumulatedDepreciationAccountCode: string;
    disposedAt: string | null;
  }

  /** One row returned by GET /billing/fixed-assets/:id/schedule */
  interface DepreciationScheduleRow {
    period: number;
    amount: number;
    accumulated: number;
    bookValue: number;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function money(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusTone(status: FixedAsset['status']): Tone {
    if (status === 'ACTIVE') return 'ok';
    if (status === 'DISPOSED') return 'warn';
    return 'neutral';
  }

  function statusLabel(status: FixedAsset['status']): string {
    if (status === 'ACTIVE') return 'Actif';
    if (status === 'DISPOSED') return 'Cédé';
    return 'Brouillon';
  }

  // ── List state ───────────────────────────────────────────────────────────────

  let assets = $state<FixedAsset[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function loadAssets() {
    loading = true;
    error = '';
    try {
      assets = await api<FixedAsset[]>('/billing/fixed-assets');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des immobilisations';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadAssets();
  });

  // ── Create / Edit modal ──────────────────────────────────────────────────────

  let showModal = $state(false);
  let editingAsset = $state<FixedAsset | null>(null);
  let form = $state({
    assetCode: '',
    name: '',
    category: '',
    acquisitionDate: '',
    cost: '',
    salvageValue: '',
    usefulLifeMonths: '',
    depreciationExpenseAccountCode: '',
    accumulatedDepreciationAccountCode: '',
  });
  let saving = $state(false);
  let formError = $state('');

  function openCreate() {
    editingAsset = null;
    form = {
      assetCode: '',
      name: '',
      category: '',
      acquisitionDate: new Date().toISOString().slice(0, 10),
      cost: '',
      salvageValue: '0',
      usefulLifeMonths: '',
      depreciationExpenseAccountCode: '5100',
      accumulatedDepreciationAccountCode: '1590',
    };
    formError = '';
    showModal = true;
  }

  function openEdit(a: FixedAsset) {
    editingAsset = a;
    form = {
      assetCode: a.assetCode,
      name: a.name,
      category: a.category ?? '',
      acquisitionDate: a.acquisitionDate.slice(0, 10),
      cost: String(Number(a.cost)),
      salvageValue: String(Number(a.salvageValue)),
      usefulLifeMonths: String(a.usefulLifeMonths),
      depreciationExpenseAccountCode: a.depreciationExpenseAccountCode,
      accumulatedDepreciationAccountCode: a.accumulatedDepreciationAccountCode,
    };
    formError = '';
    showModal = true;
  }

  async function saveAsset() {
    formError = '';
    if (!form.assetCode.trim()) { formError = 'Le code est requis.'; return; }
    if (!form.name.trim()) { formError = 'Le nom est requis.'; return; }
    if (!form.acquisitionDate) { formError = "La date d'acquisition est requise."; return; }
    const cost = Number(form.cost);
    if (!form.cost || isNaN(cost) || cost < 0) { formError = 'Le coût doit être un nombre positif.'; return; }
    const salvage = Number(form.salvageValue);
    if (isNaN(salvage) || salvage < 0) { formError = 'La valeur résiduelle doit être un nombre positif.'; return; }
    const life = Number(form.usefulLifeMonths);
    if (!form.usefulLifeMonths || isNaN(life) || life < 1 || !Number.isInteger(life)) {
      formError = 'La durée de vie doit être un entier supérieur à 0.';
      return;
    }

    saving = true;
    try {
      const body = {
        assetCode: form.assetCode.trim(),
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        acquisitionDate: form.acquisitionDate,
        cost,
        salvageValue: salvage,
        usefulLifeMonths: life,
        depreciationExpenseAccountCode: form.depreciationExpenseAccountCode.trim() || undefined,
        accumulatedDepreciationAccountCode: form.accumulatedDepreciationAccountCode.trim() || undefined,
      };
      if (editingAsset) {
        await api(`/billing/fixed-assets/${editingAsset.id}`, { method: 'PATCH', body });
        toast.success('Immobilisation mise à jour');
      } else {
        await api('/billing/fixed-assets', { method: 'POST', body });
        toast.success('Immobilisation créée');
      }
      showModal = false;
      await loadAssets();
    } catch (e) {
      formError = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  let deletingId = $state<string | null>(null);

  async function deleteAsset(a: FixedAsset) {
    if (a.status !== 'DRAFT') return;
    if (!confirm(`Supprimer l'immobilisation « ${a.name} » ?`)) return;
    deletingId = a.id;
    try {
      await api(`/billing/fixed-assets/${a.id}`, { method: 'DELETE' });
      toast.success('Immobilisation supprimée');
      await loadAssets();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    } finally {
      deletingId = null;
    }
  }

  // ── Schedule preview ─────────────────────────────────────────────────────────

  let scheduleAsset = $state<FixedAsset | null>(null);
  let scheduleRows = $state<DepreciationScheduleRow[]>([]);
  let loadingSchedule = $state(false);
  let errorSchedule = $state('');

  async function openSchedule(a: FixedAsset) {
    scheduleAsset = a;
    scheduleRows = [];
    loadingSchedule = true;
    errorSchedule = '';
    try {
      scheduleRows = await api<DepreciationScheduleRow[]>(`/billing/fixed-assets/${a.id}/schedule`);
    } catch (e) {
      errorSchedule = e instanceof ApiError ? e.message : 'Échec du chargement du calendrier';
    } finally {
      loadingSchedule = false;
    }
  }

  function closeSchedule() {
    scheduleAsset = null;
    scheduleRows = [];
    errorSchedule = '';
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  let actioningId = $state<string | null>(null);

  async function activateAsset(a: FixedAsset) {
    actioningId = a.id;
    try {
      await api(`/billing/fixed-assets/${a.id}/activate`, { method: 'POST' });
      toast.success('Immobilisation activée');
      await loadAssets();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'activation");
    } finally {
      actioningId = null;
    }
  }

  async function disposeAsset(a: FixedAsset) {
    if (!confirm(`Céder l'immobilisation « ${a.name} » ?`)) return;
    actioningId = a.id;
    try {
      await api(`/billing/fixed-assets/${a.id}/dispose`, { method: 'POST' });
      toast.success('Immobilisation cédée');
      await loadAssets();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la cession');
    } finally {
      actioningId = null;
    }
  }

  // ── Depreciate ───────────────────────────────────────────────────────────────

  let depreciatingAsset = $state<FixedAsset | null>(null);
  let depreciationPeriod = $state('');
  let depreciating = $state(false);
  let depreciateError = $state('');

  function openDepreciate(a: FixedAsset) {
    depreciatingAsset = a;
    // Default to first day of current month
    const now = new Date();
    depreciationPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    depreciateError = '';
  }

  function closeDepreciate() {
    depreciatingAsset = null;
    depreciationPeriod = '';
    depreciateError = '';
  }

  async function runDepreciation() {
    if (!depreciatingAsset || !depreciationPeriod) return;
    depreciateError = '';
    depreciating = true;
    try {
      await api(`/billing/fixed-assets/${depreciatingAsset.id}/depreciate`, {
        method: 'POST',
        body: { period: depreciationPeriod },
      });
      toast.success('Amortissement comptabilisé');
      closeDepreciate();
      await loadAssets();
    } catch (e) {
      depreciateError = e instanceof ApiError ? e.message : "Échec de l'amortissement";
    } finally {
      depreciating = false;
    }
  }
</script>

<PageHeader
  title="Immobilisations"
  subtitle="Registre des actifs amortissables et calendrier d'amortissement linéaire."
/>

<!-- Toolbar -->
<div class="mb-4 flex items-center justify-between">
  <span class="text-sm text-ink-muted">{assets.length} immobilisation{assets.length !== 1 ? 's' : ''}</span>
  <Button variant="primary" onclick={openCreate}>+ Nouvelle immobilisation</Button>
</div>

<ErrorNotice message={error} onretry={loadAssets} />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th>
      <th>Nom</th>
      <th class="text-right">Coût</th>
      <th class="text-right">Amort. cumulé</th>
      <th class="text-right">Valeur nette</th>
      <th class="text-center">Statut</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each assets as a (a.id)}
        {@const cost = Number(a.cost)}
        {@const accumulated = Number(a.accumulatedDepreciation)}
        {@const nbv = cost - accumulated}
        <tr>
          <td class="font-mono text-xs text-ink-muted">{a.assetCode}</td>
          <td class="font-medium">{a.name}</td>
          <td class="text-right tabular-nums">{money(cost)}</td>
          <td class="text-right tabular-nums">{money(accumulated)}</td>
          <td class="text-right tabular-nums font-semibold">{money(nbv)}</td>
          <td class="text-center">
            <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
          </td>
          <td class="text-right whitespace-nowrap text-xs">
            <button class="mr-2 text-accent hover:underline" onclick={() => openSchedule(a)}>Calendrier</button>
            {#if a.status === 'DRAFT'}
              <button
                class="mr-2 text-ok hover:underline disabled:opacity-40"
                disabled={actioningId === a.id}
                onclick={() => activateAsset(a)}
              >{actioningId === a.id ? '…' : 'Activer'}</button>
              <button class="mr-2 text-accent hover:underline" onclick={() => openEdit(a)}>Modifier</button>
              <button
                class="text-danger hover:underline disabled:opacity-40"
                disabled={deletingId === a.id}
                onclick={() => deleteAsset(a)}
              >{deletingId === a.id ? '…' : 'Supprimer'}</button>
            {:else if a.status === 'ACTIVE'}
              <button class="mr-2 text-accent hover:underline" onclick={() => openDepreciate(a)}>Amortir</button>
              <button
                class="text-warn hover:underline disabled:opacity-40"
                disabled={actioningId === a.id}
                onclick={() => disposeAsset(a)}
              >{actioningId === a.id ? '…' : 'Céder'}</button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan={7}>
            <EmptyState title="Aucune immobilisation" message="Créez votre premier actif amortissable." />
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<!-- ── Create / Edit modal ─────────────────────────────────────────────────── -->
{#if showModal}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
    <div class="w-full max-w-lg rounded-xl bg-surface p-6 shadow-xl overflow-y-auto max-h-[90vh]">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-bold text-ink">
          {editingAsset ? "Modifier l'immobilisation" : 'Nouvelle immobilisation'}
        </h2>
        <button class="text-ink-muted hover:text-ink" onclick={() => { showModal = false; }}>✕</button>
      </div>

      <div class="space-y-3">
        <!-- Code + Name -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-code">Code</label>
            <input
              id="fa-code"
              bind:value={form.assetCode}
              placeholder="ex. IMM-001"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm font-mono focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-name">Nom</label>
            <input
              id="fa-name"
              bind:value={form.name}
              placeholder="ex. Véhicule de livraison"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <!-- Category + Acquisition date -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-category">Catégorie</label>
            <input
              id="fa-category"
              bind:value={form.category}
              placeholder="ex. Matériel roulant"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-date">Date d'acquisition</label>
            <input
              id="fa-date"
              type="date"
              bind:value={form.acquisitionDate}
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <!-- Cost + Salvage value -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-cost">Coût ($)</label>
            <input
              id="fa-cost"
              type="number"
              step="0.01"
              min="0"
              bind:value={form.cost}
              placeholder="12000.00"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-salvage">Valeur résiduelle ($)</label>
            <input
              id="fa-salvage"
              type="number"
              step="0.01"
              min="0"
              bind:value={form.salvageValue}
              placeholder="0.00"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <!-- Useful life -->
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-life">Durée de vie (mois)</label>
          <input
            id="fa-life"
            type="number"
            step="1"
            min="1"
            bind:value={form.usefulLifeMonths}
            placeholder="ex. 60"
            class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        <!-- Account codes -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-exp-acc">
              Compte dotation (défaut 5100)
            </label>
            <input
              id="fa-exp-acc"
              bind:value={form.depreciationExpenseAccountCode}
              placeholder="5100"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm font-mono focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="fa-contra-acc">
              Compte amort. cumulé (défaut 1590)
            </label>
            <input
              id="fa-contra-acc"
              bind:value={form.accumulatedDepreciationAccountCode}
              placeholder="1590"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm font-mono focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {#if formError}
        <p class="mt-3 text-sm text-danger">{formError}</p>
      {/if}

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onclick={() => { showModal = false; }}>Annuler</Button>
        <Button variant="primary" disabled={saving} onclick={saveAsset}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Depreciate modal ────────────────────────────────────────────────────── -->
{#if depreciatingAsset}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
    <div class="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-bold text-ink">Amortir — {depreciatingAsset.name}</h2>
        <button class="text-ink-muted hover:text-ink" onclick={closeDepreciate}>✕</button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted" for="dep-period">
            Période (1er du mois)
          </label>
          <input
            id="dep-period"
            type="date"
            bind:value={depreciationPeriod}
            class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div class="text-xs text-ink-muted">
          Amort. cumulé actuel : {money(depreciatingAsset.accumulatedDepreciation)}
          / Coût : {money(depreciatingAsset.cost)}
        </div>
      </div>

      {#if depreciateError}
        <p class="mt-3 text-sm text-danger">{depreciateError}</p>
      {/if}

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onclick={closeDepreciate}>Annuler</Button>
        <Button variant="primary" disabled={depreciating || !depreciationPeriod} onclick={runDepreciation}>
          {depreciating ? 'Comptabilisation…' : 'Amortir'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Schedule panel ──────────────────────────────────────────────────────── -->
{#if scheduleAsset}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
    <div class="w-full max-w-2xl rounded-xl bg-surface p-6 shadow-xl">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h2 class="text-base font-bold text-ink">Calendrier d'amortissement — {scheduleAsset.name}</h2>
          <p class="text-xs text-ink-muted">
            Coût {money(scheduleAsset.cost)} · Résiduel {money(scheduleAsset.salvageValue)} · {scheduleAsset.usefulLifeMonths} mois
          </p>
        </div>
        <button class="text-ink-muted hover:text-ink" onclick={closeSchedule}>✕</button>
      </div>

      <ErrorNotice message={errorSchedule} onretry={() => { if (scheduleAsset) void openSchedule(scheduleAsset); }} />

      {#if loadingSchedule}
        <Skeleton rows={5} />
      {:else if scheduleRows.length > 0}
        <div class="overflow-x-auto max-h-96 overflow-y-auto">
          <table class="w-full">
            <thead class="sticky top-0 bg-surface">
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-3 py-3 text-right">Période</th>
                <th class="px-3 py-3 text-right">Dotation</th>
                <th class="px-3 py-3 text-right">Amort. cumulé</th>
                <th class="px-3 py-3 text-right">Valeur nette</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              {#each scheduleRows as row (row.period)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-3 py-2.5 text-right tabular-nums text-ink-muted">{row.period}</td>
                  <td class="px-3 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                  <td class="px-3 py-2.5 text-right tabular-nums">{money(row.accumulated)}</td>
                  <td class="px-3 py-2.5 text-right tabular-nums font-semibold">{money(row.bookValue)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if !loadingSchedule && !errorSchedule}
        <EmptyState title="Calendrier vide" message="Aucun calendrier disponible pour cet actif." />
      {/if}

      <div class="mt-5 flex justify-end">
        <Button variant="ghost" onclick={closeSchedule}>Fermer</Button>
      </div>
    </div>
  </div>
{/if}
