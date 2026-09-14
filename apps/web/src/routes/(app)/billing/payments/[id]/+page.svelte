<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDate, formatMoney } from '$lib/format';
  import {
    type Payment,
    invoiceHref,
    paymentStatusLabel,
    paymentStatusTone,
    paymentTypeLabel,
  } from '$lib/billing/payments';
  import {
    RecordHeader,
    RecordNav,
    RecordSection,
    Button,
    Card,
    Badge,
    Skeleton,
    ErrorNotice,
    EmptyState,
    Table,
    Drawer,
    Field,
    Input,
    Textarea,
  } from '$lib/components/ui';

  let payment = $state<Payment | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');
  let actionError = $state('');
  let busy = $state(false);
  let editOpen = $state(false);
  let editError = $state('');
  let editTotal = $state(0);
  let editDate = $state('');
  let editReference = $state('');
  let editNote = $state('');
  let editAmounts = $state<Record<string, number>>({});
  let originalDraft = '';
  let generation = 0;
  const paymentId = $derived(page.params.id!);
  const canManage = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.PAYMENTS_MANAGE),
  );
  const allocated = $derived(
    payment?.allocations.reduce((sum, a) => sum + Number(a.amount), 0) ?? 0,
  );
  const draftSnapshot = () =>
    JSON.stringify([editTotal, editDate, editReference, editNote, editAmounts]);

  async function load(id = paymentId) {
    const request = ++generation;
    loading = true;
    error = '';
    notFound = false;
    try {
      const result = await api<Payment>(`/billing/payments/${encodeURIComponent(id)}`);
      if (request === generation) payment = result;
    } catch (e) {
      if (request !== generation) return;
      if (e instanceof ApiError && e.statusCode === 404) notFound = true;
      else error = e instanceof ApiError ? e.message : 'Impossible de charger le paiement.';
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    const id = paymentId;
    payment = null;
    actionError = '';
    editOpen = false;
    void load(id);
  });
  onDestroy(() => {
    generation++;
  });

  async function transition(action: 'submit' | 'cancel') {
    if (!payment || busy || !canManage) return;
    const record = payment;
    busy = true;
    actionError = '';
    try {
      const accepted = await confirmAction(
        action === 'submit'
          ? `Comptabiliser ${formatMoney(allocated, record.currency)} sur les factures liées ? Les soldes et le grand livre seront mis à jour. Aucun transfert bancaire ne sera effectué.`
          : record.status === 'SUBMITTED'
            ? 'Annuler ce paiement créera une contre-écriture et rétablira les soldes des factures liées. Aucun remboursement bancaire ne sera effectué.'
            : 'Annuler ce brouillon ? Aucune écriture comptable ne sera créée.',
        {
          title: action === 'submit' ? 'Comptabiliser le paiement ?' : 'Annuler le paiement ?',
          confirmLabel: action === 'submit' ? 'Comptabiliser' : 'Annuler le paiement',
          dangerous: action === 'cancel',
        },
      );
      if (!accepted || paymentId !== record.id) return;
      const result = await api<Payment>(`/billing/payments/${record.id}/${action}`, {
        method: 'POST',
      });
      if (paymentId !== record.id) return;
      payment = result;
      toast.success(action === 'submit' ? 'Paiement comptabilisé.' : 'Paiement annulé.');
    } catch (e) {
      if (paymentId === record.id)
        actionError =
          e instanceof ApiError
            ? e.message
            : 'Action non confirmée. Actualisez le dossier avant de réessayer.';
    } finally {
      busy = false;
    }
  }

  function startEdit() {
    if (!payment) return;
    editTotal = Number(payment.totalAmount);
    editDate = payment.date.slice(0, 10);
    editReference = payment.reference ?? '';
    editNote = payment.note ?? '';
    editAmounts = Object.fromEntries(payment.allocations.map((a) => [a.id, Number(a.amount)]));
    originalDraft = draftSnapshot();
    editError = '';
    editOpen = true;
  }
  function closeEdit() {
    if (draftSnapshot() === originalDraft) return true;
    void confirmAction('Les modifications du brouillon ne sont pas enregistrées.', {
      title: 'Abandonner les modifications ?',
      confirmLabel: 'Abandonner',
    }).then((accepted) => {
      if (accepted) editOpen = false;
    });
    return false;
  }
  async function saveEdit() {
    if (!payment || busy || !canManage) return;
    editError = '';
    const record = payment;
    const selected = record.allocations.filter((a) => Number(editAmounts[a.id]) > 0);
    const sum = selected.reduce((s, a) => s + Number(editAmounts[a.id]), 0);
    if (
      !selected.length ||
      !Number.isFinite(editTotal) ||
      editTotal < sum ||
      !editDate ||
      Object.values(editAmounts).some((v) => !Number.isFinite(v) || v < 0)
    ) {
      editError = 'Gardez au moins une allocation positive, sans dépasser le montant déclaré.';
      return;
    }
    busy = true;
    try {
      await api(`/billing/payments/${record.id}`, {
        method: 'PATCH',
        body: {
          totalAmount: editTotal,
          date: new Date(`${editDate}T12:00:00`).toISOString(),
          reference: editReference.trim(),
          note: editNote.trim(),
          allocations: selected.map((a) => ({
            targetType: a.targetType,
            targetId: a.targetId,
            amount: Number(editAmounts[a.id]),
          })),
        },
      });
      editOpen = false;
      toast.success('Brouillon mis à jour.');
      if (paymentId === record.id) await load(record.id);
    } catch (e) {
      editError =
        e instanceof ApiError
          ? e.message
          : 'Impossible d’enregistrer. Vos modifications sont conservées.';
    } finally {
      busy = false;
    }
  }
