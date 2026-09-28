<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatMoney } from '$lib/format';
  import { type OpenInvoice, invoiceHref } from '$lib/billing/payments';
  import {
    RecordHeader,
    Button,
    Card,
    Field,
    Input,
    Select,
    Textarea,
    EntityPicker,
    ErrorNotice,
    Skeleton,
    EmptyState,
  } from '$lib/components/ui';

  interface Mode {
    id: string;
    name: string;
    isDefault: boolean;
  }
  let type = $state<'RECEIVE' | 'PAY'>('RECEIVE');
  let partyId = $state('');
  let modeOfPaymentId = $state('');
  let date = $state(new Date().toLocaleDateString('en-CA'));
  let currency = $state('CAD');
  let totalOverride = $state<number | null>(null);
  let reference = $state('');
  let note = $state('');
  let modes = $state<Mode[]>([]);
  let invoices = $state<OpenInvoice[]>([]);
  let amounts = $state<Record<string, number>>({});
  let loadingInvoices = $state(false);
  let loadingModes = $state(true);
  let invoiceError = $state('');
  let modeError = $state('');
  let error = $state('');
  let saving = $state(false);
  let createdId = $state('');
  let initialized = $state(false);
  let generation = 0;
  let alive = true;
  const canManage = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.PAYMENTS_MANAGE),
  );
  const partyType = $derived(type === 'RECEIVE' ? 'CUSTOMER' : 'CARRIER');
  const currencies = $derived([...new Set(invoices.map((i) => i.currency))].sort());
  const visibleInvoices = $derived(invoices.filter((i) => i.currency === currency));
  const totalAllocated = $derived(
    visibleInvoices.reduce((sum, i) => sum + (Number(amounts[i.id]) || 0), 0),
  );
  const totalAmount = $derived(totalOverride ?? totalAllocated);
  const selectedCount = $derived(visibleInvoices.filter((i) => amounts[i.id] > 0).length);
  const remainder = $derived(totalAmount - totalAllocated);

  async function loadModes() {
    loadingModes = true;
    modeError = '';
    try {
      const result = await api<Mode[]>('/billing/modes-of-payment');
      if (!alive) return;
      modes = result;
      if (!modeOfPaymentId) modeOfPaymentId = result.find((m) => m.isDefault)?.id ?? '';
    } catch (e) {
      if (alive) modeError = e instanceof ApiError ? e.message : 'Modes de paiement indisponibles.';
    } finally {
      if (alive) loadingModes = false;
    }
  }

  async function loadInvoices(id: string, kind: string) {
    const request = ++generation;
    invoices = [];
    amounts = {};
    totalOverride = null;
    invoiceError = '';
    error = '';
    loadingInvoices = !!id;
    if (!id) return;
    try {
      const result = await api<OpenInvoice[]>('/billing/payments/open-invoices', {
        query: { partyId: id, partyType: kind },
      });
      if (request !== generation) return;
      invoices = result;
      const targetId = page.url.searchParams.get('target');
      const target = result.find((i) => i.id === targetId);
      currency = target?.currency ?? result[0]?.currency ?? 'CAD';
      // Only the invoice deliberately opened from its own dossier is preselected.
      if (target) amounts = { [target.id]: Number(target.outstanding) };
    } catch (e) {
      if (request === generation)
        invoiceError =
          e instanceof ApiError ? e.message : 'Impossible de charger les factures ouvertes.';
    } finally {
      if (request === generation) loadingInvoices = false;
    }
  }

  onMount(() => {
    type = page.url.searchParams.get('partyType') === 'CARRIER' ? 'PAY' : 'RECEIVE';
    partyId = page.url.searchParams.get('party') ?? '';
    initialized = true;
    void loadModes();
  });
  $effect(() => {
    const ready = initialized;
    const id = partyId;
    const kind = partyType;
    if (ready) untrack(() => void loadInvoices(id, kind));
  });
  onDestroy(() => {
    alive = false;
    generation++;
  });

  async function changeType(next: 'RECEIVE' | 'PAY') {
    if (next === type) return;
    if (
      selectedCount &&
      !(await confirmAction('Changer de type effacera les allocations sélectionnées.', {
        title: 'Changer de type de paiement ?',
        confirmLabel: 'Changer de type',
        dangerous: false,
      }))
    )
      return;
    partyId = '';
    type = next;
  }

  async function save() {
    if (saving || !canManage) return;
    if (createdId) {
      await goto(`/billing/payments/${createdId}`);
      return;
    }
    error = '';
    if (loadingInvoices || loadingModes || invoiceError || modeError) {
      error = 'Attendez le chargement des données ou réessayez.';
      return;
    }
    if (!partyId || !modeOfPaymentId || !date) {
      error = 'Sélectionnez le client ou transporteur, le mode de paiement et la date.';
      return;
    }
    if (!selectedCount) {
      error = 'Allouez un montant à au moins une facture.';
      return;
    }
    if (
      visibleInvoices.some(
        (i) =>
          !Number.isFinite(Number(amounts[i.id] ?? 0)) ||
          Number(amounts[i.id] ?? 0) < 0 ||
          Number(amounts[i.id] ?? 0) > Number(i.outstanding),
      )
    ) {
      error = 'Chaque allocation doit être comprise entre zéro et le solde de sa facture.';
      return;
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0 || totalAllocated > totalAmount + 1e-9) {
      error = 'Le montant déclaré doit couvrir les allocations et être supérieur à zéro.';
      return;
    }
    saving = true;
    try {
      const payment = await api<{ id: string }>('/billing/payments', {
        method: 'POST',
        body: {
          type,
          partyType,
          partyId,
          modeOfPaymentId,
          date: new Date(`${date}T12:00:00`).toISOString(),
          currency,
          totalAmount,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          allocations: visibleInvoices
            .filter((i) => amounts[i.id] > 0)
            .map((i) => ({
              targetType: i.targetType,
              targetId: i.id,
              amount: Number(amounts[i.id]),
            })),
        },
      });
      createdId = payment.id;
      toast.success('Brouillon enregistré. Vérifiez-le avant de le comptabiliser.');
      await goto(`/billing/payments/${payment.id}`);
    } catch (e) {
      error = createdId
        ? 'Le brouillon est enregistré. Ouvrez-le pour poursuivre.'
        : e instanceof ApiError
          ? e.message
          : 'Enregistrement non confirmé. Vérifiez la liste des paiements avant de réessayer.';
    } finally {
      saving = false;
    }
  }
