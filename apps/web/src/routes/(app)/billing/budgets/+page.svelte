<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CURRENCIES,
    formatLedgerAmount,
    validateBudgetLines,
    validateBudgetPeriod,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    readPlanningIntent,
    rememberPlanningIntent,
    type PlanningIntent,
  } from '$lib/billing/planning-intent';
  import LedgerCoverage from '$lib/components/billing/LedgerCoverage.svelte';
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
  interface Line {
    accountCode: string;
    amount: string;
  }
  interface Budget {
    id: string;
    name: string;
    fiscalYear: number;
    isActive: boolean;
    currency: string | null;
    periodFrom: string | null;
    periodTo: string | null;
    version: number;
    lines: Line[];
  }
  interface Variance {
    rows: { accountCode: string; name: string; budget: string; actual: string; variance: string }[];
    currency: string;
    periodFrom: string;
    periodTo: string;
    budgetVersion: number;
    coverage: {
      unknownEntries: number;
      selectedEntries: number;
      otherCurrencies: { currency: string; count: number }[];
    };
  }
  const canManage = $derived(!!$auth?.user.permissions.includes('billing.ledger.manage'));
  const key = $derived(`pulsar.budgets:${$auth?.tenant.id}:${$auth?.user.id}`);
  let budgets = $state<Budget[]>([]),
    loading = $state(true),
    error = $state(''),
    blocked = $state(false);
  let showModal = $state(false),
    editing = $state<string | null>(null),
    version = $state(0),
    saving = $state(false),
    formError = $state('');
  let name = $state(''),
    year = $state(new Date().getFullYear()),
    currency = $state(''),
    from = $state(''),
    to = $state(''),
    active = $state(true),
    lines = $state<Line[]>([{ accountCode: '', amount: '' }]);
  let pending = $state<PlanningIntent | null>(null);
  let selected = $state<Budget | null>(null),
    result = $state<Variance | null>(null),
    varianceLoading = $state(false),
    varianceError = $state('');
  let history = $state<{ version: number; createdAt: string; snapshot: Budget }[]>([]);
  let generation = 0;
  async function load() {
    generation++;
    selected = null;
    result = null;
    history = [];
    loading = true;
    error = '';
    budgets = [];
    try {
      budgets = await api<Budget[]>('/billing/budgets');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  function restore() {
    try {
      pending = readPlanningIntent(key);
      if (pending) {
        const b = pending.body;
        editing = pending.method === 'PATCH' ? pending.path.split('/').pop()! : null;
        name = String(b.name);
        year = Number(b.fiscalYear ?? new Date().getFullYear());
        currency = String(b.currency ?? '');
        from = String(b.periodFrom ?? '');
        to = String(b.periodTo ?? '');
        active = b.isActive === true;
        version = Number(b.expectedVersion ?? 0);
        lines = b.lines as Line[];
        showModal = true;
      }
    } catch (e) {
      blocked = true;
      error = (e as Error).message;
    }
  }
  onMount(() => {
    restore();
    if (!blocked) void load();
  });
  function open(b?: Budget) {
    if (pending) {
      showModal = true;
      return;
    }
    editing = b?.id ?? null;
    version = b?.version ?? 0;
    name = b?.name ?? '';
    year = b?.fiscalYear ?? new Date().getFullYear();
    currency = b?.currency ?? '';
    from = b?.periodFrom?.slice(0, 10) ?? '';
    to = b?.periodTo?.slice(0, 10) ?? '';
    active = b?.isActive ?? true;
    lines = b?.lines.map((l) => ({ accountCode: l.accountCode, amount: l.amount })) ?? [
      { accountCode: '', amount: '' },
    ];
    formError = '';
    showModal = true;
  }
  async function save() {
    formError = '';
    const wasPending = !!pending;
    try {
      if (!pending) {
        if (!name.trim()) throw Error('Le nom est requis.');
        validateBudgetLines(lines);
        if (!editing) {
          validateBudgetPeriod(from, to, year);
          if (!CURRENCIES.some((c) => c.code === currency)) throw Error('Choisissez une devise.');
        }
        if (
          !(await confirmAction(
            editing
              ? 'Enregistrer cette révision du budget ?'
              : `Créer ce budget en ${currency}, du ${from} au ${to} ? Sa devise et sa période seront figées.`,
          ))
        )
          return;
        const p: PlanningIntent = {
          path: editing ? `/billing/budgets/${editing}` : '/billing/budgets',
          method: editing ? 'PATCH' : 'POST',
          body: {
            operationKey: crypto.randomUUID(),
            name,
            isActive: active,
            lines: lines.map((l) => ({ accountCode: l.accountCode, amount: l.amount })),
            ...(editing
              ? { expectedVersion: version }
              : { fiscalYear: year, currency, periodFrom: from, periodTo: to }),
          },
        };
        rememberPlanningIntent(key, p);
        pending = p;
      }
      saving = true;
      await api(pending.path, { method: pending.method, body: pending.body });
      localStorage.removeItem(key);
      pending = null;
      showModal = false;
      selected = null;
      generation++;
      result = null;
      toast.success('Budget enregistré');
      await load();
    } catch (e) {
      if (!wasPending && e instanceof ApiError && [400, 404, 409, 422].includes(e.statusCode)) {
        localStorage.removeItem(key);
        pending = null;
      }
      formError = (e as Error).message;
    } finally {
      saving = false;
    }
  }
  async function inspect(b: Budget) {
    const seq = ++generation;
    selected = b;
    result = null;
    history = [];
    varianceError = '';
    varianceLoading = true;
    try {
      const h = await api<typeof history>(`/billing/budgets/${b.id}/history`);
      if (seq !== generation) return;
      history = h;
      if (b.currency) {
        const v = await api<Variance>(`/billing/budgets/${b.id}/variance`);
        if (seq === generation) result = v;
      }
    } catch (e) {
      if (seq === generation) varianceError = (e as Error).message;
    } finally {
      if (seq === generation) varianceLoading = false;
    }
  }
</script>

<svelte:head><title>Budgets · Pulsar</title></svelte:head>
<PageHeader
  title="Budgets"
  subtitle="Comparer une prévision aux écritures d’une même devise et d’une période figée."
/>
<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <div class="flex flex-wrap gap-2">
    <Button href="/finance" variant="ghost">Retour à Finance</Button><Button
      href="/billing/accounting-profile"
      variant="secondary">Profil comptable</Button
    ><Button variant="ghost" disabled={loading || !!pending || blocked} onclick={load}
      >Actualiser</Button
    >
  </div>
  {#if canManage}<Button onclick={() => open()} disabled={blocked}
      >{pending ? 'Reprendre la demande' : 'Nouveau budget'}</Button
    >{/if}
</div>
<ErrorNotice message={error} onretry={blocked ? undefined : load} />
<p class="mb-4 max-w-3xl text-sm text-ink-muted">
  Les anciens budgets sans devise ni période capturées restent consultables. Créez un nouveau budget
  pour les qualifier; aucun historique n’est converti. Les montants ne sont jamais additionnés entre
  devises.
</p>
{#if loading}<Skeleton rows={4} />{:else if budgets.length === 0 && !error}<EmptyState
    title="Aucun budget"
    message="Commencez par une devise, une période et les comptes à suivre."
  />{:else if !error}
  <div class="space-y-3 sm:hidden" aria-label="Liste des budgets">
    {#each budgets as b (b.id)}
      <article class="rounded-lg border border-edge bg-surface p-4">
        <h2 class="break-words font-medium">{b.name}</h2>
        <p class="mt-1 text-xs text-ink-muted">{b.lines.length} compte(s) · révision {b.version}</p>
        <p class="mt-3 text-sm tabular-nums">
          {b.periodFrom?.slice(0, 10) ?? 'Période non qualifiée'}{b.periodTo
            ? ' → ' + b.periodTo.slice(0, 10)
            : ''}
        </p>
        <div class="mt-2 flex items-center justify-between gap-3 text-sm">
          <span>{b.currency ?? 'Devise non qualifiée'}</span><Badge
            tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Actif' : 'Archivé'}</Badge
          >
        </div>
        <div class="mt-3 flex gap-2">
          <Button variant="secondary" onclick={() => inspect(b)}>Consulter</Button
          >{#if canManage && b.currency}<Button
              variant="ghost"
              disabled={!!pending}
              onclick={() => open(b)}>Modifier</Button
            >{/if}
        </div>
      </article>
    {/each}
  </div>
  <div class="hidden sm:block">
    <Table>
      {#snippet head()}<th>Budget</th><th>Période figée</th><th>Devise</th><th>Statut</th><th
          >Actions</th
        >{/snippet}
      {#snippet body()}{#each budgets as b (b.id)}<tr>
            <td
              ><span class="font-medium">{b.name}</span>
              <p class="text-xs text-ink-muted">
                {b.lines.length} compte(s) · révision {b.version}
              </p></td
            >
            <td class="whitespace-nowrap text-sm tabular-nums"
              >{b.periodFrom?.slice(0, 10) ?? 'Non qualifiée'}{b.periodTo
                ? ' → ' + b.periodTo.slice(0, 10)
                : ''}</td
            >
            <td>{b.currency ?? 'Non qualifiée'}</td><td
              ><Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Actif' : 'Archivé'}</Badge
              ></td
            >
            <td
              ><div class="flex flex-wrap gap-1">
                <Button variant="ghost" onclick={() => inspect(b)}>Consulter</Button
                >{#if canManage && b.currency}<Button
                    variant="ghost"
                    disabled={!!pending}
                    onclick={() => open(b)}>Modifier</Button
                  >{/if}
              </div></td
            >
          </tr>{/each}{/snippet}
    </Table>
  </div>{/if}

{#if selected}
  <section aria-label="Détail du budget" class="mt-6 space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">{selected.name}</h2>
      <Button
        variant="ghost"
        onclick={() => {
          generation++;
          selected = null;
          result = null;
        }}>Fermer le détail</Button
      >
    </div>
    <ErrorNotice message={varianceError} />
    {#if varianceLoading}<Skeleton rows={4} />{:else if result}
      <p class="text-sm">
        Du {result.periodFrom} au {result.periodTo}, dates comptables inclusives · révision {result.budgetVersion}.
        Couverture limitée aux comptes de ce budget.
      </p>
      <LedgerCoverage currency={result.currency} coverage={result.coverage} />
      <Table
        >{#snippet head()}<th>Compte</th><th class="text-right">Budget</th><th class="text-right"
            >Réalisé</th
          ><th class="text-right">Écart</th>{/snippet}
        {#snippet body()}{#each result?.rows ?? [] as r}<tr
              ><td>{r.accountCode} · {r.name}</td><td class="text-right tabular-nums"
                >{formatLedgerAmount(r.budget)}</td
              ><td class="text-right tabular-nums">{formatLedgerAmount(r.actual)}</td><td
                class="text-right tabular-nums">{formatLedgerAmount(r.variance)}</td
              ></tr
            >{/each}{/snippet}
      </Table>
      <p class="text-xs text-ink-muted">
        Écart = budget − réalisé, en {result.currency}. Le réalisé est le mouvement net de la période
        selon le sens du compte, pas son solde de clôture. Un écart positif n’est pas toujours
        favorable. Les soldes de bilan et les flux de résultat ne sont pas additionnés en un faux
        bénéfice.
      </p>
    {:else if !selected.currency}
      <p class="text-sm text-warn">
        Historique non qualifié : la comparaison est indisponible. Créez un nouveau budget avec
        devise et période explicites.
      </p>
      <Table
        >{#snippet head()}<th>Compte historique</th><th>Montant sans devise</th
          >{/snippet}{#snippet body()}{#each selected?.lines ?? [] as l}<tr
              ><td>{l.accountCode}</td><td>{formatLedgerAmount(l.amount)}</td></tr
            >{/each}{/snippet}</Table
      >
    {/if}
    {#if history.length}
      <details class="rounded-lg border border-edge p-3">
        <summary class="cursor-pointer text-sm font-medium"
          >Historique — 20 dernières révisions</summary
        >
        {#each history as h}<article class="mt-3 border-t border-edge pt-3 text-sm">
            <h3 class="font-medium">
              Révision {h.version} · {h.snapshot.name} · {h.snapshot.isActive ? 'Actif' : 'Archivé'}
            </h3>
            <p>
              {h.snapshot.currency} · {h.snapshot.periodFrom?.slice(0, 10)} → {h.snapshot.periodTo?.slice(
                0,
                10,
              )}
            </p>
            <ul class="mt-2">
              {#each h.snapshot.lines as l}<li>
                  {l.accountCode} : {formatLedgerAmount(l.amount)}
                </li>{/each}
            </ul>
          </article>{/each}
      </details>
    {/if}
  </section>
{/if}

{#if showModal}
  <Modal
    open
    title={editing ? 'Réviser le budget' : 'Nouveau budget'}
    size="lg"
    dismissible={!saving}
    onclose={() => (showModal = false)}
  >
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ErrorNotice message={formError} />
      {#if pending}<p role="status" class="text-sm text-warn">
          Demande conservée. Les champs sont verrouillés jusqu’à la confirmation de cette même
          demande.
        </p>{/if}
      <fieldset disabled={saving || !!pending || !canManage} class="space-y-4">
        <label class="block space-y-1 text-sm"
          ><span>Nom du budget</span><Input
            aria-label="Nom du budget"
            bind:value={name}
            maxlength={80}
          /></label
        >
        {#if !editing}<div class="grid gap-3 sm:grid-cols-2">
            <label class="block space-y-1 text-sm"
              ><span>Exercice (année de début)</span><Input
                aria-label="Exercice"
                type="number"
                bind:value={year}
                min={2000}
                max={2100}
              /></label
            >
            <label class="block space-y-1 text-sm"
              ><span>Devise du budget</span><Select
                aria-label="Devise du budget"
                bind:value={currency}
                ><option value="">Choisir explicitement</option>{#each CURRENCIES as c}<option
                    value={c.code}>{c.code}</option
                  >{/each}</Select
              ></label
            >
            <label class="block space-y-1 text-sm"
              ><span>Début de période</span><Input
                aria-label="Début de période"
                type="date"
                bind:value={from}
              /></label
            >
            <label class="block space-y-1 text-sm"
              ><span>Fin de période incluse</span><Input
                aria-label="Fin de période incluse"
                type="date"
                bind:value={to}
              /></label
            >
          </div>{:else}<p class="text-sm text-ink-muted">
            Révision attendue : {version}. Devise et période immuables; pour les changer, créez un
            nouveau budget.
          </p>{/if}
        <label class="flex items-center gap-2 text-sm"
          ><input type="checkbox" bind:checked={active} />Budget actif (décocher pour archiver sans
          effacer)</label
        >
        <div class="space-y-3">
          {#each lines as line, i}<div
              class="grid items-end gap-2 rounded-md border border-edge p-3 sm:grid-cols-[1fr_9rem_auto]"
            >
              <div>
                <span class="mb-1 block text-xs text-ink-muted">Compte · ligne {i + 1}</span
                ><EntityPicker
                  label={'Compte · ligne ' + (i + 1)}
                  endpoint="/billing/ledger/accounts"
                  bind:value={line.accountCode}
                  valueKey="code"
                  labelKey="code name"
                  listShape="array"
                  selectedLabel={line.accountCode}
                  disabled={saving || !!pending}
                />
              </div>
              <label class="block space-y-1 text-sm"
                ><span>Montant · ligne {i + 1}</span><Input
                  aria-label={'Montant · ligne ' + (i + 1)}
                  inputmode="decimal"
                  bind:value={line.amount}
                /></label
              >
              <Button
                variant="ghost"
                aria-label={'Retirer la ligne ' + (i + 1)}
                onclick={() => {
                  lines = lines.filter((_, n) => n !== i);
                }}
                disabled={lines.length === 1}>Retirer</Button
              >
            </div>{/each}
        </div>
        <Button
          variant="secondary"
          disabled={lines.length >= 200}
          onclick={() => {
            lines = [...lines, { accountCode: '', amount: '' }];
          }}>Ajouter un compte</Button
        >
      </fieldset>
      {#if canManage}<Button type="submit" loading={saving} disabled={blocked}
          >{pending ? 'Reprendre la demande' : 'Enregistrer le budget'}</Button
        >{/if}
    </form>
  </Modal>
{/if}
