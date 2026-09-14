<script lang="ts">
  import { Modal } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
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

  // ── Local types aligned to API responses ────────────────────────────────────

  /** A single budget line (returned inside Budget) */
  interface BudgetLine {
    id?: string;
    accountCode: string;
    /** Decimal serialised as string by Prisma */
    amount: string;
  }

  /** Returned by GET /billing/budgets and GET /billing/budgets/:id */
  interface Budget {
    id: string;
    name: string;
    fiscalYear: number;
    isActive: boolean;
    lines: BudgetLine[];
  }

  /** One row returned by GET /billing/budgets/:id/variance */
  interface VarianceRow {
    accountCode: string;
    name: string;
    /** number (already Number-coerced by the API service via computeBudgetVariance) */
    budget: number;
    actual: number;
    variance: number;
    variancePct: number;
  }

  /** Full shape returned by GET /billing/budgets/:id/variance */
  interface VarianceResult {
    rows: VarianceRow[];
    totalBudget: number;
    totalActual: number;
    totalVariance: number;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function money(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function signedMoney(val: number | string | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    const formatted = Math.abs(n).toLocaleString('fr-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return n < 0 ? `−${formatted}` : formatted;
  }

  function varianceTone(variance: number): Tone {
    return variance < 0 ? 'danger' : 'ok';
  }

  /** Sum of line amounts for display in the list (coerce Decimal strings) */
  function totalBudgeted(lines: BudgetLine[]): number {
    return lines.reduce((sum, l) => sum + Number(l.amount), 0);
  }

  // ── List state ───────────────────────────────────────────────────────────────

  let budgets = $state<Budget[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function loadBudgets() {
    loading = true;
    error = '';
    try {
      budgets = await api<Budget[]>('/billing/budgets');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des budgets';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadBudgets();
  });

  // ── Create / Edit modal ──────────────────────────────────────────────────────

  interface LineForm {
    accountCode: string;
    amount: string;
  }

  let showModal = $state(false);
  let editingBudget = $state<Budget | null>(null);
  let form = $state({ name: '', fiscalYear: new Date().getFullYear(), isActive: true });
  let lines = $state<LineForm[]>([{ accountCode: '', amount: '' }]);
  let saving = $state(false);
  let formError = $state('');

  function openCreate() {
    editingBudget = null;
    form = { name: '', fiscalYear: new Date().getFullYear(), isActive: true };
    lines = [{ accountCode: '', amount: '' }];
    formError = '';
    showModal = true;
  }

  function openEdit(b: Budget) {
    editingBudget = b;
    form = { name: b.name, fiscalYear: b.fiscalYear, isActive: b.isActive };
    lines =
      b.lines.length > 0
        ? b.lines.map((l) => ({ accountCode: l.accountCode, amount: String(Number(l.amount)) }))
        : [{ accountCode: '', amount: '' }];
    formError = '';
    showModal = true;
  }

  function addLine() {
    lines = [...lines, { accountCode: '', amount: '' }];
  }

  function removeLine(idx: number) {
    lines = lines.filter((_, i) => i !== idx);
  }

  async function saveBudget() {
    formError = '';
    if (!form.name.trim()) {
      formError = 'Le nom est requis.';
      return;
    }
    if (!form.fiscalYear || isNaN(form.fiscalYear)) {
      formError = "L'exercice fiscal est requis.";
      return;
    }
    const validLines = lines.filter(
      (l) => l.accountCode.trim() && String(l.amount ?? '').trim() !== '',
    );
    if (validLines.length === 0) {
      formError = 'Au moins une ligne budgétaire est requise.';
      return;
    }
    for (const l of validLines) {
      const amt = Number(l.amount);
      if (isNaN(amt)) {
        formError = `Montant invalide pour le compte ${l.accountCode}.`;
        return;
      }
    }

    saving = true;
    try {
      const body = {
        name: form.name.trim(),
        fiscalYear: Number(form.fiscalYear),
        isActive: form.isActive,
        lines: validLines.map((l) => ({
          accountCode: l.accountCode.trim(),
          amount: Number(l.amount),
        })),
      };
      if (editingBudget) {
        await api(`/billing/budgets/${editingBudget.id}`, { method: 'PATCH', body });
        toast.success('Budget mis à jour');
      } else {
        await api('/billing/budgets', { method: 'POST', body });
        toast.success('Budget créé');
      }
      showModal = false;
      await loadBudgets();
    } catch (e) {
      formError = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  let deletingId = $state<string | null>(null);

  async function deleteBudget(b: Budget) {
    if (!(await confirmAction(`Supprimer le budget « ${b.name} (${b.fiscalYear}) » ?`))) return;
    deletingId = b.id;
    try {
      await api(`/billing/budgets/${b.id}`, { method: 'DELETE' });
      toast.success('Budget supprimé');
      await loadBudgets();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    } finally {
      deletingId = null;
    }
  }

  // ── Variance view ────────────────────────────────────────────────────────────

  let varianceBudget = $state<Budget | null>(null);
  let varianceResult = $state<VarianceResult | null>(null);
  let loadingVariance = $state(false);
  let errorVariance = $state('');

  async function openVariance(b: Budget) {
    varianceBudget = b;
    varianceResult = null;
    loadingVariance = true;
    errorVariance = '';
    try {
      varianceResult = await api<VarianceResult>(`/billing/budgets/${b.id}/variance`);
    } catch (e) {
      errorVariance = e instanceof ApiError ? e.message : 'Échec du chargement des écarts';
    } finally {
      loadingVariance = false;
    }
  }

  function closeVariance() {
    varianceBudget = null;
    varianceResult = null;
    errorVariance = '';
  }
</script>

<PageHeader
  title="Budgets"
  subtitle="Budgets annuels par compte GL et rapport d'écarts budget-vs-réel."
/>

<!-- Toolbar -->
<div class="mb-4 flex items-center justify-between">
  <span class="text-sm text-ink-muted"
    >{budgets.length} budget{budgets.length !== 1 ? 's' : ''}</span
  >
  <Button variant="primary" onclick={openCreate}>+ Nouveau budget</Button>
</div>

<ErrorNotice message={error} onretry={loadBudgets} />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Nom</th>
      <th class="text-center">Exercice</th>
      <th class="text-right">Total budgété</th>
      <th class="text-center">Statut</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each budgets as b (b.id)}
        <tr>
          <td class="font-medium">{b.name}</td>
          <td class="text-center tabular-nums">{b.fiscalYear}</td>
          <td class="text-right tabular-nums">{money(totalBudgeted(b.lines))}</td>
          <td class="text-center">
            <Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Actif' : 'Inactif'}</Badge>
          </td>
          <td class="text-right whitespace-nowrap">
            <button class="mr-2 text-xs text-accent hover:underline" onclick={() => openVariance(b)}
              >Écarts</button
            >
            <button class="mr-2 text-xs text-accent hover:underline" onclick={() => openEdit(b)}
              >Modifier</button
            >
            <button
              class="text-xs text-danger hover:underline disabled:opacity-40"
              disabled={deletingId === b.id}
              onclick={() => deleteBudget(b)}>{deletingId === b.id ? '…' : 'Supprimer'}</button
            >
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan={5}>
            <EmptyState title="Aucun budget" message="Créez votre premier budget annuel." />
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<!-- ── Create / Edit modal ─────────────────────────────────────────────────── -->
{#if showModal}
  <Modal
    open
    title={editingBudget ? 'Modifier le budget' : 'Nouveau budget'}
    size="lg"
    onclose={() => {
      showModal = false;
    }}
    dismissible={!saving}
  >
    <div class="space-y-3">
      <!-- Name -->
      <div>
        <label class="mb-1 block text-xs font-medium text-ink-muted" for="bgt-name">Nom</label>
        <input
          id="bgt-name"
          bind:value={form.name}
          placeholder="ex. Budget opérationnel 2026"
          class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <!-- Fiscal year + active -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted" for="bgt-fy"
            >Exercice fiscal</label
          >
          <input
            id="bgt-fy"
            type="number"
            bind:value={form.fiscalYear}
            placeholder="2026"
            class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div class="flex items-end pb-1">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" bind:checked={form.isActive} class="rounded" />
            Budget actif
          </label>
        </div>
      </div>

      <!-- Budget lines -->
      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-ink-muted">Lignes budgétaires</span>
          <button type="button" class="text-xs text-accent hover:underline" onclick={addLine}
            >+ Ajouter une ligne</button
          >
        </div>
        <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
          {#each lines as line, idx (idx)}
            <div class="flex items-center gap-2">
              <input
                bind:value={line.accountCode}
                placeholder="Code compte (ex. 5000)"
                class="min-w-0 flex-1 rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm font-mono focus:border-accent focus:outline-none"
              />
              <input
                type="number"
                step="0.01"
                bind:value={line.amount}
                placeholder="Montant"
                class="w-32 rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              {#if lines.length > 1}
                <button
                  type="button"
                  class="shrink-0 text-xs text-danger hover:underline"
                  onclick={() => removeLine(idx)}>✕</button
                >
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    {#if formError}
      <p class="mt-3 text-sm text-danger">{formError}</p>
    {/if}
    {#snippet footer()}<div class="flex justify-end gap-2">
        <Button
          disabled={saving}
          variant="secondary"
          onclick={() => {
            showModal = false;
          }}>Annuler</Button
        >
        <Button variant="primary" disabled={saving || !form.name.trim()} onclick={saveBudget}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>{/snippet}
  </Modal>
{/if}

<!-- ── Variance panel ──────────────────────────────────────────────────────── -->
{#if varianceBudget}
  <Modal open title={`Écarts — ${varianceBudget.name}`} size="xl" onclose={closeVariance}>
    <p class="text-xs text-ink-muted">Exercice {varianceBudget.fiscalYear}</p>

    <ErrorNotice
      message={errorVariance}
      onretry={() => {
        if (varianceBudget) void openVariance(varianceBudget);
      }}
    />

    {#if loadingVariance}
      <Skeleton rows={5} />
    {:else if varianceResult}
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr
              class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase"
            >
              <th class="px-3 py-3 text-left">Code</th>
              <th class="px-3 py-3 text-left">Compte</th>
              <th class="px-3 py-3 text-right">Budgété</th>
              <th class="px-3 py-3 text-right">Réel</th>
              <th class="px-3 py-3 text-right">Écart</th>
              <th class="px-3 py-3 text-right">Écart %</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-edge-soft">
            {#each varianceResult.rows as row (row.accountCode)}
              <tr class="text-sm hover:bg-surface-muted/50">
                <td class="px-3 py-2.5 font-mono text-ink-muted">{row.accountCode}</td>
                <td class="px-3 py-2.5">{row.name || '—'}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{money(row.budget)}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{money(row.actual)}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">
                  <span
                    class={row.variance < 0 ? 'text-danger font-semibold' : 'text-ok font-semibold'}
                  >
                    {signedMoney(row.variance)}
                  </span>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <Badge tone={varianceTone(row.variance)}>
                    {row.variancePct.toFixed(1)} %
                  </Badge>
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan={6} class="px-3 py-6 text-center text-sm text-ink-faint">
                  Aucune ligne budgétaire.
                </td>
              </tr>
            {/each}
          </tbody>
          <!-- Totals row -->
          <tfoot class="border-t-2 border-edge">
            <tr class="text-sm font-bold bg-surface-muted/30">
              <td class="px-3 py-3" colspan={2}>Total</td>
              <td class="px-3 py-3 text-right tabular-nums">{money(varianceResult.totalBudget)}</td>
              <td class="px-3 py-3 text-right tabular-nums">{money(varianceResult.totalActual)}</td>
              <td class="px-3 py-3 text-right tabular-nums">
                <span class={varianceResult.totalVariance < 0 ? 'text-danger' : 'text-ok'}>
                  {signedMoney(varianceResult.totalVariance)}
                </span>
              </td>
              <td class="px-3 py-3 text-right">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    {:else if !loadingVariance && !errorVariance}
      <EmptyState title="Aucune donnée" message="Aucun écart disponible pour ce budget." />
    {/if}
    {#snippet footer()}<div class="flex justify-end">
        <Button variant="ghost" onclick={closeVariance}>Fermer</Button>
      </div>{/snippet}
  </Modal>
{/if}
