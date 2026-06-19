<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS, IMPORT_TARGETS, parseCsv, type Paginated } from '@pulsar/shared';
  import type { ImportStatus, ImportTarget } from '@pulsar/shared';
  import { submitCsvImport } from '$lib/api/files';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Badge,
    Card,
    EmptyState,
    ErrorNotice,
    Modal,
    Select,
    Skeleton,
    Table,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ──────────────────────────────────────────────────────────────────

  interface ImportBatch {
    id: string;
    number: string;
    target: string;
    status: ImportStatus;
    totalRows: number;
    importedRows: number;
    failedRows: number;
    documentId: string | null;
    createdAt: string;
  }

  interface ImportRow {
    rowIndex: number;
    status: 'IMPORTED' | 'FAILED';
    error: string | null;
    data: Record<string, unknown> | null;
  }

  interface ImportBatchDetail extends ImportBatch {
    rows: ImportRow[];
  }

  // ── State: list ────────────────────────────────────────────────────────────

  let items = $state<ImportBatch[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 20;
  let loading = $state(true);
  let listError = $state('');

  // ── State: detail modal ────────────────────────────────────────────────────

  let detailOpen = $state(false);
  let selectedBatch = $state<ImportBatchDetail | null>(null);
  let detailLoading = $state(false);

  // ── State: wizard ──────────────────────────────────────────────────────────

  let wizardOpen = $state(false);
  let wizardTarget = $state('');
  let wizardFile = $state<File | null>(null);
  let wizardHeaders = $state<string[]>([]);
  // mapping: dtoField → csvHeader (empty string = not mapped)
  let wizardMapping = $state<Record<string, string>>({});
  let wizardSubmitting = $state(false);
  let wizardError = $state('');
  let wizardSuccess = $state<ImportBatch | null>(null);

  // ── Permissions ────────────────────────────────────────────────────────────

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.CONNECT_MANAGE) ?? false,
  );

  // ── Derived wizard helpers ─────────────────────────────────────────────────

  const selectedTarget = $derived<ImportTarget | null>(
    IMPORT_TARGETS.find((t: ImportTarget) => t.key === wizardTarget) ?? null,
  );

  const requiredMapped = $derived(
    selectedTarget
      ? selectedTarget.requiredColumns.every(
          (col: string) => wizardMapping[col] && wizardMapping[col] !== '',
        )
      : false,
  );

  const wizardReady = $derived(
    !!wizardTarget && !!wizardFile && wizardHeaders.length > 0 && requiredMapped,
  );

  const totalPages = $derived(Math.ceil(total / pageSize));

  // ── Helpers ────────────────────────────────────────────────────────────────

  function statusTone(status: ImportStatus): Tone {
    if (status === 'COMPLETED') return 'ok';
    if (status === 'PROCESSING') return 'info';
    if (status === 'PENDING') return 'warn';
    if (status === 'FAILED') return 'danger';
    return 'neutral';
  }

  function rowStatusTone(status: 'IMPORTED' | 'FAILED'): Tone {
    return status === 'IMPORTED' ? 'ok' : 'danger';
  }

  function autoMap(headers: string[], target: ImportTarget): Record<string, string> {
    const allFields = [...target.requiredColumns, ...target.optionalColumns];
    const mapping: Record<string, string> = {};
    for (const field of allFields) {
      if (headers.includes(field)) {
        mapping[field] = field;
      }
    }
    return mapping;
  }

  // ── Load list ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    listError = '';
    try {
      const res = await api<Paginated<ImportBatch>>('/connect/imports', {
        query: { page, pageSize },
      });
      items = res.items;
      total = res.total;
    } catch (e) {
      listError = e instanceof ApiError ? e.message : 'Failed to load imports';
    } finally {
      loading = false;
    }
  }

  // ── Open batch detail ──────────────────────────────────────────────────────

  async function openDetail(batch: ImportBatch) {
    selectedBatch = { ...batch, rows: [] };
    detailOpen = true;
    detailLoading = true;
    try {
      const detail = await api<ImportBatchDetail>(`/connect/imports/${batch.id}`);
      selectedBatch = detail;
    } catch {
      // non-fatal
    } finally {
      detailLoading = false;
    }
  }

  // ── Wizard: file picked ────────────────────────────────────────────────────

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    wizardFile = file;
    wizardHeaders = [];
    wizardMapping = {};
    wizardError = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev: ProgressEvent<FileReader>) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const { headers } = parseCsv(text);
      wizardHeaders = headers;
      if (selectedTarget) {
        wizardMapping = autoMap(headers, selectedTarget);
      }
    };
    reader.readAsText(file);
  }

  // ── Wizard: target changed ─────────────────────────────────────────────────

  // Re-auto-map when target changes and headers are already loaded
  $effect(() => {
    const target = selectedTarget;
    const headers = wizardHeaders;
    if (target && headers.length > 0) {
      wizardMapping = autoMap(headers, target);
    } else if (!target) {
      wizardMapping = {};
    }
  });

  // ── Wizard: submit ─────────────────────────────────────────────────────────

  async function submitWizard() {
    if (!wizardReady || !wizardFile) return;
    wizardSubmitting = true;
    wizardError = '';
    wizardSuccess = null;

    // Build mapping: only include entries with a chosen header
    const mapping: Record<string, string> = {};
    for (const [field, header] of Object.entries(wizardMapping)) {
      if (header) mapping[field] = header;
    }

    try {
      const batch = await submitCsvImport<ImportBatch>(wizardFile, wizardTarget, mapping);
      wizardSuccess = batch;
      await load();
    } catch (e) {
      wizardError = e instanceof Error ? e.message : 'Import failed';
    } finally {
      wizardSubmitting = false;
    }
  }

  // ── Wizard: reset ──────────────────────────────────────────────────────────

  function resetWizard() {
    wizardTarget = '';
    wizardFile = null;
    wizardHeaders = [];
    wizardMapping = {};
    wizardError = '';
    wizardSuccess = null;
  }

  // ── Reactivity ────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Imports CSV"
  subtitle="Chargement de données en masse : clients, transporteurs, lieux, articles. Historique des imports et détail des lignes."
  count={loading ? undefined : total}
