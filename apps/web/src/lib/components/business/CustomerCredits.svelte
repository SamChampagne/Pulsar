<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import CustomerCreditDocument from './CustomerCreditDocument.svelte';
  import { Button, Field, Input, Textarea, Badge, ErrorNotice, Skeleton } from '$lib/components/ui';
  import {
    readCreditIntent,
    rememberCreditIntent,
    type CreditIntent as Intent,
  } from './credit-intent';
  type Line = {
    id: string;
    description: string;
    quantity: string;
    remainingQuantity: string;
    unit: string;
  };
  type Note = {
    id: string;
    number: string;
    status: string;
    reason: string;
    netAmount: string;
    taxAmount: string;
    totalAmount: string;
    createdAt: string;
    issuedAt: string | null;
    invoiceVersion: number;
    lines: {
      id: string;
      description: string;
      quantity: string;
      netAmount: string;
      taxAmount: string;
      totalAmount: string;
      taxDetail: { description: string; rate: number; amount: number }[];
    }[];
  };
  type Context = {
    invoiceVersion: number;
    status: string;
    currency: string;
    totalAmount: string;
    amountPaid: string;
    creditedAmount: string;
    outstanding: number;
    customerCredit: number;
    lines: Line[];
    notes: Note[];
    historyLimited: boolean;
  };
  let {
    invoiceId,
    busy = $bindable(false),
    onchanged,
  }: { invoiceId: string; busy?: boolean; onchanged: () => Promise<void> } = $props();
  const permissions = $derived(($auth?.user.permissions ?? []) as string[]);
  const canDraft = $derived(permissions.includes('billing.customer-invoices.manage'));
  const canIssue = $derived(permissions.includes('billing.credit-notes.approve'));
  const key = $derived(
    `pulsar:customer-credit:v1:${$auth?.tenant.id}:${$auth?.user.id}:${invoiceId}`,
  );
  let data = $state<Context | null>(null),
    loading = $state(true),
    error = $state(''),
    reason = $state(''),
    quantities = $state<Record<string, number>>({}),
    pending = $state<Intent | null>(null),
    confirmId = $state('');
  let generation = 0;
  let storageError = $state('');
  async function load() {
    const seq = ++generation;
    loading = true;
    try {
      const result = await api<Context>(`/billing/customer-invoices/${invoiceId}/credits`);
      if (seq === generation) {
        data = result;
        try {
          pending = readCreditIntent(key);
          storageError = '';
        } catch (e) {
          storageError = (e as Error).message;
        }
      }
    } catch (e) {
      if (seq === generation) error = (e as Error).message;
    } finally {
      if (seq === generation) loading = false;
    }
  }
  $effect(() => {
    invoiceId;
    void load();
  });
  const selected = $derived(data?.lines.filter((l) => Number(quantities[l.id]) > 0) ?? []);
  const valid = $derived(
    selected.length > 0 &&
      selected.every((l) => Number(quantities[l.id]) <= Number(l.remainingQuantity)) &&
      !!reason.trim(),
  );
  const money = (n: string | number) =>
    Number(n).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  async function draft() {
    if (busy || storageError || (!pending && !valid)) return;
    busy = true;
    error = '';
    try {
      if (!pending) {
        const intent = {
          operationKey: crypto.randomUUID(),
          expectedVersion: data!.invoiceVersion,
          reason: reason.trim(),
          lines: selected.map((l) => ({ invoiceLineId: l.id, quantity: Number(quantities[l.id]) })),
        };
        rememberCreditIntent(key, intent);
        pending = intent;
      }
      await api(`/billing/customer-invoices/${invoiceId}/credits`, {
        method: 'POST',
        body: pending,
      });
      localStorage.removeItem(key);
      pending = null;
      quantities = {};
      reason = '';
      await load();
    } catch (e) {
      error = (e as Error).message;
      if (e instanceof ApiError && e.statusCode < 500) {
        localStorage.removeItem(key);
        pending = null;
        await load();
      }
    } finally {
      busy = false;
    }
  }
  async function transition(note: Note, action: 'issue' | 'cancel') {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await api(`/billing/customer-invoices/${invoiceId}/credits/${note.id}/${action}`, {
        method: 'POST',
      });
      confirmId = '';
      await load();
      await onchanged();
    } catch (e) {
      error = `${(e as Error).message} Actualisez pour vérifier l’état. Reprendre la même action ne crée pas un second avoir.`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="mt-6 space-y-4 border-t border-edge pt-5" aria-label="Avoirs et solde client">
  <div class="flex items-center justify-between gap-3">
    <h3 class="font-semibold">Avoirs et solde client</h3>
    <Button variant="ghost" disabled={busy || loading} onclick={load}>Actualiser les avoirs</Button>
  </div>
  <ErrorNotice message={error} />
  <ErrorNotice message={storageError} />
  {#if loading}<Skeleton rows={3} />{:else if data}
    <dl class="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-3 text-sm sm:grid-cols-4">
      <div>
        <dt class="text-ink-muted">Facture initiale</dt>
        <dd class="mt-1 font-mono">{money(data.totalAmount)}</dd>
      </div>
      <div>
        <dt class="text-ink-muted">Encaissé</dt>
        <dd class="mt-1 font-mono">{money(data.amountPaid)}</dd>
      </div>
      <div>
        <dt class="text-ink-muted">Avoirs validés</dt>
        <dd class="mt-1 font-mono">{money(data.creditedAmount)}</dd>
      </div>
      <div>
        <dt class="text-ink-muted">Restant dû · {data.currency}</dt>
        <dd class="mt-1 font-mono">{money(data.outstanding)}</dd>
      </div>
    </dl>
    {#if data.customerCredit > 0}<p class="rounded-lg bg-warn-soft p-3 text-sm">
        Crédit client à traiter : {money(data.customerCredit)}
        {data.currency}. Aucun remboursement bancaire ni transfert vers une autre facture n’a été
        effectué.
      </p>{/if}
    <p class="text-sm text-ink-muted">
      La facture d’origine reste intacte. Un avoir validé réduit la créance et passe une écriture
      comptable inverse. Le retour physique des pièces se confirme séparément dans Services.
    </p>
    {#if pending}<div class="rounded-lg bg-warn-soft p-3 text-sm">
        <p>
          Une création attend confirmation. La même demande est conservée pour éviter un doublon.
        </p>
        <Button disabled={busy || !canDraft} onclick={draft}
          >Vérifier / reprendre le brouillon d’avoir</Button
        >
      </div>{/if}
    {#if canDraft && !pending && data.lines.some((l) => Number(l.remainingQuantity) > 0)}
      <details class="rounded-lg border border-edge p-3">
        <summary class="cursor-pointer text-sm font-medium">Préparer un avoir</summary>
        <form
          class="mt-4 space-y-3"
          onsubmit={(e) => {
            e.preventDefault();
            void draft();
          }}
        >
          <fieldset disabled={busy || !!storageError} class="space-y-3">
            {#each data.lines.filter((l) => Number(l.remainingQuantity) > 0) as line}<Field
                label={`${line.description} · ${line.remainingQuantity} ${line.unit} créditable(s)`}
                ><Input
                  type="number"
                  min={0}
                  max={Number(line.remainingQuantity)}
                  step={0.0001}
                  value={quantities[line.id] ?? 0}
                  oninput={(e) => (quantities[line.id] = Number(e.currentTarget.value))}
                /></Field
              >{/each}
            <Field label="Motif de l’avoir"
              ><Textarea required maxlength={1000} bind:value={reason} /></Field
            >
            <p class="text-xs text-ink-muted">
              Les montants et taxes viennent de la facture figée, avec arrondis cumulés. Le
              brouillon vous permet de vérifier le calcul avant validation. Une fraction de ligne
              signifie une part de son montant initial.
            </p>
            <Button type="submit" disabled={!valid} loading={busy}
              >Calculer le brouillon d’avoir</Button
            >
          </fieldset>
        </form>
      </details>
    {/if}
    {#if !data.notes.length}<p class="text-sm text-ink-muted">
        Aucun avoir. Créez un brouillon uniquement pour une correction réelle et motivée.
      </p>{/if}
    {#each data.notes as note (note.id)}<article
        class="space-y-3 rounded-lg border border-edge p-4"
        aria-label={`Avoir ${note.number}`}
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="font-mono text-sm font-medium">{note.number}</h4>
          <Badge tone={note.status === 'ISSUED' ? 'ok' : 'neutral'}
            >{note.status === 'ISSUED'
              ? 'Validé'
              : note.status === 'CANCELLED'
                ? 'Annulé'
                : 'Brouillon'}</Badge
          >
        </div>
        <p class="whitespace-pre-wrap break-words text-sm">{note.reason}</p>
        <p class="text-xs text-ink-muted">
          {fmtUserInstant(note.issuedAt ?? note.createdAt)} · {data.currency}
        </p>
        <ul class="space-y-2 text-sm">
          {#each note.lines as line}<li>
              <span>{line.quantity} × {line.description}</span><span
                class="block font-mono text-xs text-ink-muted"
                >{money(line.netAmount)} hors taxes · {money(line.taxAmount)} taxes</span
              >{#each line.taxDetail as tax}<span class="block text-xs text-ink-muted"
                  >{tax.description} ({tax.rate} %) : {money(tax.amount)}</span
                >{/each}
            </li>{/each}
        </ul>
        <div class="flex justify-between border-t border-edge pt-2 text-sm font-semibold">
          <span>Total de l’avoir</span><span class="font-mono"
            >{money(note.totalAmount)} {data.currency}</span
          >
        </div>
        {#if note.status === 'ISSUED'}<CustomerCreditDocument
            {invoiceId}
            noteId={note.id}
            number={note.number}
            bind:busy
          />{/if}
        {#if note.status === 'DRAFT'}
          {#if note.invoiceVersion !== data.invoiceVersion}<p class="text-sm text-warn">
              Un autre avoir a été validé. Annulez ce brouillon périmé et préparez-en un nouveau.
            </p>{/if}
          {#if confirmId === note.id}<div class="space-y-3 rounded-md bg-surface-muted p-3 text-sm">
              <p>
                Valider définitivement {money(note.totalAmount)}
                {data.currency} ? La facture sera comptabilisée si son écriture manque, puis l’avoir sera
                comptabilisé dans la même opération. Aucune sortie d’argent ni entrée de stock automatique.
              </p>
              <Button disabled={busy} onclick={() => transition(note, 'issue')}
                >Confirmer la validation de l’avoir</Button
              ><Button
                variant="ghost"
                disabled={busy}
                onclick={() => {
                  confirmId = '';
                }}>Retour</Button
              >
            </div>
          {:else}<div class="flex flex-wrap gap-2">
              {#if canIssue}<Button
                  disabled={busy || note.invoiceVersion !== data.invoiceVersion}
                  onclick={() => {
                    confirmId = note.id;
                  }}>Valider l’avoir</Button
                >{/if}{#if canDraft}<Button
                  variant="ghost"
                  disabled={busy}
                  onclick={() => transition(note, 'cancel')}>Annuler ce brouillon d’avoir</Button
                >{/if}
            </div>{/if}
        {/if}
      </article>{/each}
    {#if data.historyLimited}<p class="text-xs text-ink-muted">
        Les 100 derniers avoirs sont affichés; les soldes incluent tout l’historique.
      </p>{/if}
  {/if}
</section>
