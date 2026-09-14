<script module lang="ts">
  export interface LineItem {
    id: string;
    name: string;
    quantity: number;
    unitPrice: string | number;
    discountPct: string | number;
    productId: string | null;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Check, Plus, Trash2, X } from 'lucide-svelte';
  import { computeLineTotal } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatMoney } from '$lib/format';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    Button,
    Card,
    Drawer,
    EntityPicker,
    ErrorNotice,
    Field,
    Input,
    Skeleton,
  } from '$lib/components/ui';

  let {
    endpoint,
    lines,
    currency,
    total,
    editable = true,
    loading = false,
    error = '',
    onretry,
    onchanged,
  }: {
    endpoint: string;
    lines: LineItem[];
    currency: string;
    total: string | number | null;
    editable?: boolean;
    loading?: boolean;
    error?: string;
    onretry: () => void;
    onchanged: () => Promise<void>;
  } = $props();

  type NumericField = 'quantity' | 'unitPrice' | 'discountPct';
  const fields: { key: NumericField; label: string }[] = [
    { key: 'quantity', label: 'Quantité' },
    { key: 'unitPrice', label: 'Prix unitaire' },
    { key: 'discountPct', label: 'Remise (%)' },
  ];
  let editing = $state<{ id: string; field: NumericField; value: number | undefined } | null>(null);
  let busy = $state(false);
  let mutationError = $state('');
  let showAdd = $state(false);
  let mode = $state<'catalog' | 'free'>('catalog');
  let productId = $state('');
  let name = $state('');
  let quantity = $state<number | null>(1);
  let unitPrice = $state<number | null>(0);
  let addError = $state('');
  const dirty = $derived(!!productId || !!name.trim() || quantity !== 1 || unitPrice !== 0);

  $effect(() => {
    endpoint;
    untrack(() => {
      editing = null;
      showAdd = false;
      mutationError = '';
      resetAdd();
    });
  });

  function resetAdd() {
    productId = '';
    name = '';
    quantity = 1;
    unitPrice = 0;
    addError = '';
  }
  function focusInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  function numericLabel(line: LineItem, field: NumericField) {
    if (field === 'unitPrice') return formatMoney(line[field], currency);
    return (
      new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 4 }).format(Number(line[field])) +
      (field === 'discountPct' ? ' %' : '')
    );
  }
  function beginEdit(line: LineItem, field: NumericField) {
    if (busy || !editable) return;
    editing = { id: line.id, field, value: Number(line[field]) };
    mutationError = '';
  }
  async function saveCell(event: SubmitEvent) {
    event.preventDefault();
    if (!editing || busy || !editable) return;
    const draft = editing;
    if (
      draft.value == null ||
      !Number.isFinite(draft.value) ||
      draft.value < 0 ||
      (draft.field === 'discountPct' && draft.value > 100)
    ) {
      mutationError = 'Saisissez un nombre positif ou nul. La remise ne peut pas dépasser 100 %.';
      return;
    }
    busy = true;
    mutationError = '';
    try {
      await api(`${endpoint}/${draft.id}`, {
        method: 'PATCH',
        body: { [draft.field]: draft.value },
      });
      editing = null;
      await onchanged();
    } catch (e) {
      mutationError =
        e instanceof ApiError
          ? e.message
          : 'Modification non enregistrée. Votre saisie est conservée.';
    } finally {
      busy = false;
    }
  }
  async function addLine(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !editable) return;
    if (
      quantity == null ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      (mode === 'catalog'
        ? !productId
        : !name.trim() || unitPrice == null || !Number.isFinite(unitPrice) || unitPrice < 0)
    ) {
      addError = 'Choisissez un produit ou renseignez le libellé, le prix et la quantité.';
      return;
    }
    busy = true;
    addError = '';
    try {
      await api(endpoint, {
        method: 'POST',
        body:
          mode === 'catalog' ? { productId, quantity } : { name: name.trim(), unitPrice, quantity },
      });
      showAdd = false;
      resetAdd();
      await onchanged();
    } catch (e) {
      addError =
        e instanceof ApiError ? e.message : 'Ligne non ajoutée. Votre saisie est conservée.';
    } finally {
      busy = false;
    }
  }
  async function remove(line: LineItem) {
    if (busy || !editable) return;
    const path = endpoint;
    if (
      !(await confirmAction(`Supprimer la ligne « ${line.name} » ?`, {
        title: 'Supprimer une ligne',
        confirmLabel: 'Supprimer',
      })) ||
      path !== endpoint ||
      busy ||
      !editable
    )
      return;
    busy = true;
    mutationError = '';
    try {
      await api(`${path}/${line.id}`, { method: 'DELETE' });
      await onchanged();
    } catch (e) {
      mutationError = e instanceof ApiError ? e.message : 'Impossible de supprimer la ligne';
    } finally {
      busy = false;
    }
  }
  function closeAdd() {
    if (busy) return false;
    if (!dirty) return true;
    void confirmAction('Abandonner la saisie de cette ligne ?', {
      title: 'Saisie non enregistrée',
      confirmLabel: 'Abandonner',
    }).then((ok) => {
      if (ok) {
        showAdd = false;
        resetAdd();
      }
    });
    return false;
  }