</script>

{#if loading}
  <RecordHeader
    title="Chargement du paiement…"
    kind="Facturation"
    backHref="/billing/payments"
    backLabel="Paiements"
  /><Card><Skeleton rows={5} /></Card>
{:else if notFound}
  <RecordHeader
    title="Paiement introuvable"
    kind="Facturation"
    backHref="/billing/payments"
    backLabel="Paiements"
  /><EmptyState
    title="Ce dossier n’est pas accessible"
    message="Il n’existe pas ou vous n’avez pas accès à ce paiement."
  />
{:else if error}
  <RecordHeader
    title="Paiement indisponible"
    kind="Facturation"
    backHref="/billing/payments"
    backLabel="Paiements"
  /><ErrorNotice message={error} onretry={() => load()} />
{:else if payment}
  {@const record = payment}
  <RecordHeader
    title={record.paymentNumber}
    kind={paymentTypeLabel[record.type]}
    backHref="/billing/payments"
    backLabel="Paiements"
  >
    {#snippet meta()}<Badge tone={paymentStatusTone[record.status]}
        >{paymentStatusLabel[record.status]}</Badge
      ><span>{record.party?.name ?? 'Partie indisponible'}</span><span aria-hidden="true">·</span
      ><span>{formatDate(record.date)}</span>{/snippet}
    {#snippet actions()}
      {#if canManage && record.status === 'DRAFT'}<Button
          variant="secondary"
          disabled={busy}
          onclick={startEdit}>Modifier le brouillon</Button
        ><Button loading={busy} onclick={() => transition('submit')}>Comptabiliser</Button>{/if}
    {/snippet}
  </RecordHeader>
  <ErrorNotice message={actionError} />
  <RecordNav
    sections={[
      { id: 'payment-summary', label: 'Vue d’ensemble' },
      { id: 'payment-invoices', label: 'Factures liées' },
      { id: 'payment-accounting', label: 'Comptabilité' },
    ]}
  />
  <div class="max-w-6xl space-y-5">
    <RecordSection id="payment-summary" label="Vue d’ensemble">
      <Card>
        <div class="grid gap-5 sm:grid-cols-3">
          <div>
            <p class="text-xs text-ink-muted">Montant déclaré</p>
            <p class="mt-1 font-mono text-xl font-semibold">
              {formatMoney(record.totalAmount, record.currency)}
            </p>
          </div>
          <div>
            <p class="text-xs text-ink-muted">Alloué aux factures</p>
            <p class="mt-1 font-mono text-xl font-semibold">
              {formatMoney(allocated, record.currency)}
            </p>
          </div>
          <div>
            <p class="text-xs text-ink-muted">Mode de paiement</p>
            <p class="mt-1 text-sm font-medium">{record.modeOfPayment?.name ?? 'Indisponible'}</p>
            {#if record.reference}<p class="mt-1 break-words text-xs text-ink-muted">
                Réf. {record.reference}
              </p>{/if}
          </div>
        </div>
        {#if Number(record.totalAmount) - allocated > 0.000001}<p
            class="mt-4 border-t border-edge pt-3 text-xs text-warn"
          >
            {formatMoney(Number(record.totalAmount) - allocated, record.currency)} non alloué : ce montant
            n’est pas comptabilisé et ne constitue pas un crédit client.
          </p>{/if}
        {#if record.note}<div class="mt-4 border-t border-edge pt-3">
            <h2 class="mb-1 text-xs font-medium text-ink-muted">Note interne</h2>
            <p class="whitespace-pre-wrap break-words text-sm">{record.note}</p>
          </div>{/if}
      </Card>
    </RecordSection>

    <RecordSection id="payment-invoices" label="Factures liées">
      <div class="mb-3">
        <h2 class="text-sm font-semibold">Factures liées</h2>
        <p class="mt-1 text-xs text-ink-muted">
          Ouvrez le document source pour consulter ses lignes, taxes et ordres associés.
        </p>
      </div>
      <Table>
        {#snippet head()}<th>Document</th><th>Type</th><th class="text-right">Allocation</th
          >{/snippet}
        {#snippet body()}
          {#each record.allocations as allocation (allocation.id)}
            <tr
              ><td
                >{#if allocation.target}<a
                    class="font-mono font-medium text-accent hover:underline"
                    href={invoiceHref(allocation.targetType, allocation.targetId)}
                    >{allocation.target.invoiceNumber}</a
                  >{:else}<span class="text-ink-muted">Document indisponible</span>{/if}</td
              ><td
                >{allocation.targetType === 'CUSTOMER_INVOICE'
                  ? 'Relevé client'
                  : 'Facture transporteur'}</td
              ><td class="whitespace-nowrap text-right font-mono"
                >{formatMoney(allocation.amount, record.currency)}</td
              ></tr
            >
          {:else}<tr><td colspan="3">Aucune allocation.</td></tr>{/each}
        {/snippet}
      </Table>
    </RecordSection>

    <RecordSection id="payment-accounting" label="Comptabilité">
      <Card>
        <h2 class="text-sm font-semibold">Effet comptable</h2>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {#if record.status === 'DRAFT'}Ce brouillon ne modifie aucun solde. La validation
            comptabilise les allocations et met à jour les factures liées, après vérification par le
            serveur.
          {:else if record.status === 'SUBMITTED'}Les allocations ont été comptabilisées au grand
            livre et appliquées aux factures liées. Il ne s’agit pas d’un paiement bancaire en
            attente.
          {:else}Ce paiement est annulé. S’il avait été comptabilisé, sa contre-écriture a rétabli
            les soldes des factures liées.{/if}
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" href="/billing/ledger">Grand livre</Button>
          <Button variant="secondary" href="/invoices">Factures et relevés</Button>
          {#if canManage && record.status !== 'CANCELLED'}<Button
              variant="ghost"
              disabled={busy}
              onclick={() => transition('cancel')}>Annuler le paiement</Button
            >{/if}
        </div>
        <p class="mt-3 text-xs text-ink-muted">
          Ces actions n’effectuent aucun transfert ni remboursement bancaire.
        </p>
      </Card>
    </RecordSection>
  </div>
{/if}

<Drawer
  bind:open={editOpen}
  title="Modifier le brouillon"
  width="lg"
  dismissible={!busy}
  onbeforeclose={closeEdit}
>
  <form
    id="edit-payment"
    onsubmit={(e) => {
      e.preventDefault();
      void saveEdit();
    }}
  >
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <ErrorNotice message={editError} />
      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Date"><Input type="date" bind:value={editDate} required /></Field><Field
          label="Montant déclaré"
          ><Input type="number" min="0.01" step="0.01" bind:value={editTotal} required /></Field
        >
      </div>
      <Field label="Référence"><Input bind:value={editReference} /></Field>
      <Field label="Note interne"><Textarea bind:value={editNote} /></Field>
      <h3 class="border-t border-edge pt-4 text-sm font-semibold">Allocations</h3>
      <p class="text-xs text-ink-muted">
        Une allocation à zéro sera retirée. Le solde disponible sera revérifié lors de la
        comptabilisation.
      </p>
      {#each payment?.allocations ?? [] as allocation (allocation.id)}
        <Field label={`Allocation · ${allocation.target?.invoiceNumber ?? 'Document indisponible'}`}
          ><Input
            type="number"
            min="0"
            step="0.01"
            bind:value={editAmounts[allocation.id]}
          /></Field
        >
      {/each}
    </fieldset>
  </form>
  {#snippet footer()}<Button loading={busy} onclick={saveEdit}>Enregistrer les modifications</Button
    >{/snippet}
</Drawer>
