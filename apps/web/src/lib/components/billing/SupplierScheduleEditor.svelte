<script lang="ts">
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Input, Textarea, Skeleton } from '$lib/components/ui';
  import { formatDate, formatDateTime } from '$lib/format';
  import {
    formatSupplierDossierMoney as money,
    SupplierScheduleStatus as Status,
    supplierCreditCents,
    validateSupplierSchedule,
    type SupplierScheduleInput,
    type Paginated,
  } from '@pulsar/shared';
  import {
    readSupplierScheduleIntent,
    rememberSupplierScheduleIntent,
    type SupplierScheduleIntent,
  } from '$lib/billing/supplier-schedule-intent';
  let {
    invoiceId,
    active = $bindable(false),
    onchanged,
  }: { invoiceId: string; active?: boolean; onchanged?: () => void } = $props();
  type Revision = {
    id: string;
    revision: number;
    status: string;
    amountSnapshot: string;
    currencySnapshot: string;
    installments: SupplierScheduleInput['installments'];
    creditsSnapshot: { id: string; number: string; totalAmount: string }[];
    note: string;
    createdAt: string;
    actor: { firstName: string; lastName: string };
  };
  type Context = {
    invoice: {
      id: string;
      number: string;
      supplierId: string;
      supplierSnapshot: { name: string };
      externalNumber: string;
      currency: string;
      invoiceDate: string;
      dueDate: string | null;
      totalAmount: string;
    };
    remaining: string;
    credited: string;
    latest: Revision | null;
  };
  type Review = {
    input: SupplierScheduleInput;
    reviewToken: string;
    expectedRevisionId: string | null;
    remaining: string;
    currency: string;
    revision: number;
  };
  const base = $derived(`/billing/supplier-schedules/invoice/${invoiceId}`);
  const key = $derived(
    `pulsar:supplier-schedule:${$auth?.tenant.id}:${$auth?.user.id}:${invoiceId}`,
  );
  const canManage = $derived(
    !!$auth?.user.permissions.includes('billing.supplier-schedules.manage'),
  );
  let context = $state<Context | null>(null),
    loading = $state(true),
    busy = $state(false),
    error = $state(''),
    notice = $state(''),
    storageError = $state('');
  let form = $state<SupplierScheduleInput>({
      status: Status.CONFIRMED,
      note: '',
      installments: [],
    }),
    review = $state<Review | null>(null),
    confirmed = $state(false),
    pending = $state<SupplierScheduleIntent | null>(null);
  let history = $state<Revision[]>([]),
    historyPage = $state(1),
    historyTotal = $state(0),
    historyLoading = $state(false),
    historyError = $state('');
  let generation = 0,
    historyGeneration = 0;
  const stale = $derived(
    context?.latest?.status === 'CONFIRMED' &&
      supplierCreditCents(context.latest.amountSnapshot) !== supplierCreditCents(context.remaining),
  );
  const locked = $derived(loading || busy || !!pending || !!storageError || !context);
  $effect(() => {
    active = busy;
  });
  $effect(() => {
    void key;
    untrack(() => {
      try {
        pending = readSupplierScheduleIntent(key, invoiceId);
        storageError = '';
      } catch (e) {
        storageError = (e as Error).message;
      }
      void load();
      void loadHistory();
    });
    return () => {
      generation++;
      historyGeneration++;
    };
  });
  $effect(() => {
    JSON.stringify(form);
    review = null;
    confirmed = false;
  });
  async function load() {
    const g = ++generation;
    loading = true;
    context = null;
    error = '';
    review = null;
    confirmed = false;
    try {
      const r = await api<Context>(base);
      if (g !== generation) return;
      context = r;
      form = {
        status: Status.CONFIRMED,
        note: '',
        installments:
          r.latest?.status === 'CONFIRMED' ? r.latest.installments.map((x) => ({ ...x })) : [],
      };
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  async function loadHistory() {
    const g = ++historyGeneration;
    historyLoading = true;
    historyError = '';
    history = [];
    try {
      const r = await api<Paginated<Revision>>(`${base}/history`, {
        query: { page: historyPage, pageSize: 5 },
      });
      if (g === historyGeneration) {
        history = r.items;
        historyTotal = r.total;
      }
    } catch (e) {
      if (g === historyGeneration) historyError = (e as Error).message;
    } finally {
      if (g === historyGeneration) historyLoading = false;
    }
  }
  async function assess() {
    if (locked || !context || !canManage) return;
    busy = true;
    error = '';
    notice = '';
    review = null;
    try {
      validateSupplierSchedule(form, context.remaining, context.invoice.invoiceDate.slice(0, 10));
      review = await api<Review>(`${base}/review`, { method: 'POST', body: form });
      confirmed = false;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function execute(p: SupplierScheduleIntent) {
    if (busy || !canManage) return;
    busy = true;
    error = '';
    notice = '';
    try {
      rememberSupplierScheduleIntent(key, invoiceId, p);
      pending = p;
      await api(p.path, { method: 'POST', body: p.body });
      localStorage.removeItem(key);
      pending = null;
      await load();
      historyPage = 1;
      await loadHistory();
      notice = 'Révision conservée. Aucun paiement ni écriture comptable.';
      onchanged?.();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (!review || !confirmed || locked) return;
    await execute({
      path: `${base}/confirm`,
      body: {
        ...review.input,
        operationKey: crypto.randomUUID(),
        reviewToken: review.reviewToken,
        expectedRevisionId: review.expectedRevisionId,
        confirmed: true,
      },
    });
  }
  async function verify() {
    if (!pending || busy || !canManage) return;
    busy = true;
    error = '';
    try {
      const r = await api<{ invoiceId: string; revision: number }>(
        `/billing/supplier-schedules/requests/${pending.body.operationKey}`,
      );
      if (r.invoiceId !== invoiceId)
        throw Error('Réponse étrangère à cette facture. Faites vérifier le registre.');
      localStorage.removeItem(key);
      pending = null;
      await load();
      await loadHistory();
      notice = `Révision ${r.revision} déjà conservée, aucune copie ajoutée.`;
      onchanged?.();
    } catch (e) {
      error =
        e instanceof ApiError && e.statusCode === 404
          ? 'Aucune révision confirmée pour cette clé. Reprenez exactement la même demande, ou vérifiez son absence avant de refaire la revue.'
          : (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function abandonAfterCheck() {
    if (!pending || busy || !canManage) return;
    busy = true;
    error = '';
    try {
      await api(`/billing/supplier-schedules/requests/${pending.body.operationKey}`);
      throw Error('Une révision existe : utilisez Vérifier la demande.');
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        localStorage.removeItem(key);
        pending = null;
        await load();
        notice =
          'Aucune révision trouvée à cet instant. Refaites une revue à jour avant toute nouvelle confirmation.';
      } else error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-5">
  <p class="text-sm text-ink-muted">
    Prévision opérationnelle seulement : aucune dette comptabilisée, aucun règlement et aucune
    transmission bancaire. Les dates convenues sont saisies explicitement.
  </p>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if notice}<p role="status" class="text-sm text-ok">{notice}</p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if pending}<section class="space-y-3 rounded-card border border-warn/40 p-4">
      <h3 class="font-medium">Confirmation à vérifier</h3>
      <p class="text-sm">
        La demande exacte est conservée. Ne créez pas un autre échéancier pour compenser une réponse
        perdue.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || !canManage} onclick={verify}
          >Vérifier la demande</Button
        ><Button
          variant="secondary"
          disabled={busy || !canManage}
          onclick={() => {
            if (pending) void execute(pending);
          }}>Reprendre la même confirmation</Button
        ><Button variant="ghost" disabled={busy || !canManage} onclick={abandonAfterCheck}
          >Vérifier l’absence puis refaire la revue</Button
        >
      </div>
    </section>{/if}
  {#if loading}<Skeleton rows={5} />{:else if !context}<Button variant="secondary" onclick={load}
      >Recharger la facture</Button
    >{:else}
    <section class="space-y-3 rounded-card border border-edge p-4">
      <h3 class="font-semibold">
        {context.invoice.number} · {context.invoice.supplierSnapshot.name}
      </h3>
      <p class="break-all text-sm text-ink-muted">Réf. {context.invoice.externalNumber}</p>
      <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-ink-muted">Facture qualifiée</dt>
          <dd class="font-mono">{money(context.invoice.totalAmount, context.invoice.currency)}</dd>
        </div>
        <div>
          <dt class="text-ink-muted">Avoirs qualifiés</dt>
          <dd class="font-mono">{money(context.credited, context.invoice.currency)}</dd>
        </div>
        <div>
          <dt class="text-ink-muted">À répartir, hors règlements</dt>
          <dd class="font-mono">{money(context.remaining, context.invoice.currency)}</dd>
        </div>
      </dl>
      <p class="text-xs text-ink-muted">
        Échéance portée sur l’original : {formatDate(context.invoice.dueDate?.slice(0, 10))}. Le
        planning ci-dessous ne modifie pas cette facture.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          href={`/billing/supplier-invoices?invoiceId=${invoiceId}`}
          disabled={busy}>Ouvrir la facture source</Button
        ><Button
          variant="ghost"
          href={`/billing/suppliers/${context.invoice.supplierId}`}
          disabled={busy}>Dossier fournisseur</Button
        >
      </div>
    </section>
    {#if stale}<p role="status" class="rounded-md border border-warn/40 p-3 text-sm">
        À revoir : de nouveaux avoirs ont changé le reste documentaire. L’ancien échéancier est
        conservé, mais exclu de la prévision confirmée.
      </p>{/if}
    {#if !canManage}<p class="text-sm text-ink-muted">
        Lecture seule. Le droit de gestion des échéanciers est nécessaire pour confirmer ou réviser.
      </p>{:else}
      <form
        class="space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          void assess();
        }}
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-medium">Préparer une révision</h3>
          <Button
            variant="secondary"
            disabled={locked || !context.latest || context.latest.status === 'WITHDRAWN'}
            onclick={() => {
              form = { status: Status.WITHDRAWN, note: '', installments: [] };
            }}>Retirer le planning</Button
          >
        </div>
        {#if form.status === 'WITHDRAWN'}<p class="text-sm">
            Le retrait conserve l’historique et ne supprime ni la facture ni son reste. Aucun
            paiement n’est annulé.
          </p>
          <Button
            variant="secondary"
            disabled={locked}
            onclick={() => {
              form = { status: Status.CONFIRMED, note: '', installments: [] };
            }}>Préparer des échéances</Button
          >{:else}
          {#if context.remaining === '0.00'}<p class="text-sm">
              Les avoirs qualifiés couvrent toute la facture. Confirmez une révision sans échéance;
              cela ne signifie pas « payé ».
            </p>{/if}
          {#each form.installments as row, i (i)}<fieldset
              disabled={locked}
              class="space-y-3 rounded-card border border-edge p-3"
            >
              <legend class="px-1 text-sm font-medium">Échéance {i + 1}</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <Field label={`Date civile échéance ${i + 1}`}
                  ><Input
                    type="date"
                    min={context.invoice.invoiceDate.slice(0, 10)}
                    max="2199-12-31"
                    bind:value={row.dueDate}
                  /></Field
                ><Field label={`Montant échéance ${i + 1} (${context.invoice.currency})`}
                  ><Input inputmode="decimal" bind:value={row.amount} placeholder="0.00" /></Field
                >
              </div>
              <Field label={`Description échéance ${i + 1}`}
                ><Input maxlength={200} bind:value={row.note} /></Field
              ><Button
                variant="ghost"
                onclick={() => {
                  form.installments = form.installments.filter((_, n) => n !== i);
                }}>Retirer l’échéance {i + 1}</Button
              >
            </fieldset>{/each}
          <div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={locked || form.installments.length >= 60 || context.remaining === '0.00'}
              onclick={() => {
                form.installments = [...form.installments, { dueDate: '', amount: '', note: '' }];
              }}>Ajouter une échéance</Button
            ><Button
              variant="ghost"
              disabled={locked || context.remaining === '0.00'}
              onclick={() => {
                if (context)
                  form.installments = [
                    {
                      dueDate: context.invoice.dueDate?.slice(0, 10) ?? '',
                      amount: context.remaining,
                      note: '',
                    },
                  ];
              }}>Reprendre l’échéance de la facture</Button
            >
          </div>
          <p class="text-xs text-ink-muted">
            Jusqu’à 60 dates distinctes, en ordre croissant. Le total doit correspondre exactement
            au reste documentaire. Aucun pourcentage ou arrondi automatique.
          </p>
        {/if}
        <Field label="Motif de la révision"
          ><Textarea bind:value={form.note} maxlength={2000} disabled={locked} /></Field
        >
        <Button type="submit" disabled={locked}>Examiner les effets</Button>
      </form>
      {#if review}<section
          aria-label="Revue de l’échéancier"
          class="space-y-3 rounded-card border border-accent/30 bg-surface p-4"
        >
          <h3 class="font-medium">
            Révision {review.revision} · {review.input.status === 'CONFIRMED'
              ? 'Confirmation du planning'
              : 'Retrait du planning'}
          </h3>
          <p class="text-sm">
            {review.input.installments.length} échéance(s) · reste documentaire {money(
              review.remaining,
              review.currency,
            )}. Les anciennes révisions seront conservées.
          </p>
          <label class="flex items-start gap-2 text-sm"
            ><input type="checkbox" bind:checked={confirmed} disabled={locked} />J’ai vérifié les
            dates et montants convenus. Cette confirmation ne comptabilise et ne paie rien.</label
          ><Button disabled={locked || !confirmed} onclick={save}>Confirmer la révision</Button>
        </section>{/if}
    {/if}
    <section aria-label="Historique de l’échéancier" class="space-y-3 border-t border-edge pt-4">
      <h3 class="font-medium">Révisions conservées</h3>
      {#if historyError}<p role="alert" class="text-danger">{historyError}</p>
        <Button variant="secondary" onclick={loadHistory}>Recharger l’historique</Button
        >{/if}{#if historyLoading}<Skeleton
          rows={3}
        />{:else if !historyError}{#if !history.length}<p class="text-sm text-ink-muted">
            Aucune révision confirmée. La facture n’alimente pas encore la prévision d’échéances.
          </p>{/if}{#each history as r (r.id)}<article
            class="space-y-2 rounded-md border border-edge p-3"
          >
            <h4 class="text-sm font-medium">
              Révision {r.revision} · {r.status === 'CONFIRMED' ? 'Confirmée' : 'Retirée'}
            </h4>
            <p class="text-xs text-ink-muted">
              {formatDateTime(r.createdAt)} · {r.actor.firstName}
              {r.actor.lastName}
            </p>
            <p class="text-sm">{r.note}</p>
            <p class="text-xs">
              Reste capturé : {money(r.amountSnapshot, r.currencySnapshot)} · {r.creditsSnapshot
                .length} avoir(s) qualifié(s)
            </p>
            {#each r.installments as line}<p class="text-sm">
                {formatDate(line.dueDate)} ·
                <span class="font-mono">{money(line.amount, r.currencySnapshot)}</span>
                {line.note}
              </p>{/each}
          </article>{/each}
        <div class="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={historyPage === 1}
            onclick={() => {
              historyPage--;
              void loadHistory();
            }}>Révisions précédentes</Button
          ><span class="self-center text-xs text-ink-muted"
            >Page {historyPage} · {historyTotal} révision(s)</span
          ><Button
            variant="secondary"
            disabled={historyPage * 5 >= historyTotal}
            onclick={() => {
              historyPage++;
              void loadHistory();
            }}>Révisions suivantes</Button
          >
        </div>{/if}
    </section>
  {/if}
</div>
