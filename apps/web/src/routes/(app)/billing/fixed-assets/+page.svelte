<script lang="ts">
  import { onMount } from 'svelte';
  import { page as currentPage } from '$app/state';
  import {
    CURRENCIES,
    formatLedgerAmount,
    ledgerAmount,
    ledgerCents,
    type AssetPlanInput,
    type ExactDepreciationRow,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    readAssetIntent,
    rememberAssetIntent,
    validateAssetIntent,
    type AssetIntent,
  } from '$lib/billing/asset-intent';
  import {
    Modal,
    PageHeader,
    Card,
    Table,
    Badge,
    Button,
    EmptyState,
    Skeleton,
    ErrorNotice,
    EntityPicker,
    Input,
    Select,
  } from '$lib/components/ui';
  interface Asset {
    id: string;
    assetCode: string;
    name: string;
    category: string | null;
    acquisitionReference: string | null;
    currency: string | null;
    acquisitionDate: string;
    depreciationStartDate: string | null;
    cost: string;
    salvageValue: string;
    usefulLifeMonths: number;
    status: 'DRAFT' | 'ACTIVE' | 'DISPOSED';
    accumulatedDepreciation: string;
    depreciationExpenseAccountCode: string;
    accumulatedDepreciationAccountCode: string;
    version: number;
    planHash: string | null;
  }
  interface Review {
    asset: Asset;
    qualified: boolean;
    historicalAnchorEntryId?: string | null;
    rows: ExactDepreciationRow[];
    depreciations: {
      id: string;
      period: string;
      amount: string;
      currency: string | null;
      journalEntryId: string | null;
    }[];
    next: ExactDepreciationRow | null;
    nextDue?: boolean;
    reviewToken: string | null;
  }
  interface History {
    kind: string;
    version: number;
    reason: string | null;
    result: Asset;
  }
  const canManage = $derived(!!$auth?.user.permissions.includes('billing.assets.manage'));
  const canPost = $derived(canManage && !!$auth?.user.permissions.includes('billing.assets.post'));
  const canLedger = $derived(!!$auth?.user.permissions.includes('billing.ledger.read'));
  const key = $derived(`pulsar.fixed-assets:${$auth?.tenant.id}:${$auth?.user.id}`);
  const labels: Record<string, string> = {
    DRAFT: 'Brouillon',
    ACTIVE: 'En amortissement',
    DISPOSED: 'Retiré du suivi',
    CREATE: 'Création',
    UPDATE: 'Modification',
    ACTIVATE: 'Plan figé',
    DEPRECIATE: 'Période enregistrée',
    RETIRE: 'Retrait du suivi',
  };
  const money = (v: string) => formatLedgerAmount(v);
  const net = (a: Asset) =>
    ledgerAmount(ledgerCents(a.cost) - ledgerCents(a.accumulatedDepreciation));
  let assets = $state<Asset[]>([]),
    loading = $state(true),
    error = $state(''),
    blocked = $state(false),
    saving = $state(false);
  let pending = $state<AssetIntent | null>(null),
    review = $state<Review | null>(null),
    history = $state<History[]>([]),
    selected = $state(''),
    detailLoading = $state(false),
    detailError = $state(''),
    page = $state(0);
  let showForm = $state(false),
    editing = $state<Asset | null>(null),
    formError = $state(''),
    retiring = $state(false),
    reason = $state('');
  const blank = () => ({
    assetCode: '',
    name: '',
    category: '',
    acquisitionReference: '',
    currency: '',
    acquisitionDate: '',
    depreciationStartMonth: '',
    cost: '',
    salvageValue: '0.00',
    usefulLifeMonths: 60,
    depreciationExpenseAccountCode: '',
    accumulatedDepreciationAccountCode: '',
  });
  let form = $state<
    AssetPlanInput & {
      assetCode: string;
      name: string;
      category: string;
      acquisitionReference: string;
    }
  >(blank());
  let listGeneration = 0,
    detailGeneration = 0;
  const locked = $derived(saving || blocked || !!pending);
  const canResume = $derived(canManage && (!pending?.path.endsWith('/depreciate') || canPost));
  async function load() {
    const seq = ++listGeneration;
    loading = true;
    assets = [];
    try {
      const data = await api<Asset[]>('/billing/fixed-assets');
      if (seq === listGeneration) assets = data;
    } catch (e) {
      if (seq === listGeneration) error = (e as Error).message;
    } finally {
      if (seq === listGeneration) loading = false;
    }
  }
  onMount(() => {
    try {
      pending = readAssetIntent(key);
    } catch (e) {
      blocked = true;
      error = (e as Error).message;
    }
    void load().then(() => {
      const id = currentPage.url.searchParams.get('assetId');
      if (id && !pending) void inspect(id);
    });
  });
  async function inspect(id: string) {
    const seq = ++detailGeneration;
    selected = id;
    review = null;
    history = [];
    detailError = '';
    detailLoading = true;
    page = 0;
    try {
      const [r, h] = await Promise.all([
        api<Review>(`/billing/fixed-assets/${id}/schedule`),
        api<History[]>(`/billing/fixed-assets/${id}/history`),
      ]);
      if (seq === detailGeneration) {
        review = r;
        history = h;
      }
    } catch (e) {
      if (seq === detailGeneration) detailError = (e as Error).message;
    } finally {
      if (seq === detailGeneration) detailLoading = false;
    }
  }
  function open(a?: Asset) {
    if (locked) return;
    editing = a ?? null;
    formError = '';
    form = a
      ? {
          assetCode: a.assetCode,
          name: a.name,
          category: a.category ?? '',
          acquisitionReference: a.acquisitionReference ?? '',
          currency: a.currency ?? '',
          acquisitionDate: a.acquisitionDate.slice(0, 10),
          depreciationStartMonth: a.depreciationStartDate?.slice(0, 7) ?? '',
          cost: a.cost,
          salvageValue: a.salvageValue,
          usefulLifeMonths: a.usefulLifeMonths,
          depreciationExpenseAccountCode: a.depreciationExpenseAccountCode,
          accumulatedDepreciationAccountCode: a.accumulatedDepreciationAccountCode,
        }
      : blank();
    showForm = true;
  }
  async function send(p?: AssetIntent) {
    if (saving || blocked) return;
    const wasPending = !!pending;
    error = '';
    formError = '';
    try {
      if (!pending) {
        if (!p) return;
        rememberAssetIntent(key, p);
        pending = p;
      }
      saving = true;
      const result = await api<Asset>(pending.path, { method: pending.method, body: pending.body });
      localStorage.removeItem(key);
      pending = null;
      showForm = false;
      retiring = false;
      toast.success('Dossier enregistré');
      await Promise.all([load(), inspect(result.id)]);
    } catch (e) {
      if (!wasPending && e instanceof ApiError && [400, 404, 409, 422].includes(e.statusCode)) {
        localStorage.removeItem(key);
        pending = null;
      }
      error = (e as Error).message;
      formError = error;
    } finally {
      saving = false;
    }
  }
  async function save() {
    try {
      const p: AssetIntent = {
        path: editing ? `/billing/fixed-assets/${editing.id}` : '/billing/fixed-assets',
        method: editing ? 'PATCH' : 'POST',
        body: {
          ...form,
          operationKey: crypto.randomUUID(),
          ...(editing ? { expectedVersion: editing.version } : {}),
        },
      };
      validateAssetIntent(p);
      if (
        await confirmAction(
          `Enregistrer ce brouillon en ${form.currency} ? Aucune écriture d’acquisition ne sera créée.`,
        )
      )
        await send(p);
    } catch (e) {
      formError = (e as Error).message;
    }
  }
  async function action(kind: 'activate' | 'depreciate' | 'dispose') {
    if (!review || locked) return;
    const a = review.asset;
    const message =
      kind === 'activate'
        ? `Figer définitivement le plan de ${a.name} en ${a.currency}, sur ${a.usefulLifeMonths} mois ? Les comptes, dates et montants ne seront plus modifiables.`
        : kind === 'dispose'
          ? 'Retirer cet actif du suivi ? Cela arrête les prochaines dotations, mais ne comptabilise aucune cession, sortie ou plus-value.'
          : `Enregistrer ${review.next?.period} : ${money(review.next?.amount ?? '0')} ${a.currency}, date ${review.next?.date} ? Une dotation nulle ne crée pas d’écriture au grand livre.`;
    if (kind === 'dispose' && reason.trim().length < 3) {
      formError = 'Précisez le motif du retrait.';
      return;
    }
    if (!(await confirmAction(message))) return;
    await send({
      path: `/billing/fixed-assets/${a.id}/${kind}`,
      method: 'POST',
      body: {
        operationKey: crypto.randomUUID(),
        expectedVersion: a.version,
        confirmed: true,
        ...(kind === 'activate'
          ? { reviewToken: review.reviewToken }
          : kind === 'depreciate'
            ? { period: review.next?.period }
            : { reason }),
      },
    });
  }
