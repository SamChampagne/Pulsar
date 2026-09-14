<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import {
    BANK_CSV_MAX_CHARS,
    BANK_CSV_MAX_ROWS,
    type BankCsvPreview,
    type BankCsvImportResult,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatMoney } from '$lib/format';
  import {
    Drawer,
    Button,
    Field,
    Textarea,
    Badge,
    ErrorNotice,
    Skeleton,
    Table,
  } from '$lib/components/ui';

  let {
    open = $bindable(false),
    accountId,
    accountName,
    onimported,
  }: {
    open?: boolean;
    accountId: string;
    accountName: string;
    onimported: () => void | Promise<void>;
  } = $props();
  let csv = $state(''),
    fileName = $state(''),
    fileError = $state(''),
    error = $state('');
  let preview = $state<BankCsvPreview | null>(null),
    result = $state<BankCsvImportResult | null>(null);
  let inspectedCsv = $state(''),
    inspectedAccount = $state('');
  let checking = $state(false),
    saving = $state(false),
    readingFile = $state(false),
    uncertain = $state(false);
  let page = $state(1),
    generation = 0,
    fileGeneration = 0;
  const busy = $derived(checking || saving || readingFile);
  const validPreview = $derived(
    !!preview && csv === inspectedCsv && accountId === inspectedAccount,
  );
  const displayRows = $derived(preview?.rows.slice((page - 1) * 25, page * 25) ?? []);
  const labels = {
    NEW: 'À importer',
    DUPLICATE_FILE: 'Répétée dans le CSV',
    DUPLICATE_EXISTING: 'Déjà présente',
  };

  $effect(() => {
    if (!open) {
      generation++;
      fileGeneration++;
      checking = false;
      readingFile = false;
    }
  });
  $effect(() => {
    const id = accountId;
    untrack(() => {
      if (inspectedAccount && id !== inspectedAccount) {
        generation++;
        preview = null;
        checking = false;
        result = null;
      }
    });
  });
  onDestroy(() => {
    generation++;
    fileGeneration++;
  });
  beforeNavigate(({ cancel }) => {
    if (!open || result || (!busy && !csv.trim())) return;
    cancel();
    if (busy) error = 'Attendez la fin de l’opération avant de quitter cette page.';
    else close();
  });

  function close() {
    if (busy) return false;
    if (!csv.trim() || result) return true;
    void confirmAction(
      uncertain
        ? 'La réponse d’import n’a pas été confirmée. La saisie sera conservée ici; vérifiez le relevé avant un nouvel essai.'
        : 'Le CSV n’est pas importé. La saisie restera disponible tant que cette page reste ouverte.',
      { title: 'Fermer la préparation ?', confirmLabel: 'Fermer la préparation' },
    ).then((accepted) => {
      if (accepted) open = false;
    });
    return false;
  }
  async function readFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy) return;
    const request = ++fileGeneration;
    fileError = '';
    preview = null;
    readingFile = true;
    try {
      if (file.size > BANK_CSV_MAX_CHARS * 3)
        throw new Error('Fichier trop volumineux. Limite : 30 000 caractères.');
      const text = await file.text();
      if (request !== fileGeneration) return;
      if (text.length > BANK_CSV_MAX_CHARS || text.includes('\uFFFD'))
        throw new Error('Utilisez un fichier UTF-8 de 30 000 caractères maximum.');
      csv = text;
      fileName = file.name;
      preview = null;
      result = null;
      error = '';
      uncertain = false;
    } catch (e) {
      if (request === fileGeneration)
        fileError = e instanceof Error ? e.message : 'Impossible de lire ce fichier.';
    } finally {
      if (request === fileGeneration) readingFile = false;
    }
  }
  async function inspect() {
    if (busy || !accountId || !csv.trim() || csv.length > BANK_CSV_MAX_CHARS) return;
    fileError = '';
    const request = ++generation,
      text = csv,
      id = accountId;
    checking = true;
    error = '';
    result = null;
    preview = null;
    page = 1;
    try {
      const data = await api<BankCsvPreview>('/billing/bank-transactions/import/preview', {
        method: 'POST',
        body: { bankAccountId: id, csv: text },
      });
      if (request === generation && id === accountId && text === csv) {
        preview = data;
        inspectedCsv = text;
        inspectedAccount = id;
      }
    } catch (e) {
      if (request === generation)
        error =
          e instanceof ApiError ? e.message : 'Impossible de prévisualiser. Aucun import lancé.';
    } finally {
      if (request === generation) checking = false;
    }
  }
  async function commit() {
    if (busy || !validPreview || !preview?.canImport || result) return;
    const data = preview,
      text = csv,
      id = accountId;
    saving = true;
    error = '';
    try {
      if (
        !(await confirmAction(
          `Ajouter au maximum ${data.totals.newCount} mouvement(s) au compte « ${accountName} » (${data.currency}) ? ${data.totals.duplicateCount} doublon(s) seront ignorés. Le serveur revérifiera les doublons. Aucun paiement, rapprochement ni transfert bancaire ne sera créé.`,
          { title: 'Importer le relevé ?', confirmLabel: 'Confirmer l’import', dangerous: false },
        ))
      )
        return;
      if (id !== accountId || text !== csv) return;
      const response = await api<BankCsvImportResult>('/billing/bank-transactions/import', {
        method: 'POST',
        body: { bankAccountId: id, csv: text, previewHash: data.previewHash },
      });
      result = response;
      uncertain = false;
      await onimported();
    } catch (e) {
      uncertain = true;
      error =
        e instanceof ApiError
          ? e.message
          : 'Réponse non confirmée. Vérifiez le relevé ou réessayez avec le même CSV : les doublons seront ignorés.';
    } finally {
      saving = false;
    }
  }