</script>

<RecordHeader
  title="Nouveau paiement"
  kind="Facturation · Étape 1 sur 2"
  backHref="/billing/payments"
  backLabel="Paiements"
>
  {#snippet meta()}Préparez les allocations. Le brouillon ne modifie pas le grand livre.{/snippet}
</RecordHeader>

{#if !canManage}
  <EmptyState
    title="Accès en lecture seule"
    message="La gestion des paiements nécessite une permission supplémentaire."
  />
{:else}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
    class="max-w-6xl"
  >
    <fieldset
      disabled={saving || !!createdId}
      class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div class="min-w-0 space-y-5">
        <Card>
          <h2 class="mb-4 text-sm font-semibold">1. Qui règle qui ?</h2>
          <div class="mb-5 flex flex-wrap gap-2" role="group" aria-label="Type de paiement">
            <button
              type="button"
              aria-pressed={type === 'RECEIVE'}
              onclick={() => void changeType('RECEIVE')}
              class="rounded-md border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent {type ===
              'RECEIVE'
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-edge hover:bg-surface-muted'}">Encaissement client</button
            >
            <button
              type="button"
              aria-pressed={type === 'PAY'}
              onclick={() => void changeType('PAY')}
              class="rounded-md border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent {type ===
              'PAY'
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-edge hover:bg-surface-muted'}">Décaissement transporteur</button
            >
          </div>
          <p class="mb-1.5 text-xs font-medium text-ink-muted">
            {type === 'RECEIVE' ? 'Client' : 'Transporteur'}
          </p>
          <EntityPicker
            endpoint={type === 'RECEIVE' ? '/billing/payments/data/customers' : '/billing/payments/data/carriers'}
            label={type === 'RECEIVE' ? 'Client' : 'Transporteur'}
            bind:value={partyId}
            disabled={saving}
          />
        </Card>

        <Card>
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold">2. Choisir les factures</h2>
              <p class="mt-1 text-xs text-ink-muted">
                Un paiement, une devise. Saisissez un montant partiel ou prenez le solde.
              </p>
            </div>
            {#if currencies.length}<div class="w-32">
                <Field label="Devise"
                  ><Select
                    bind:value={currency}
                    onchange={() => {
                      amounts = {};
                      totalOverride = null;
                    }}
                    >{#each currencies as code}<option value={code}>{code}</option>{/each}</Select
                  ></Field
                >
              </div>{/if}
          </div>
          <ErrorNotice message={invoiceError} onretry={() => loadInvoices(partyId, partyType)} />
          {#if !partyId}<EmptyState
              title="Choisissez un client ou un transporteur"
              message="Ses factures approuvées avec un solde restant apparaîtront ici."
            />
          {:else if loadingInvoices}<Skeleton rows={4} />
          {:else if !invoiceError && !invoices.length}<EmptyState
              title="Aucune facture à régler"
              message="Seules les factures approuvées (ou envoyées côté client) avec un solde restant sont proposées."
            />
            <a class="mt-2 inline-block text-sm text-accent hover:underline" href="/invoices"
              >Consulter les factures et relevés</a
            >
          {:else if !invoiceError}
            {#if currencies.length > 1}<p
                class="mb-3 rounded-md bg-surface-muted p-3 text-xs text-ink-muted"
              >
                Des factures existent en {currencies.join(', ')}. Changer de devise efface les
                allocations de ce brouillon.
              </p>{/if}
            <ul class="divide-y divide-edge">
              {#each visibleInvoices as invoice (invoice.id)}
                <li class="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div class="min-w-0 flex-1 basis-40">
                    <a
                      class="font-mono text-sm font-medium text-accent hover:underline"
                      href={invoiceHref(invoice.targetType, invoice.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ouvrir ${invoice.invoiceNumber} (nouvel onglet)`}
                      >{invoice.invoiceNumber}</a
                    >
                    <p class="mt-1 text-xs text-ink-muted">
                      Restant dû <span class="font-mono text-ink"
                        >{formatMoney(invoice.outstanding, invoice.currency)}</span
                      >
                    </p>
                  </div>
                  <div class="flex max-w-full items-end gap-2">
                    <div class="w-36">
                      <Field label={`Allocation · ${invoice.invoiceNumber}`}>
                        <input
                          type="number"
                          min="0"
                          max={Number(invoice.outstanding)}
                          step="0.01"
                          value={amounts[invoice.id] ?? 0}
                          oninput={(e) => {
                            amounts[invoice.id] = e.currentTarget.valueAsNumber || 0;
                          }}
                          class="min-h-9 w-full rounded-md border border-edge bg-surface px-3 text-right font-mono text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </Field>
                    </div>
                    <Button
                      variant="secondary"
                      aria-label={`Allouer le solde de ${invoice.invoiceNumber}`}
                      onclick={() => {
                        amounts[invoice.id] = Number(invoice.outstanding);
                      }}>Solde</Button
                    >
                    {#if amounts[invoice.id] > 0}<Button
                        variant="ghost"
                        aria-label={`Retirer l’allocation de ${invoice.invoiceNumber}`}
                        onclick={() => {
                          amounts[invoice.id] = 0;
                        }}>Retirer</Button
                      >{/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      </div>

      <aside class="min-w-0 space-y-5">
        <Card>
          <h2 class="mb-4 text-sm font-semibold">3. Détails du règlement</h2>
          <div class="space-y-4">
            <ErrorNotice message={modeError} onretry={loadModes} />
            <Field label="Mode de paiement"
              ><Select bind:value={modeOfPaymentId} required disabled={loadingModes}>
                <option value="">{loadingModes ? 'Chargement…' : 'Sélectionner…'}</option
                >{#each modes as mode}<option value={mode.id}>{mode.name}</option>{/each}
              </Select></Field
            >
            {#if !loadingModes && !modeError && !modes.length}<p class="text-xs text-ink-muted">
                Aucun mode configuré. <a class="text-accent hover:underline" href="/billing/config"
                  >Configurer la facturation</a
                >
              </p>{/if}
            <Field label="Date"><Input type="date" bind:value={date} required /></Field>
            <Field label="Montant déclaré (facultatif)"
              ><Input
                type="number"
                min={totalAllocated}
                step="0.01"
                bind:value={totalOverride}
                placeholder={totalAllocated.toFixed(2)}
              /></Field
            >
            <p class="-mt-2 text-xs text-ink-muted">Vide : utilise la somme des allocations.</p>
            <Field label="Référence (facultatif)"
              ><Input bind:value={reference} placeholder="Virement, chèque…" /></Field
            >
            <Field label="Note interne (facultatif)"><Textarea bind:value={note} rows={3} /></Field>
          </div>
        </Card>
        <div class="rounded-lg border border-edge bg-surface-muted p-4">
          <h2 class="text-sm font-semibold">À vérifier avant validation</h2>
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex justify-between gap-2">
              <dt class="text-ink-muted">Factures sélectionnées</dt>
              <dd>{selectedCount}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-muted">À comptabiliser</dt>
              <dd class="font-mono font-medium">{formatMoney(totalAllocated, currency)}</dd>
            </div>
            {#if Math.abs(remainder) > 0.000001}<div class="flex justify-between gap-2">
                <dt class="text-ink-muted">Non alloué</dt>
                <dd class="font-mono">{formatMoney(remainder, currency)}</dd>
              </div>
              <p class="text-xs text-warn">
                Seules les allocations seront comptabilisées. Le solde non alloué ne constitue pas
                un crédit client.
              </p>{/if}
          </dl>
        </div>
      </aside>
    </fieldset>
    <div class="mt-5 border-t border-edge pt-4">
      <ErrorNotice message={error} />
      <div class="flex flex-wrap items-center justify-end gap-3">
        <span class="mr-auto text-xs text-ink-muted"
          >Aucun transfert bancaire ni envoi de courriel.</span
        >
        <Button type="submit" loading={saving} disabled={loadingInvoices || loadingModes}
          >{createdId ? 'Ouvrir le brouillon enregistré' : 'Enregistrer le brouillon'}</Button
        >
      </div>
    </div>
  </form>
{/if}
