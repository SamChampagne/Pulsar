<script lang="ts">
  import { untrack } from 'svelte';
  import { page as route } from '$app/stores';
  import { auth } from '$lib/stores/auth';
  import { userTimeZone } from '$lib/stores/time-zone.svelte';
  import { api } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Drawer,
    Field,
    Input,
    Select,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import SupplierScheduleEditor from '$lib/components/billing/SupplierScheduleEditor.svelte';
  import {
    CURRENCIES,
    formatSupplierDossierMoney as money,
    type Paginated,
    type SupplierScheduleInput,
  } from '@pulsar/shared';
  import { formatDate } from '$lib/format';
  type Row = {
    invoiceId: string;
    number: string;
    externalNumber: string;
    supplierId: string;
    supplierName: string;
    currency: string;
    invoiceDate: string;
    dueDate: string | null;
    totalAmount: string;
    credited: string;
    remaining: string | null;
    scheduleId: string | null;
    revision: number | null;
    state: string;
    amountSnapshot: string | null;
    installments: SupplierScheduleInput['installments'];
  };
  type Summary = {
    groups: { currency: string; state: string; count: number; amount: string | null }[];
    buckets: { currency: string; bucket: string; amount: string }[];
  };
  const states: Record<string, string> = {
    UNPLANNED: 'À planifier',
    CONFIRMED: 'Confirmé à jour',
    REVIEW: 'À revoir',
    WITHDRAWN: 'Retiré',
    ZERO: 'Couvert par les avoirs',
    INCONSISTENT: 'Incohérent',
  };
  const bucketLabels: Record<string, string> = {
    OVERDUE: 'Dates dépassées',
    TODAY: 'À la date choisie',
    WITHIN_7: 'Dans 1 à 7 jours',
    WITHIN_30: 'Dans 8 à 30 jours',
    LATER: 'Au-delà de 30 jours',
  };
  const canRead = $derived(!!$auth?.user.permissions.includes('billing.supplier-invoices.read'));
  const canManage = $derived(
    !!$auth?.user.permissions.includes('billing.supplier-schedules.manage'),
  );
  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimeZone.value,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    return ['year', 'month', 'day'].map((t) => parts.find((p) => p.type === t)?.value).join('-');
  }
  const initialDate = today();
  let referenceDate = $state(initialDate),
    search = $state(''),
    stateFilter = $state(''),
    currency = $state(''),
    page = $state(1),
    rows = $state<Row[]>([]),
    total = $state(0),
    summary = $state<Summary | null>(null),
    loading = $state(true),
    error = $state('');
  let applied = $state({ referenceDate: initialDate, search: '', state: '', currency: '' });
  const supplierId = $derived($route.url.searchParams.get('supplierId') ?? '');
  let invoiceId = $state(''),
    open = $state(false),
    editorBusy = $state(false),
    opened = '';
  let generation = 0;
  $effect(() => {
    void $auth?.tenant.id;
    void supplierId;
    if (canRead)
      untrack(() => {
        page = 1;
        void load();
      });
    else {
      rows = [];
      summary = null;
      loading = false;
    }
    return () => {
      generation++;
    };
  });
  $effect(() => {
    const id = $route.url.searchParams.get('invoiceId') ?? '',
      key = `${$auth?.tenant.id}:${id}`;
    if (canRead && id && opened !== key) {
      opened = key;
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) untrack(() => inspect(id));
      else error = 'Lien de facture invalide.';
    }
  });
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    rows = [];
    summary = null;
    total = 0;
    try {
      const r = await api<Paginated<Row> & { summary: Summary }>('/billing/supplier-schedules', {
        query: { ...applied, supplierId, page, pageSize: 20 },
      });
      if (g === generation) {
        rows = r.items;
        total = r.total;
        summary = r.summary;
      }
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  function inspect(id: string) {
    invoiceId = id;
    open = true;
  }
  function apply() {
    applied = { referenceDate, search, state: stateFilter, currency };
    page = 1;
    void load();
  }
</script>

<div data-tour="supplier-schedule-register">
  <div data-tour="supplier-schedule-register">
    <PageHeader
      title="Échéancier fournisseur"
      eyebrow="Finance · Prévision opérationnelle"
      subtitle="Répartir les documents qualifiés sur des dates convenues, avant comptabilisation et paiements."
    >
      {#snippet actions()}<Button variant="secondary" href="/billing/suppliers"
          >Dossiers fournisseur</Button
        ><Button variant="secondary" disabled={loading || !canRead} onclick={load}
          >Actualiser</Button
        >{/snippet}
    </PageHeader>
    {#if !canRead}<p role="alert">La lecture des factures fournisseur est nécessaire.</p>{:else}
      <p class="mb-4 text-sm text-ink-muted">
        Aucun règlement n’est enregistré ou déduit ici. Une date dépassée n’est pas une preuve
        d’impayé. Les avoirs récents peuvent exiger une nouvelle revue; jamais de recalcul
        silencieux de vos dates.
      </p>
      {#if supplierId}<p class="mb-3 text-sm">
          Vue limitée au fournisseur sélectionné. <a
            href="/billing/supplier-schedules"
            class="text-accent underline">Afficher tous les fournisseurs</a
          >
        </p>{/if}
      <form
        class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        onsubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Field label="Date de référence"
          ><Input type="date" min="1900-01-01" max="2199-12-31" bind:value={referenceDate} /></Field
        >
        <Field label="Rechercher une facture"
          ><Input bind:value={search} maxlength={200} placeholder="Numéro ou fournisseur" /></Field
        >
        <Field label="État de l’échéancier"
          ><Select bind:value={stateFilter}
            ><option value="">Tous les états</option
            >{#each Object.entries(states) as [key, label]}<option value={key}>{label}</option
              >{/each}</Select
          ></Field
        >
        <Field label="Devise"
          ><Select bind:value={currency}
            ><option value="">Toutes les devises</option>{#each CURRENCIES as c}<option
                value={c.code}>{c.code}</option
              >{/each}</Select
          ></Field
        >
        <div class="flex items-end">
          <Button type="submit" disabled={loading}>Appliquer</Button>
        </div>
      </form>
      {#if error}<p role="alert" class="mb-4 text-danger">
          {error}
          <Button variant="secondary" onclick={load}>Réessayer</Button>
        </p>{/if}
      {#if loading}<Skeleton rows={6} />{:else if !error}
        {#if summary}<section aria-label="Prévision des échéances" class="mb-5 space-y-3">
            <h2 class="font-medium">Prévision confirmée à jour</h2>
            <p class="text-xs text-ink-muted">
              Résultats filtrés, toutes pages. Date de référence : {formatDate(
                applied.referenceDate,
              )}. Classement du planning courant, pas une balance historique à cette date. Aucun
              change entre devises.
            </p>
            {#if summary.buckets.length}<div class="grid gap-3 md:grid-cols-2">
                {#each [...new Set(summary.buckets.map((b) => b.currency))] as code}<section
                    aria-label={`Prévision ${code}`}
                    class="rounded-card border border-edge bg-surface p-4"
                  >
                    <h3 class="mb-3 font-semibold">{code}</h3>
                    <dl class="space-y-2 text-sm">
                      {#each Object.entries(bucketLabels) as [key, label]}{@const b =
                          summary.buckets.find(
                            (x) => x.currency === code && x.bucket === key,
                          )}{#if b}<div class="flex flex-wrap justify-between gap-2">
                            <dt class="text-ink-muted">{label}</dt>
                            <dd class="font-mono">{money(b.amount, code)}</dd>
                          </div>{/if}{/each}
                    </dl>
                  </section>{/each}
              </div>{:else}<p class="rounded-card border border-edge p-4 text-sm text-ink-muted">
                Aucune échéance confirmée à jour pour ces filtres.
              </p>{/if}
            {#each summary.groups.filter((g) => g.state !== 'CONFIRMED' && g.state !== 'ZERO') as g (`${g.currency}:${g.state}`)}<p
                class="text-sm text-ink-muted"
              >
                {states[g.state]} : {g.count} facture(s) · {g.amount === null
                  ? 'montant à vérifier'
                  : money(g.amount, g.currency)} hors prévision confirmée.
              </p>{/each}
          </section>{/if}
        {#if !rows.length}<section class="rounded-card border border-edge p-6">
            <h2 class="font-medium">Aucune facture qualifiée pour ces filtres</h2>
            <p class="mt-2 text-sm text-ink-muted">
              Qualifiez d’abord le document reçu, puis planifiez explicitement ses échéances. Les
              brouillons n’entrent pas dans ce poste.
            </p>
            <Button variant="ghost" href="/billing/supplier-invoices">Registre des factures</Button>
          </section>{:else}
          <div class="hidden sm:block">
            <Table
              >{#snippet head()}<th>Facture / fournisseur</th><th>État</th><th
                  >Reste documentaire</th
                ><th>Révision</th><th><span class="sr-only">Ouvrir l’échéancier</span></th
                >{/snippet}{#snippet body()}{#each rows as r (r.invoiceId)}<tr
                    ><td
                      ><div class="font-medium">{r.number}</div>
                      <p class="text-xs text-ink-muted">{r.supplierName}</p>
                      <p class="text-xs text-ink-muted">Réf. {r.externalNumber}</p></td
                    ><td>{states[r.state]}</td><td class="whitespace-nowrap font-mono"
                      >{r.remaining === null ? 'À vérifier' : money(r.remaining, r.currency)}</td
                    ><td
                      >{r.revision ?? '—'}{#if r.revision}<p class="text-xs text-ink-muted">
                          {r.installments.length} échéance(s) capturée(s)
                        </p>{/if}</td
                    ><td
                      ><Button
                        variant="ghost"
                        disabled={r.state === 'INCONSISTENT'}
                        onclick={() => inspect(r.invoiceId)}
                        >{canManage ? 'Planifier' : 'Consulter'} {r.number}</Button
                      ></td
                    ></tr
                  >{/each}{/snippet}</Table
            >
          </div>
          <div class="space-y-3 sm:hidden">
            {#each rows as r (r.invoiceId)}<article
                class="space-y-2 rounded-card border border-edge bg-surface p-4"
              >
                <h3 class="font-medium">{r.number} · {r.supplierName}</h3>
                <p class="break-all text-xs text-ink-muted">Réf. {r.externalNumber}</p>
                <p class="text-sm">{states[r.state]} · révision {r.revision ?? '—'}</p>
                <p class="font-mono">
                  {r.remaining === null ? 'À vérifier' : money(r.remaining, r.currency)}
                </p>
                <Button
                  variant="secondary"
                  disabled={r.state === 'INCONSISTENT'}
                  onclick={() => inspect(r.invoiceId)}
                  >{canManage ? 'Planifier' : 'Consulter'} {r.number}</Button
                >
              </article>{/each}
          </div>
        {/if}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span class="text-sm text-ink-muted">{total} facture(s) · page {page}</span><Button
            variant="secondary"
            disabled={page === 1}
            onclick={() => {
              page--;
              void load();
            }}>Précédent</Button
          ><Button
            variant="secondary"
            disabled={page * 20 >= total}
            onclick={() => {
              page++;
              void load();
            }}>Suivant</Button
          >
        </div>
      {/if}
    {/if}
  </div>
</div>
<Drawer bind:open width="xl" title="Planifier les échéances fournisseur" dismissible={!editorBusy}
  >{#if invoiceId}{#key invoiceId}<SupplierScheduleEditor
        {invoiceId}
        bind:active={editorBusy}
        onchanged={() => void load()}
      />{/key}{/if}</Drawer
>