</script>

<Drawer
  bind:open
  title="Importer un relevé CSV"
  width="xl"
  dismissible={!busy}
  onbeforeclose={close}
>
  <p class="mb-4 text-sm">
    <span class="text-ink-muted">Compte destinataire</span><br /><strong>{accountName}</strong>
  </p>
  {#if result}
    <div class="rounded-lg border border-edge bg-surface-muted p-4" role="status">
      <h3 class="text-sm font-semibold">Import terminé</h3>
      <p class="mt-2 text-sm">
        {result.imported} mouvement(s) ajouté(s) · {result.skipped} doublon(s) ignoré(s).
      </p>
      <p class="mt-2 text-xs text-ink-muted">
        Les nouveaux mouvements attendent leur rapprochement. Aucune écriture comptable ni aucun
        transfert n’a été créé.
      </p>
    </div>
    <div class="mt-4">
      <Button
        variant="secondary"
        onclick={() => {
          csv = '';
          preview = null;
          result = null;
          error = '';
          fileName = '';
        }}>Préparer un autre CSV</Button
      >
    </div>
  {:else}
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <div>
        <label for="bank-csv-file" class="mb-1 block text-xs font-medium text-ink-muted"
          >Fichier CSV (UTF-8)</label
        ><input
          id="bank-csv-file"
          class="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-edge file:bg-surface file:px-3 file:py-2"
          type="file"
          accept=".csv,text/csv"
          onchange={readFile}
        />{#if fileName}<p class="mt-1 break-all text-xs text-ink-muted">{fileName}</p>{/if}
      </div>
      <ErrorNotice message={fileError} />
      <Field label="Contenu CSV"
        ><Textarea
          bind:value={csv}
          rows={6}
          placeholder={'date,description,amount,reference\n2026-09-14,Virement Transport du Fjord,-135.08,FJ-218'}
        /></Field
      >
      <p class="text-xs text-ink-muted">{csv.length} / {BANK_CSV_MAX_CHARS} caractères</p>
      {#if csv.length > BANK_CSV_MAX_CHARS}<p class="text-sm text-danger" role="alert">
          CSV trop volumineux. Divisez le relevé : aucun contenu n’a été tronqué.
        </p>{/if}
      <details class="text-xs leading-relaxed text-ink-muted">
        <summary class="cursor-pointer font-medium text-ink"
          >Format attendu et règle de doublons</summary
        >
        <p class="mt-2">
          Colonnes : date, description, amount (ou montant), reference facultative. Dates
          AAAA-MM-JJ, montants signés sans séparateur de milliers. Séparateur virgule ou
          point-virgule; guillemets acceptés. Maximum {BANK_CSV_MAX_ROWS} mouvements et 30 000 caractères.
          La devise est celle du compte.
        </p>
        <p class="mt-2">
          Même date, description, montant et référence = doublon potentiel ignoré. Deux mouvements
          réellement identiques nécessitent une vérification du relevé et une saisie manuelle
          explicite.
        </p>
      </details>
    </fieldset>
    {#if checking || readingFile}<div class="mt-4"><Skeleton rows={3} /></div>{/if}
    {#if preview && !validPreview}<p class="mt-4 text-sm text-warn" role="status">
        La saisie a changé. Prévisualisez de nouveau avant d’importer.
      </p>{/if}
    {#if preview && validPreview}
      {@const inspected = preview}
      <section class="mt-5 border-t border-edge pt-4" aria-label="Prévisualisation du relevé">
        <h3 class="text-sm font-semibold">Prévisualisation · {preview.currency}</h3>
        <p class="mt-2 text-sm">
          {preview.totals.newCount} à importer · {preview.totals.duplicateCount} doublon(s) · {preview
            .totals.invalidCount} erreur(s)
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          Entrées : {formatMoney(preview.totals.credits, preview.currency)} · Sorties : {formatMoney(
            preview.totals.debits,
            preview.currency,
          )} (nouveaux mouvements uniquement)
        </p>
        {#if preview.issues.length}<div
            class="my-3 rounded-md border border-danger/30 p-3"
            role="alert"
          >
            <p class="text-sm font-medium text-danger">
              Corrigez toutes les erreurs : aucun import partiel.
            </p>
            <ul class="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
              {#each preview.issues as issue, i (i)}<li>
                  Ligne {issue.line} : {issue.message}
                </li>{/each}
            </ul>
          </div>{/if}
        {#if !preview.canImport && !preview.issues.length}<p class="my-3 text-sm text-ink-muted">
            Tous les mouvements sont déjà présents ou répétés. Rien à importer.
          </p>{/if}
        <div class="mt-3">
          <Table>
            {#snippet head()}<th>Ligne</th><th>Mouvement</th><th class="text-right">Montant</th><th
                >Contrôle</th
              >{/snippet}
            {#snippet body()}{#each displayRows as row (row.line)}<tr
                  ><td class="font-mono text-xs">{row.line}</td><td
                    ><p class="max-w-64 whitespace-normal break-words text-sm">{row.description}</p>
                    <p class="text-xs text-ink-muted">{row.date}</p>
                    {#if row.reference}<p
                        class="max-w-64 whitespace-normal break-words font-mono text-xs text-ink-muted"
                      >
                        {row.reference}
                      </p>{/if}</td
                  ><td class="whitespace-nowrap text-right font-mono text-xs"
                    >{formatMoney(row.amount, inspected.currency)}</td
                  ><td
                    ><Badge tone={row.status === 'NEW' ? 'ok' : 'neutral'}
                      >{labels[row.status]}</Badge
                    ></td
                  ></tr
                >{/each}{/snippet}
          </Table>
        </div>
        {#if preview.rows.length > 25}<div
            class="mt-3 flex flex-wrap items-center justify-end gap-2"
          >
            <Button
              variant="ghost"
              disabled={page <= 1 || saving}
              onclick={() => {
                page--;
              }}>Précédent</Button
            ><span class="text-xs">Page {page} / {Math.ceil(preview.rows.length / 25)}</span><Button
              variant="ghost"
              disabled={page * 25 >= preview.rows.length || saving}
              onclick={() => {
                page++;
              }}>Suivant</Button
            >
          </div>{/if}
      </section>
    {/if}
  {/if}
  <div class="mt-4"><ErrorNotice message={error} /></div>
  {#snippet footer()}
    {#if result}<Button
        onclick={() => {
          open = false;
        }}>Voir les mouvements</Button
      >
    {:else}<Button
        variant="secondary"
        disabled={busy || !csv.trim() || !accountId || csv.length > BANK_CSV_MAX_CHARS}
        loading={checking}
        onclick={inspect}>Prévisualiser</Button
      ><Button
        disabled={busy || !validPreview || !preview?.canImport}
        loading={saving}
        onclick={commit}>Importer</Button
      >{/if}
  {/snippet}
</Drawer>