</script>

<Card>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold text-ink">
        Lignes <span class="ml-1 font-mono text-xs text-ink-muted">{lines.length}</span>
      </h2>
      <p class="mt-1 text-xs text-ink-muted">
        {editable
          ? 'Cliquez sur un montant ou une quantité pour le modifier.'
          : 'Lecture seule · les lignes de ce dossier ne sont pas modifiables.'}
      </p>
    </div>
    {#if editable}<Button
        variant="secondary"
        disabled={busy || !!editing || loading || !!error}
        onclick={() => {
          resetAdd();
          mode = 'catalog';
          showAdd = true;
        }}><Plus size={15} />Ajouter une ligne</Button
      >{/if}
  </div>
  <ErrorNotice message={error} {onretry} />
  <ErrorNotice message={mutationError} />
  {#if loading}<Skeleton rows={4} />
  {:else if !error && !lines.length}<div
      class="rounded-md border border-dashed border-edge px-4 py-7 text-center text-sm text-ink-muted"
    >
      Aucune ligne. {editable ? 'Ajoutez un produit du catalogue ou une ligne libre.' : ''}
    </div>
  {:else if !error}
    <div class="relative overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">Lignes du dossier · montants en {currency}</caption>
        <thead
          ><tr class="border-b border-edge text-xs text-ink-muted"
            ><th scope="col" class="py-2 text-left font-medium">Libellé</th
            >{#each fields as field}<th
                scope="col"
                class="px-2 py-2 text-right font-medium whitespace-nowrap">{field.label}</th
              >{/each}<th scope="col" class="py-2 text-right font-medium">Total</th
            >{#if editable}<th scope="col"><span class="sr-only">Actions</span></th>{/if}</tr
          ></thead
        >
        <tbody>
          {#each lines as line (line.id)}
            <tr class="border-b border-edge/60 last:border-0">
              <th scope="row" class="min-w-32 py-3 pr-3 text-left font-medium text-ink"
                >{line.name}</th
              >
              {#each fields as field (field.key)}
                <td class="px-1 py-2 text-right tabular-nums">
                  {#if editable && editing?.id === line.id && editing.field === field.key}
                    <form class="flex items-center justify-end gap-1" onsubmit={saveCell}>
                      <input
                        use:focusInput
                        aria-label={`${field.label} · ${line.name}`}
                        type="number"
                        min="0"
                        max={field.key === 'discountPct' ? 100 : undefined}
                        step="any"
                        required
                        bind:value={editing.value}
                        disabled={busy}
                        onkeydown={(e) => {
                          if (e.key === 'Escape' && !busy) {
                            e.preventDefault();
                            editing = null;
                            mutationError = '';
                          }
                        }}
                        class="w-24 rounded-md border border-accent bg-surface px-2 py-1.5 text-right text-sm focus:outline-2 focus:outline-accent"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        aria-label="Enregistrer la cellule"
                        class="rounded-md p-2 text-accent hover:bg-surface-muted disabled:opacity-50"
                        ><Check size={15} /></button
                      >
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="Annuler la modification"
                        onclick={() => {
                          editing = null;
                          mutationError = '';
                        }}
                        class="rounded-md p-2 text-ink-muted hover:bg-surface-muted"
                        ><X size={15} /></button
                      >
                    </form>
                  {:else if editable}
                    <button
                      disabled={busy || !!editing}
                      onclick={() => beginEdit(line, field.key)}
                      aria-label={`Modifier ${field.label.toLowerCase()} · ${line.name}`}
                      class="rounded-md px-2 py-1.5 text-right whitespace-nowrap transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                      >{numericLabel(line, field.key)}</button
                    >
                  {:else}<span class="px-2 whitespace-nowrap">{numericLabel(line, field.key)}</span
                    >{/if}
                </td>
              {/each}
              <td class="py-3 pl-2 text-right font-medium whitespace-nowrap tabular-nums"
                >{formatMoney(
                  computeLineTotal({
                    quantity: Number(line.quantity),
                    unitPrice: Number(line.unitPrice),
                    discountPct: Number(line.discountPct),
                  }),
                  currency,
                )}</td
              >
              {#if editable}<td class="pl-2"
                  ><button
                    type="button"
                    disabled={busy || !!editing}
                    onclick={() => void remove(line)}
                    aria-label={`Supprimer ${line.name}`}
                    class="rounded-md p-2 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                    ><Trash2 size={15} /></button
                  ></td
                >{/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <div class="mt-4 flex items-center justify-end gap-4 border-t border-edge pt-4">
    <span class="text-xs text-ink-muted">Total du dossier · {currency}</span><span
      class="text-lg font-semibold tabular-nums text-ink"
      >{total == null ? '—' : formatMoney(total, currency)}</span
    >
  </div>
</Card>

<Drawer
  bind:open={showAdd}
  title="Ajouter une ligne"
  width="md"
  dismissible={!busy}
  onbeforeclose={closeAdd}
>
  <form id="add-record-line" class="space-y-5" onsubmit={addLine}>
    <fieldset disabled={busy} class="space-y-5">
      <legend class="sr-only">Source de la ligne</legend>
      <div class="flex gap-2">
        <Button
          variant={mode === 'catalog' ? 'primary' : 'secondary'}
          onclick={() => {
            mode = 'catalog';
          }}>Depuis le catalogue</Button
        ><Button
          variant={mode === 'free' ? 'primary' : 'secondary'}
          onclick={() => {
            mode = 'free';
          }}>Ligne libre</Button
        >
      </div>
      <ErrorNotice message={addError} />
      {#if mode === 'catalog'}<div>
          <p class="mb-1.5 text-xs font-medium text-ink-muted">Produit</p>
          <EntityPicker
            endpoint="/crm/products"
            label="Produit"
            filters={{ active: 'true' }}
            bind:value={productId}
            disabled={busy}
          />
          <p class="mt-2 text-xs text-ink-muted">
            Le libellé et le prix seront repris du catalogue à l’ajout.
          </p>
        </div>
      {:else}<Field label="Libellé"><Input bind:value={name} required /></Field><Field
          label={`Prix unitaire (${currency})`}
          ><Input type="number" min="0" step="any" bind:value={unitPrice} required /></Field
        >{/if}
      <Field label="Quantité"
        ><Input type="number" min="0" step="any" bind:value={quantity} required /></Field
      >
    </fieldset>
  </form>
  {#snippet footer()}<Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        if (closeAdd()) showAdd = false;
      }}>Annuler</Button
    ><button
      type="submit"
      form="add-record-line"
      disabled={busy}
      class="inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >{busy ? 'Ajout…' : 'Ajouter la ligne'}</button
    >{/snippet}
</Drawer>