>
  {#snippet actions()}
    {#if canManage}
      <button
        type="button"
        class="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong"
        onclick={() => { resetWizard(); wizardOpen = true; }}
      >
        Nouvel import
      </button>
    {/if}
  {/snippet}
</PageHeader>

<ErrorNotice message={listError} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if items.length === 0}
  <EmptyState
    title="Aucun import"
    message="Aucun batch d'import trouvé. Utilisez le bouton 'Nouvel import' pour démarrer."
  />
{:else}
  <Table>
    {#snippet head()}
      <th>Numéro</th>
      <th>Cible</th>
      <th>Statut</th>
      <th>Total</th>
      <th>Importés</th>
      <th>Échecs</th>
      <th>Date</th>
    {/snippet}
    {#snippet body()}
      {#each items as batch (batch.id)}
        <tr
          class="cursor-pointer"
          onclick={() => void openDetail(batch)}
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && void openDetail(batch)}
          tabindex="0"
          role="button"
          aria-label="Voir le batch {batch.number}"
        >
          <td class="font-mono text-xs">{batch.number}</td>
          <td class="text-sm text-ink">{batch.target}</td>
          <td><Badge tone={statusTone(batch.status)}>{batch.status}</Badge></td>
          <td class="text-sm text-ink-muted">{batch.totalRows}</td>
          <td class="text-sm text-ok">{batch.importedRows}</td>
          <td class={batch.failedRows > 0 ? 'text-sm text-danger' : 'text-sm text-ink-muted'}>
            {batch.failedRows}
          </td>
          <td class="text-xs text-ink-muted">{formatDateTime(batch.createdAt)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>

  {#if totalPages > 1}
    <div class="mt-3 flex items-center justify-between text-xs text-ink-muted">
      <span>{total} imports · page {page} / {totalPages}</span>
      <div class="flex gap-2">
        <button
          class="rounded-md border border-edge px-3 py-1.5 hover:bg-surface-muted disabled:opacity-40"
          disabled={page <= 1}
          onclick={() => { page -= 1; void load(); }}
        >Préc.</button>
        <button
          class="rounded-md border border-edge px-3 py-1.5 hover:bg-surface-muted disabled:opacity-40"
          disabled={page >= totalPages}
          onclick={() => { page += 1; void load(); }}
        >Suiv.</button>
      </div>
    </div>
  {/if}
{/if}

<!-- Batch detail modal -->
<Modal bind:open={detailOpen} title="Détail de l'import" size="xl">
  {#if selectedBatch}
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-sm font-semibold text-ink">{selectedBatch.number}</span>
        <Badge tone={statusTone(selectedBatch.status)}>{selectedBatch.status}</Badge>
        <span class="text-xs text-ink-muted">Cible: {selectedBatch.target}</span>
      </div>

      <div class="grid grid-cols-3 gap-3 text-sm">
        <div class="rounded-xl bg-surface-muted p-3">
          <p class="text-xs text-ink-faint">Total</p>
          <p class="mt-1 text-xl font-semibold text-ink">{selectedBatch.totalRows}</p>
        </div>
        <div class="rounded-xl bg-surface-muted p-3">
          <p class="text-xs text-ink-faint">Importés</p>
          <p class="mt-1 text-xl font-semibold text-ok">{selectedBatch.importedRows}</p>
        </div>
        <div class="rounded-xl bg-surface-muted p-3">
          <p class="text-xs text-ink-faint">Échecs</p>
          <p class="mt-1 text-xl font-semibold {selectedBatch.failedRows > 0 ? 'text-danger' : 'text-ink'}">
            {selectedBatch.failedRows}
          </p>
        </div>
      </div>

      <p class="text-xs text-ink-faint">Créé le: {formatDateTime(selectedBatch.createdAt)}</p>

      {#if detailLoading}
        <Skeleton rows={4} />
      {:else if selectedBatch.rows.length === 0}
        <p class="text-xs text-ink-faint">Aucune ligne à afficher.</p>
      {:else}
        <div class="overflow-hidden rounded-card border border-edge-soft">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr class="border-b border-edge bg-surface-muted text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th class="px-3 py-2">#</th>
                <th class="px-3 py-2">Statut</th>
                <th class="px-3 py-2">Erreur</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedBatch.rows as row (row.rowIndex)}
                <tr class="border-b border-edge-soft last:border-b-0">
                  <td class="px-3 py-2 font-mono text-ink-muted">{row.rowIndex}</td>
                  <td class="px-3 py-2">
                    <Badge tone={rowStatusTone(row.status)}>{row.status}</Badge>
                  </td>
                  <td class="max-w-xs truncate px-3 py-2 text-ink-muted">{row.error ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</Modal>

<!-- CSV Import Wizard Modal -->
<Modal bind:open={wizardOpen} title="Nouvel import CSV" size="xl">
  <div class="space-y-5">
    {#if wizardError}
      <div class="rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
        {wizardError}
      </div>
    {/if}

    {#if wizardSuccess}
      <div class="rounded-card border border-ok/25 bg-ok-soft px-4 py-3 text-sm">
        <p class="font-semibold text-ok">Import soumis avec succès</p>
        <p class="mt-1 text-xs text-ink-muted">
          Batch <span class="font-mono">{wizardSuccess.number}</span> ·
          {wizardSuccess.totalRows} lignes envoyées ·
          Statut: {wizardSuccess.status}
        </p>
        <div class="mt-3 flex gap-2">
          <button
            class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
            onclick={resetWizard}
          >Importer un autre fichier</button>
          <button
            class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
            onclick={() => (wizardOpen = false)}
          >Fermer</button>
        </div>
      </div>
    {:else}
      <!-- Step 1: Select target -->
      <section class="rounded-2xl border border-edge p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
          1 · Choisir la cible
        </p>
        <label class="mt-3 block space-y-1 text-xs font-semibold text-ink-muted">
          Type de données
          <Select bind:value={wizardTarget} required>
            <option value="">— Sélectionner —</option>
            {#each IMPORT_TARGETS as target (target.key)}
              <option value={target.key}>{target.label}</option>
            {/each}
          </Select>
        </label>
        {#if selectedTarget}
          <div class="mt-2 flex flex-wrap gap-1 text-xs">
            <span class="text-ink-faint">Colonnes requises :</span>
            {#each selectedTarget.requiredColumns as col (col)}
              <span class="rounded-full bg-warn-soft px-2 py-0.5 font-mono text-warn">{col}</span>
            {/each}
            {#if selectedTarget.optionalColumns.length > 0}
              <span class="ml-1 text-ink-faint">optionelles :</span>
              {#each selectedTarget.optionalColumns as col (col)}
                <span class="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-ink-muted">{col}</span>
              {/each}
            {/if}
          </div>
        {/if}
      </section>

      <!-- Step 2: Upload CSV -->
      <section class="rounded-2xl border border-edge p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
          2 · Fichier CSV
        </p>
        <label class="mt-3 block space-y-1 text-xs font-semibold text-ink-muted">
          Fichier (.csv)
          <input
            type="file"
            accept=".csv,text/csv"
            class="mt-1 block w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-accent-strong"
            onchange={onFileChange}
          />
        </label>
        {#if wizardFile && wizardHeaders.length > 0}
          <p class="mt-2 text-xs text-ink-faint">
            <span class="font-semibold text-ink">{wizardHeaders.length}</span> colonnes détectées :
            {wizardHeaders.join(', ')}
          </p>
        {:else if wizardFile}
          <p class="mt-2 text-xs text-danger">Impossible de lire les en-têtes du fichier.</p>
        {/if}
      </section>

      <!-- Step 3: Mapping (only when target + headers are ready) -->
      {#if selectedTarget && wizardHeaders.length > 0}
        <section class="rounded-2xl border border-edge p-4">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
            3 · Mapping des colonnes
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            Pour chaque champ DTO, choisissez la colonne CSV correspondante.
          </p>

          <div class="mt-3 space-y-2">
            <!-- Required fields -->
            {#each selectedTarget.requiredColumns as field (field)}
              {@const fieldKey = field}
              <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div class="flex items-center gap-1">
                  <span class="rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold text-warn">requis</span>
                  <span class="font-mono text-xs text-ink">{fieldKey}</span>
                </div>
                <span class="text-xs text-ink-faint">→</span>
                <select
                  value={wizardMapping[fieldKey] ?? ''}
                  required
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                  onchange={(e: Event) => {
                    wizardMapping = {
                      ...wizardMapping,
                      [fieldKey]: (e.currentTarget as HTMLSelectElement).value,
                    };
                  }}
                >
                  <option value="">— Choisir —</option>
                  {#each wizardHeaders as header (header)}
                    <option value={header}>{header}</option>
                  {/each}
                </select>
              </div>
            {/each}

            <!-- Optional fields -->
            {#each selectedTarget.optionalColumns as field (field)}
              {@const fieldKey = field}
              <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div class="flex items-center gap-1">
                  <span class="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-faint">optionnel</span>
                  <span class="font-mono text-xs text-ink-muted">{fieldKey}</span>
                </div>
                <span class="text-xs text-ink-faint">→</span>
                <select
                  value={wizardMapping[fieldKey] ?? ''}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                  onchange={(e: Event) => {
                    wizardMapping = {
                      ...wizardMapping,
                      [fieldKey]: (e.currentTarget as HTMLSelectElement).value,
                    };
                  }}
                >
                  <option value="">— Ignorer —</option>
                  {#each wizardHeaders as header (header)}
                    <option value={header}>{header}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Submit -->
      <div class="flex items-center justify-between gap-3 border-t border-edge-soft pt-3">
        <button
          type="button"
          class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
          onclick={() => (wizardOpen = false)}
        >Annuler</button>

        <button
          type="button"
          disabled={!wizardReady || wizardSubmitting}
          class="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          onclick={() => void submitWizard()}
        >
          {wizardSubmitting ? 'Envoi en cours…' : "Lancer l'import"}
        </button>
      </div>
    {/if}
  </div>
</Modal>