</script>

<svelte:head><title>Immobilisations · Pulsar</title></svelte:head>
<PageHeader
  title="Immobilisations"
  subtitle="Un actif, une devise, un plan figé. Distinguez la prévision des dotations réellement comptabilisées."
/>
<div
  class="mb-4 flex flex-wrap items-center justify-between gap-3"
  data-tour="fixed-assets-register"
>
  <div class="flex flex-wrap gap-2">
    <Button href="/finance" variant="ghost">Retour à Finance</Button><Button
      variant="ghost"
      disabled={saving || loading}
      onclick={async () => {
        if (!blocked) error = '';
        await load();
        if (selected) await inspect(selected);
      }}>Actualiser le registre</Button
    >
  </div>
  {#if canManage}<Button variant="primary" disabled={locked} onclick={() => open()}
      >Nouvelle immobilisation</Button
    >{/if}
</div>
<ErrorNotice message={error} />
{#if pending}
  <Card
    ><div class="space-y-3">
      <h2 class="font-semibold">Demande à confirmer</h2>
      <p class="text-sm text-ink-muted">
        Une réponse n’a pas été confirmée. Reprenez exactement la même demande : aucune nouvelle clé
        ne sera créée.
      </p>
      <p class="break-all font-mono text-xs">{pending.path} · {pending.body.operationKey}</p>
      {#if canResume}<Button disabled={saving} onclick={() => send()}
          >Reprendre la demande conservée</Button
        >{:else}<p class="text-sm">
          Vos droits actuels ne permettent pas cette reprise. La demande reste conservée.
        </p>{/if}
    </div></Card
  >
{/if}
{#if loading}<Skeleton rows={4} />{:else if !assets.length}<EmptyState
    title="Aucune immobilisation"
    message="Enregistrez un brouillon avec une devise et un premier mois explicites. L’acquisition comptable reste une opération séparée."
  />{:else}
  <div class="hidden md:block">
    <Table
      >{#snippet head()}<th>Actif</th><th>Devise</th><th class="text-right">Coût</th><th
          class="text-right">Cumul comptabilisé</th
        ><th class="text-right">Valeur nette suivie</th><th>Statut</th><th
        ></th>{/snippet}{#snippet body()}{#each assets as a (a.id)}<tr
            ><td
              ><div class="font-medium">{a.name}</div>
              <div class="font-mono text-xs text-ink-muted">{a.assetCode}</div></td
            ><td>{a.currency ?? 'Non qualifiée'}</td><td class="text-right tabular-nums"
              >{money(a.cost)}</td
            ><td class="text-right tabular-nums">{money(a.accumulatedDepreciation)}</td><td
              class="text-right tabular-nums">{money(net(a))}</td
            ><td
              ><Badge tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{labels[a.status]}</Badge></td
            ><td
              ><Button variant="ghost" onclick={() => inspect(a.id)}>Ouvrir {a.assetCode}</Button
              ></td
            ></tr
          >{/each}{/snippet}</Table
    >
  </div>
  <div class="grid gap-3 md:hidden">
    {#each assets as a (a.id)}<Card
        ><div class="space-y-2">
          <h2 class="font-semibold">{a.name}</h2>
          <p class="text-sm">{a.assetCode} · {labels[a.status]}</p>
          <p class="text-sm">Coût {money(a.cost)} · {a.currency ?? 'Devise non qualifiée'}</p>
          <p class="text-sm text-ink-muted">
            Cumul {money(a.accumulatedDepreciation)} · Net {money(net(a))}
          </p>
          <Button variant="secondary" onclick={() => inspect(a.id)}>Ouvrir {a.assetCode}</Button>
        </div></Card
      >{/each}
  </div>
{/if}

{#if selected}
  <section class="mt-6 space-y-4" aria-label="Dossier immobilisation">
    <ErrorNotice message={detailError} onretry={() => inspect(selected)} />
    {#if detailLoading}<Skeleton rows={5} />{:else if review}
      {@const r = review}
      {@const a = r.asset}
      <Card
        ><div class="space-y-4">
          <div class="flex flex-wrap justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">{a.name}</h2>
              <p class="text-sm text-ink-muted">
                {a.assetCode} · {a.currency ?? 'Devise non qualifiée'} · Révision {a.version}
              </p>
            </div>
            <Badge tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{labels[a.status]}</Badge>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <p class="text-xs text-ink-muted">Coût enregistré</p>
              <p class="text-lg tabular-nums">{money(a.cost)} {a.currency ?? ''}</p>
            </div>
            <div>
              <p class="text-xs text-ink-muted">Dotations comptabilisées</p>
              <p class="text-lg tabular-nums">
                {money(a.accumulatedDepreciation)}
                {a.currency ?? ''}
              </p>
            </div>
            <div>
              <p class="text-xs text-ink-muted">Valeur nette suivie</p>
              <p class="text-lg tabular-nums">{money(net(a))} {a.currency ?? ''}</p>
            </div>
          </div>
          <p class="text-sm text-ink-muted">
            Acquisition : {a.acquisitionDate.slice(0, 10)} · Référence : {a.acquisitionReference ??
              'Non renseignée'} · Catégorie : {a.category ?? 'Non renseignée'}
          </p>
          {#if !review.qualified}<p class="rounded-md border border-edge p-3 text-sm">
              Dossier historique non qualifié : lecture seule. La devise et le plan d’origine ne
              sont pas supposés. Qualifier les écritures passées ne permet pas de reprendre les
              dotations futures : leur plan reste à documenter séparément.
              {#if canLedger && review.historicalAnchorEntryId}<a
                  class="mt-2 block text-accent hover:underline"
                  href={`/billing/ledger-qualification?entryId=${encodeURIComponent(review.historicalAnchorEntryId)}`}
                  >Reprendre les dotations historiques</a
                >{:else if canLedger}<span class="mt-2 block text-ink-muted"
                  >Aucune première écriture historique unique disponible pour la reprise.</span
                >{/if}
            </p>{:else}
            <p class="text-sm text-ink-muted">
              Linéaire mensuel, sans prorata journalier. Arrondi au centime sur le cumul. Charge {a.depreciationExpenseAccountCode}
              / cumul {a.accumulatedDepreciationAccountCode}. Dates civiles UTC.
            </p>
            <div class="flex flex-wrap gap-2">
              {#if canManage && a.status === 'DRAFT'}<Button
                  disabled={locked}
                  onclick={() => open(a)}>Modifier le brouillon</Button
                ><Button variant="primary" disabled={locked} onclick={() => action('activate')}
                  >Figer et activer le plan</Button
                >{/if}{#if canManage && a.status !== 'DISPOSED'}<Button
                  variant="ghost"
                  disabled={locked}
                  onclick={() => {
                    reason = '';
                    formError = '';
                    retiring = true;
                  }}>Retirer du suivi</Button
                >{/if}
            </div>
            {#if review.next}<div class="rounded-md border border-edge bg-surface-muted p-4">
                <h3 class="font-medium">Prochaine période : {review.next.period}</h3>
                <p class="my-2 text-sm">
                  {money(review.next.amount)}
                  {a.currency} · Date comptable : {review.next.date}
                </p>
                {#if !review.nextDue}<p class="text-sm text-ink-muted">
                    Disponible à la fin de ce mois, jamais par anticipation.
                  </p>{/if}{#if canPost}<Button
                    variant="primary"
                    disabled={locked || !review.nextDue}
                    onclick={() => action('depreciate')}
                    >{review.next.amount === '0.00'
                      ? 'Enregistrer la période sans dotation'
                      : 'Comptabiliser la prochaine dotation'}</Button
                  >{:else}<p class="text-sm text-ink-muted">
                    La permission de comptabiliser les immobilisations est requise.
                  </p>{/if}
              </div>{:else if a.status === 'ACTIVE'}<p class="text-sm">
                Toutes les périodes du plan ont été enregistrées.
              </p>{/if}
            {#if a.status === 'DISPOSED'}<p class="text-sm">
                Suivi arrêté. Aucune cession comptable ni remise à zéro des soldes n’a été produite.
              </p>{/if}
          {/if}
        </div></Card
      >
      {#if review.qualified}
        <h3 class="font-semibold">{a.planHash ? 'Plan figé' : 'Plan prévisionnel à valider'}</h3>
        <Table
          >{#snippet head()}<th>Mois</th><th class="text-right">Dotation ({a.currency})</th><th
              class="text-right">Cumul prévu</th
            ><th class="text-right">Net prévu</th
            >{/snippet}{#snippet body()}{#each r.rows.slice(page * 24, (page + 1) * 24) as row (row.period)}<tr
                ><td class="whitespace-nowrap"
                  >{row.period}
                  <div class="text-xs text-ink-muted">{row.date}</div></td
                ><td class="text-right tabular-nums">{money(row.amount)}</td><td
                  class="text-right tabular-nums">{money(row.accumulated)}</td
                ><td class="text-right tabular-nums">{money(row.bookValue)}</td></tr
              >{/each}{/snippet}</Table
        >
        <div class="flex items-center justify-end gap-2">
          <span class="text-xs text-ink-muted"
            >{page * 24 + 1}–{Math.min((page + 1) * 24, review.rows.length)} / {review.rows.length} mois</span
          ><Button
            disabled={page === 0}
            onclick={() => {
              page--;
            }}>Précédent</Button
          ><Button
            disabled={(page + 1) * 24 >= review.rows.length}
            onclick={() => {
              page++;
            }}>Suivant</Button
          >
        </div>
      {/if}
      <h3 class="font-semibold">Périodes réellement enregistrées</h3>
      {#if !review.depreciations.length}<p class="text-sm text-ink-muted">
          Aucune dotation enregistrée. Le plan prévisionnel ne constitue pas une écriture comptable.
        </p>{:else}<Table
          >{#snippet head()}<th>Période</th><th class="text-right">Montant</th><th>Devise</th><th
              >Grand livre</th
            >{/snippet}{#snippet body()}{#each r.depreciations as entry (entry.id)}<tr
                ><td>{entry.period.slice(0, 7)}</td><td class="text-right tabular-nums"
                  >{money(entry.amount)}</td
                ><td>{entry.currency ?? 'Non qualifiée'}</td><td
                  >{#if entry.journalEntryId && canLedger}<a
                      class="text-accent hover:underline"
                      href={`/billing/ledger?sourceType=depreciation&sourceId=${entry.id}&currency=${entry.currency}`}
                      >Voir l’écriture</a
                    >{:else if entry.journalEntryId}Écriture comptabilisée{:else if entry.currency}Montant
                    nul : aucune écriture{:else}Lien historique non qualifié{/if}</td
                ></tr
              >{/each}{/snippet}</Table
        >{/if}
      <h3 class="font-semibold">Historique des 20 dernières opérations</h3>
      <div class="space-y-2">
        {#each history as h (h.version)}<p class="text-sm">
            <span class="font-mono text-ink-muted">v{h.version}</span> · {labels[h.kind]} · {h
              .result.name} · {h.result.currency}{#if h.reason}
              · {h.reason}{/if}
          </p>{:else}<p class="text-sm text-ink-muted">
            Aucune opération versionnée sur ce dossier historique.
          </p>{/each}
      </div>
    {/if}
  </section>
{/if}

{#if showForm}<Modal
    open
    title={editing ? 'Modifier le brouillon' : 'Nouvelle immobilisation'}
    size="lg"
    dismissible={!saving}
    onclose={() => (showForm = false)}
  >
    <fieldset disabled={locked} class="grid gap-4 sm:grid-cols-2">
      <label class="space-y-1 text-sm"
        >Code<Input
          bind:value={form.assetCode}
          maxlength={40}
          aria-label="Code immobilisation"
        /></label
      >
      <label class="space-y-1 text-sm"
        >Nom<Input bind:value={form.name} maxlength={120} aria-label="Nom immobilisation" /></label
      >
      <label class="space-y-1 text-sm"
        >Catégorie<Input bind:value={form.category} maxlength={80} /></label
      >
      <label class="space-y-1 text-sm"
        >Référence d’acquisition<Input
          bind:value={form.acquisitionReference}
          maxlength={200}
        /></label
      >
      <label class="space-y-1 text-sm"
        >Devise<Select bind:value={form.currency} aria-label="Devise immobilisation"
          ><option value="">Choisir une devise</option>{#each CURRENCIES as c}<option value={c.code}
              >{c.code} — {c.name}</option
            >{/each}</Select
        ></label
      >
      <label class="space-y-1 text-sm"
        >Date d’acquisition<Input
          type="date"
          bind:value={form.acquisitionDate}
          aria-label="Date acquisition"
        /></label
      >
      <label class="space-y-1 text-sm"
        >Coût<Input
          inputmode="decimal"
          bind:value={form.cost}
          maxlength={13}
          aria-label="Coût immobilisation"
        /></label
      >
      <label class="space-y-1 text-sm"
        >Valeur résiduelle<Input
          inputmode="decimal"
          bind:value={form.salvageValue}
          maxlength={13}
          aria-label="Valeur résiduelle"
        /></label
      >
      <label class="space-y-1 text-sm"
        >Premier mois du plan<Input
          type="month"
          bind:value={form.depreciationStartMonth}
          aria-label="Premier mois"
        /></label
      >
      <label class="space-y-1 text-sm"
        >Durée en mois<Input
          type="number"
          min={1}
          max={1200}
          step={1}
          bind:value={form.usefulLifeMonths}
          aria-label="Durée en mois"
        /></label
      >
      <EntityPicker
        endpoint="/billing/fixed-assets/accounts"
        label="Compte de charge"
        listShape="array"
        labelKey="code name"
        detailKey="type"
        valueKey="code"
        selectedLabel={form.depreciationExpenseAccountCode}
        bind:value={form.depreciationExpenseAccountCode}
        disabled={locked}
      />
      <EntityPicker
        endpoint="/billing/fixed-assets/accounts"
        label="Compte de cumul (Actif)"
        listShape="array"
        labelKey="code name"
        detailKey="type"
        valueKey="code"
        selectedLabel={form.accumulatedDepreciationAccountCode}
        bind:value={form.accumulatedDepreciationAccountCode}
        disabled={locked}
      />
    </fieldset>
    <p class="mt-4 text-xs text-ink-muted">
      Montants exacts, avec un point décimal. Aucun total multidevise, conversion, prorata fiscal ou
      écriture d’acquisition automatique.
    </p>
    <ErrorNotice message={formError} />
    {#snippet footer()}<Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          showForm = false;
        }}>Fermer</Button
      ><Button variant="primary" disabled={locked} onclick={save}>Enregistrer le brouillon</Button
      >{/snippet}
  </Modal>{/if}
{#if retiring}<Modal
    open
    title="Retirer du suivi"
    size="sm"
    dismissible={!saving}
    onclose={() => (retiring = false)}
    ><p class="mb-4 text-sm text-ink-muted">
      Arrête les prochaines dotations sans écriture de cession. Le dossier et les montants déjà
      comptabilisés sont conservés.
    </p>
    <label class="text-sm"
      >Motif<Input
        bind:value={reason}
        maxlength={500}
        aria-label="Motif du retrait"
        disabled={locked}
      /></label
    ><ErrorNotice message={formError} />{#snippet footer()}<Button
        disabled={saving}
        onclick={() => {
          retiring = false;
        }}>Fermer</Button
      ><Button disabled={locked || reason.trim().length < 3} onclick={() => action('dispose')}
        >Confirmer le retrait</Button
      >{/snippet}</Modal
  >{/if}
