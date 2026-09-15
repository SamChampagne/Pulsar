<script lang="ts">
  import { onMount } from 'svelte';
  import {
    MrpEntryKind,
    MrpSourcingMethod,
    type MrpResult,
    type MrpProposal,
  } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    Button,
    Card,
    Drawer,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
  } from '$lib/components/ui';
  import {
    ArrowRight,
    Calculator,
    ChevronRight,
    Factory,
    Package,
    Plus,
    RefreshCw,
    SlidersHorizontal,
    TriangleAlert,
  } from 'lucide-svelte';

  type Item = { id: string; sku: string; name: string; unit: string };
  type Policy = {
    id: string;
    itemId: string;
    locationId: string;
    method: MrpSourcingMethod;
    bomId: string | null;
    bomRevisionId: string | null;
    leadDays: number;
    safetyStock: string;
    minimumOrder: string;
    orderMultiple: string;
    updatedAt: string;
  };
  type Entry = {
    id: string;
    itemId: string;
    locationId: string;
    kind: MrpEntryKind;
    quantity: string;
    dueDate: string;
    reference: string;
    receiptId: string | null;
    isActive: boolean;
    updatedAt: string;
  };
  type Run = {
    id: string;
    createdAt: string;
    horizonEnd: string;
    proposalCount: number;
    exceptionCount: number;
  };
  type Detail = Run & { result: MrpResult; stale: boolean; staleReason: string | null };
  type Workspace = {
    policies: Policy[];
    entries: Entry[];
    runs: Run[];
    receipts: {
      id: string;
      number: string;
      status: string;
      lines: { itemId: string; qty: string }[];
    }[];
  };
  let options = $state<{
    locations: { id: string; name: string; code: string }[];
    items: Item[];
    boms: {
      id: string;
      code: string;
      name: string;
      productRef: string | null;
      revisions?: { id: string; revision: number; outputItemId: string; outputUnit: string }[];
    }[];
  }>({ locations: [], items: [], boms: [] });
  let workspace = $state<Workspace>({ policies: [], entries: [], runs: [], receipts: [] });
  let locationId = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let selectedRun = $state<Detail | null>(null);
  let horizonEnd = $state(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  let tab = $state('plan');
  let filter = $state('ALL');
  let search = $state('');
  let detailOpen = $state(false);
  let selectedItem = $state('');
  let editOpen = $state(false);
  let editMode = $state<'policy' | 'entry'>('entry');
  let editing = $state<Policy | Entry | null>(null);
  let formError = $state('');
  let formItem = $state('');
  let method = $state(MrpSourcingMethod.BUY);
  let kind = $state(MrpEntryKind.DEMAND);
  let bomId = $state('');
  let bomRevisionId = $state('');
  let leadDays = $state<string | number | null>(0);
  let safetyStock = $state<string | number | null>('0');
  let minimumOrder = $state<string | number | null>('0');
  let orderMultiple = $state<string | number | null>('1');
  let quantity = $state<string | number | null>('1');
  let dueDate = $state(new Date().toISOString().slice(0, 10));
  let reference = $state('');
  let receiptId = $state('');
  let isActive = $state(true);
  let acknowledged = $state(false);
  let generation = 0;
  const canManage = $derived(
    Boolean(
      $auth?.user.permissions.includes('manufacturing.manage') &&
      $auth?.user.permissions.includes('wms.read'),
    ),
  );
  const itemById = $derived(new Map(options.items.map((item) => [item.id, item])));
  const activeEntries = $derived(workspace.entries.filter((entry) => entry.isActive));
  const rows = $derived(
    (selectedRun?.result.items ?? []).filter(
      (item) =>
        (filter === 'ALL' || item.method === filter) &&
        `${item.sku} ${item.name}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const detail = $derived(selectedRun?.result.items.find((item) => item.item_id === selectedItem));
  const detailProposals = $derived(
    selectedRun?.result.proposals.filter((p) => p.item_id === selectedItem) ?? [],
  );
  const visibleEntries = $derived(
    workspace.entries.filter((entry) => entry.kind === (tab === 'demand' ? 'DEMAND' : 'SUPPLY')),
  );
  const date = (value: string) => value.slice(0, 10);
  const problem = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');

  async function loadSite() {
    const request = ++generation;
    selectedRun = null;
    error = '';
    notice = '';
    detailOpen = false;
    loading = true;
    if (!locationId) {
      loading = false;
      return;
    }
    try {
      const data = await api<Workspace>('/manufacturing/mrp/workspace', { query: { locationId } });
      if (request !== generation) return;
      workspace = data;
      if (data.runs[0]) {
        const run = await api<Detail>(`/manufacturing/mrp/runs/${data.runs[0].id}`);
        if (request === generation) selectedRun = run;
      }
    } catch (e) {
      if (request === generation) {
        error = problem(e);
        workspace = { policies: [], entries: [], runs: [], receipts: [] };
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  onMount(async () => {
    try {
      options = await api('/manufacturing/mrp/options');
      locationId = options.locations[0]?.id ?? '';
      await loadSite();
    } catch (e) {
      error = problem(e);
      loading = false;
    }
  });
  async function calculate() {
    busy = true;
    error = '';
    notice = '';
    try {
      const run = await api<Detail>('/manufacturing/mrp/runs', {
        method: 'POST',
        body: { locationId, horizonEnd },
      });
      selectedRun = run;
      workspace.runs = [run, ...workspace.runs].slice(0, 20);
      tab = 'plan';
    } catch (e) {
      error = `${problem(e)} Aucune commande n’a été passée. Consultez l’historique avant de relancer si la réponse est incertaine.`;
    } finally {
      busy = false;
    }
  }
  async function openRun(id: string) {
    busy = true;
    error = '';
    try {
      selectedRun = await api<Detail>(`/manufacturing/mrp/runs/${id}`);
      tab = 'plan';
    } catch (e) {
      error = problem(e);
    } finally {
      busy = false;
    }
  }
  function openEntry(entry?: Entry, requestedKind = MrpEntryKind.DEMAND) {
    editing = entry ?? null;
    editMode = 'entry';
    formError = '';
    formItem = entry?.itemId ?? '';
    kind = entry?.kind ?? requestedKind;
    quantity = entry?.quantity ?? '1';
    dueDate = entry ? date(entry.dueDate) : new Date().toISOString().slice(0, 10);
    reference = entry?.reference ?? '';
    receiptId = entry?.receiptId ?? '';
    isActive = entry?.isActive ?? true;
    editOpen = true;
  }
  function openPolicy(policy?: Policy) {
    editing = policy ?? null;
    editMode = 'policy';
    formError = '';
    formItem = policy?.itemId ?? '';
    method = policy?.method ?? MrpSourcingMethod.BUY;
    bomId = policy?.bomId ?? '';
    bomRevisionId = policy?.bomRevisionId ?? '';
    leadDays = policy?.leadDays ?? 0;
    safetyStock = policy?.safetyStock ?? '0';
    minimumOrder = policy?.minimumOrder ?? '0';
    orderMultiple = policy?.orderMultiple ?? '1';
    acknowledged = false;
    editOpen = true;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    formError = '';
    try {
      const common = {
        locationId,
        itemId: formItem,
        ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}),
      };
      if (editMode === 'policy')
        await api('/manufacturing/mrp/policies', {
          method: 'PUT',
          body: {
            ...common,
            method,
            ...(method === 'MAKE' ? { bomId, bomRevisionId } : {}),
            leadDays: Number(leadDays),
            safetyStock: String(safetyStock),
            minimumOrder: String(minimumOrder),
            orderMultiple: String(orderMultiple),
            acknowledgeUnits: acknowledged,
          },
        });
      else
        await api(`/manufacturing/mrp/entries${editing ? `/${editing.id}` : ''}`, {
          method: editing ? 'PUT' : 'POST',
          body: {
            ...common,
            kind,
            quantity: String(quantity),
            dueDate,
            reference,
            isActive,
            ...(receiptId ? { receiptId } : {}),
          },
        });
      editOpen = false;
      await loadSite();
      notice = 'Données enregistrées. Recalculez pour actualiser les propositions.';
    } catch (e) {
      formError = `${problem(e)} En cas de réponse incertaine, fermez et actualisez le poste avant de réessayer.`;
    } finally {
      busy = false;
    }
  }
  function inspect(id: string) {
    selectedItem = id;
    detailOpen = true;
  }
  function parentOf(proposal: MrpProposal, source: string) {
    return selectedRun?.result.proposals.find((p) => p.id === source && p.id !== proposal.id);
  }
</script>

<PageHeader
  title="Besoins matières"
  eyebrow="Fabrication / MRP"
  subtitle="Anticiper ce qu’il faut acheter ou fabriquer, à quelle date et pour quel besoin."
>
  {#snippet actions()}
    <Button variant="secondary" href="/manufacturing/scheduling"
      ><Factory size={15} /> Ordonnancement APS</Button
    >
    <Button
      variant="ghost"
      onclick={loadSite}
      disabled={busy || loading || !locationId}
      aria-label="Actualiser le poste MRP"><RefreshCw size={16} /></Button
    >
  {/snippet}
</PageHeader>

{#if error}<div
    role="alert"
    class="mb-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
  >
    {error}
  </div>{/if}
{#if notice}<p role="status" class="mb-3 text-sm text-ink-muted">{notice}</p>{/if}

<Card>
  <div class="flex flex-wrap items-end gap-3">
    <div class="min-w-52 flex-1">
      <Field label="Entrepôt de planification"
        ><Select bind:value={locationId} onchange={loadSite} disabled={busy || loading}
          ><option value="">Choisir un entrepôt</option
          >{#each options.locations as site (site.id)}<option value={site.id}
              >{site.code} · {site.name}</option
            >{/each}</Select
        ></Field
      >
    </div>
    <div>
      <Field label="Besoins jusqu’au"
        ><Input type="date" bind:value={horizonEnd} disabled={busy} required /></Field
      >
    </div>
    {#if canManage}<Button
        onclick={calculate}
        loading={busy}
        disabled={loading || !locationId || !workspace.policies.length}
        ><Calculator size={16} /> Calculer les besoins</Button
      >{/if}
  </div>
  <p class="mt-3 text-xs leading-5 text-ink-muted">
    Stock WMS actuel de cet entrepôt · dates UTC · délais en jours calendaires. Les propositions ne
    réservent aucun stock et ne créent ni achat ni ordre de fabrication.
  </p>
</Card>

<nav aria-label="Sections MRP" class="my-4 flex flex-wrap gap-1 border-b border-edge pb-2">
  {#each [{ key: 'plan', label: 'Plan matières' }, { key: 'demand', label: 'Demande', count: activeEntries.filter((e) => e.kind === 'DEMAND').length }, { key: 'supply', label: 'Arrivages', count: activeEntries.filter((e) => e.kind === 'SUPPLY').length }, { key: 'policies', label: 'Règles articles', count: workspace.policies.length }, { key: 'history', label: 'Historique' }] as section (section.key)}
    <button
      class="rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent {tab ===
      section.key
        ? 'bg-surface-muted font-medium text-ink'
        : 'text-ink-muted hover:bg-surface-muted'}"
      aria-current={tab === section.key ? 'page' : undefined}
      onclick={() => (tab = section.key)}
      >{section.label}{#if section.count !== undefined}<span class="ml-2 font-mono text-xs"
          >{section.count}</span
        >{/if}</button
    >
  {/each}
</nav>

{#if loading}
  <Card><Skeleton rows={6} /></Card>
{:else if !locationId}
  <Card
    ><h2 class="font-medium text-ink">Un entrepôt pour commencer</h2>
    <p class="mt-2 text-sm text-ink-muted">
      Le calcul utilise les articles et le stock du WMS. Créez votre entrepôt, puis ses articles et
      leurs règles de planification.
    </p>
    <div class="mt-4">
      <Button href="/wms" variant="secondary">Ouvrir l’entrepôt <ArrowRight size={14} /></Button>
    </div></Card
  >
{:else if tab === 'plan'}
  {#if !selectedRun}
    <Card>
      <div class="max-w-2xl py-6">
        <Package size={28} class="mb-4 text-ink-muted" />
        <h2 class="text-lg font-medium text-ink">Préparez votre premier plan matières</h2>
        <p class="mt-2 text-sm leading-6 text-ink-muted">
          Reliez chaque article à une règle Acheter ou Fabriquer. Ajoutez vos besoins datés et les
          arrivages confirmés, puis calculez les manques à chaque niveau de nomenclature.
        </p>
        <ol class="my-5 space-y-3 text-sm text-ink">
          <li>1. Articles WMS et nomenclatures Fabrication</li>
          <li>2. Règles par entrepôt : délais, stock de sécurité, multiples</li>
          <li>3. Demandes et arrivages datés → propositions expliquées</li>
        </ol>
        <div class="flex flex-wrap gap-2">
          {#if canManage}<Button
              onclick={() => {
                tab = 'policies';
                openPolicy();
              }}>Configurer un article</Button
            >{/if}<Button variant="secondary" href="/manufacturing/boms">Nomenclatures</Button
          ><Button variant="ghost" href="/wms/items">Articles WMS</Button>
        </div>
      </div>
    </Card>
  {:else}
    {#if selectedRun.stale}<div
        role="status"
        class="mb-4 flex gap-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm text-ink"
      >
        <TriangleAlert size={18} class="shrink-0 text-warn" />
        <div>
          <strong>Calcul à actualiser</strong>
          <p>{selectedRun.staleReason}</p>
        </div>
      </div>{/if}
    <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {#each [{ label: 'Articles calculés', value: selectedRun.result.items.length }, { label: 'Propositions d’achat', value: selectedRun.result.proposals.filter((p) => p.method === 'BUY').length }, { label: 'Propositions de fabrication', value: selectedRun.result.proposals.filter((p) => p.method === 'MAKE').length }, { label: 'Alertes de délai', value: selectedRun.result.exceptions.length }] as stat (stat.label)}<Card
          ><div class="font-mono text-2xl font-semibold text-ink">{stat.value}</div>
          <div class="mt-1 text-xs text-ink-muted">{stat.label}</div></Card
        >{/each}
    </div>
    <Card>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-medium text-ink">Couverture par article</h2>
          <p class="mt-1 text-xs text-ink-muted">
            Du {selectedRun.result.as_of} au {selectedRun.result.horizon_end} · quantités dans l’unité
            de chaque article
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Input
            bind:value={search}
            placeholder="Rechercher un article…"
            aria-label="Rechercher un article"
          /><Select bind:value={filter} aria-label="Mode d’approvisionnement"
            ><option value="ALL">Tous les articles</option><option value="BUY">Acheter</option
            ><option value="MAKE">Fabriquer</option></Select
          >
        </div>
      </div>
      <div class="space-y-3 sm:hidden">
        {#each rows as row (row.item_id)}
          <button
            class="w-full rounded-lg border border-edge p-3 text-left transition-colors hover:bg-surface-muted"
            aria-label={`Expliquer ${row.sku}`}
            onclick={() => inspect(row.item_id)}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-medium">{row.sku}</span><ChevronRight size={16} />
            </div>
            <p class="mt-1 text-xs text-ink-muted">{row.name} · {row.unit} · N{row.level}</p>
            <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span class="text-ink-muted">Stock</span><span class="mt-1 block font-mono"
                  >{row.on_hand}</span
                >
              </div>
              <div>
                <span class="text-ink-muted">Besoin brut</span><span class="mt-1 block font-mono"
                  >{row.gross_requirement}</span
                >
              </div>
              <div>
                <span class="text-ink-muted">À proposer</span><span
                  class="mt-1 block font-mono font-medium text-accent">{row.planned_receipts}</span
                >
              </div>
            </div>
          </button>
        {/each}
      </div>
      <div class="hidden overflow-x-auto sm:block">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="border-b border-edge text-xs text-ink-muted"
            ><tr
              ><th class="p-3 font-medium">Article / niveau</th><th class="p-3 font-medium">Mode</th
              ><th class="p-3 text-right font-medium">Stock actuel</th><th
                class="p-3 text-right font-medium">Besoins bruts</th
              ><th class="p-3 text-right font-medium">À proposer</th><th
                class="p-3 text-right font-medium">Solde projeté</th
              ><th class="p-3"><span class="sr-only">Détail</span></th></tr
            ></thead
          ><tbody class="divide-y divide-edge"
            >{#each rows as row (row.item_id)}<tr class="hover:bg-surface-muted/60"
                ><td class="p-3"
                  ><button
                    class="text-left font-medium text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                    onclick={() => inspect(row.item_id)}
                    ><span
                      class="mr-2 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                      >N{row.level}</span
                    >{row.sku}<span class="mt-1 block text-xs font-normal text-ink-muted"
                      >{row.name} · {row.unit}</span
                    ></button
                  ></td
                ><td class="p-3 text-ink-muted"
                  >{row.method === 'MAKE' ? 'Fabriquer' : 'Acheter'}</td
                ><td class="p-3 text-right font-mono">{row.on_hand}</td><td
                  class="p-3 text-right font-mono">{row.gross_requirement}</td
                ><td class="p-3 text-right font-mono font-medium text-accent"
                  >{row.planned_receipts}</td
                ><td class="p-3 text-right font-mono">{row.projected_end}</td><td class="p-3"
                  ><Button
                    variant="ghost"
                    onclick={() => inspect(row.item_id)}
                    aria-label={`Expliquer ${row.sku}`}><ChevronRight size={16} /></Button
                  ></td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
      {#if !rows.length}<p class="py-8 text-center text-sm text-ink-muted">
          Aucun article ne correspond à ce filtre.
        </p>{/if}
    </Card>
    {#if selectedRun.result.exceptions.length}<Card
        ><h2 class="mb-3 font-medium text-ink">À arbitrer avant d’exécuter le plan</h2>
        <div class="space-y-2">
          {#each selectedRun.result.exceptions.slice(0, 30) as exception, i (`${exception.source}:${i}`)}<button
              class="flex w-full flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted p-3 text-left text-sm hover:text-accent"
              onclick={() => inspect(exception.item_id)}
              ><span
                >{selectedRun.result.items.find((i) => i.item_id === exception.item_id)?.sku} · {exception.code ===
                'OVERDUE_SUPPLY'
                  ? 'Arrivage en retard, exclu de la couverture'
                  : 'Lancement requis avant aujourd’hui'}</span
              ><span class="font-mono text-xs">{exception.date}</span></button
            >{/each}
        </div>
        {#if selectedRun.result.exceptions.length > 30}<p class="mt-2 text-xs text-ink-muted">
            30 premières alertes affichées. Le détail par article conserve toutes les propositions.
          </p>{/if}</Card
      >{/if}
  {/if}
{:else if tab === 'policies'}
  <Card
    ><div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-medium text-ink">Règles par article et entrepôt</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Les composants des nomenclatures doivent aussi avoir une règle ici.
        </p>
      </div>
      {#if canManage}<Button onclick={() => openPolicy()}><Plus size={16} /> Règle article</Button
        >{/if}
    </div>
    {#if !workspace.policies.length}<p class="py-6 text-sm text-ink-muted">
        Aucun article configuré. Commencez par les matières achetées, puis les sous-ensembles et
        produits finis.
      </p>{/if}
    <div class="divide-y divide-edge">
      {#each workspace.policies as policy (policy.id)}<div
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div>
            <div class="font-medium text-ink">
              {itemById.get(policy.itemId)?.sku ?? 'Article indisponible'} · {itemById.get(
                policy.itemId,
              )?.name}
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              {policy.method === 'BUY' ? 'Acheter' : 'Fabriquer'} · délai {policy.leadDays} j · sécurité
              {policy.safetyStock} · multiple {policy.orderMultiple}
              {itemById.get(policy.itemId)?.unit}
            </p>
          </div>
          {#if canManage}<Button
              variant="ghost"
              onclick={() => openPolicy(policy)}
              aria-label={`Configurer ${itemById.get(policy.itemId)?.sku}`}
              ><SlidersHorizontal size={16} /> Configurer</Button
            >{/if}
        </div>{/each}
    </div>
  </Card>
{:else if tab === 'demand' || tab === 'supply'}
  <Card
    ><div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-medium text-ink">
          {tab === 'demand' ? 'Demande indépendante' : 'Arrivages attendus'}
        </h2>
        <p class="mt-1 max-w-2xl text-sm text-ink-muted">
          {tab === 'demand'
            ? 'Besoins saisis explicitement. Les commandes CRM et les OF ne sont pas importés automatiquement.'
            : 'Saisir uniquement des quantités encore attendues. Rattachez une réception WMS pour éviter de la compter à nouveau après validation.'}
        </p>
      </div>
      {#if canManage}<Button
          onclick={() =>
            openEntry(undefined, tab === 'demand' ? MrpEntryKind.DEMAND : MrpEntryKind.SUPPLY)}
          ><Plus size={16} />
          {tab === 'demand' ? 'Ajouter un besoin' : 'Ajouter un arrivage'}</Button
        >{/if}
    </div>
    {#if !visibleEntries.length}<p class="py-8 text-sm text-ink-muted">
        Aucune entrée pour cet entrepôt.
      </p>{/if}
    <div class="divide-y divide-edge">
      {#each visibleEntries as entry (entry.id)}<div
          class="flex flex-wrap items-center justify-between gap-3 py-3 {entry.isActive
            ? ''
            : 'opacity-60'}"
        >
          <div>
            <div class="text-sm font-medium text-ink">
              {entry.reference}
              {#if !entry.isActive}<span class="text-xs font-normal">· Inactive</span>{/if}
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              {itemById.get(entry.itemId)?.sku ?? 'Article indisponible'} · {entry.quantity}
              {itemById.get(entry.itemId)?.unit} · {date(entry.dueDate)}
              {#if entry.receiptId}· Réception WMS liée{/if}
            </p>
          </div>
          {#if canManage}<Button variant="ghost" onclick={() => openEntry(entry)}>Modifier</Button
            >{/if}
        </div>{/each}
    </div>
  </Card>
{:else if tab === 'history'}
  <Card
    ><h2 class="font-medium text-ink">20 derniers calculs de cet entrepôt</h2>
    <p class="mt-1 text-sm text-ink-muted">
      Chaque calcul conserve ses données d’entrée et son résultat. Il n’est jamais réécrit.
    </p>
    <div class="mt-4 divide-y divide-edge">
      {#each workspace.runs as run (run.id)}<div
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div>
            <p class="text-sm font-medium text-ink">
              {new Date(run.createdAt).toLocaleString('fr-CA')}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              Horizon {date(run.horizonEnd)} · {run.proposalCount} propositions · {run.exceptionCount}
              alertes
            </p>
          </div>
          <Button variant="secondary" onclick={() => openRun(run.id)} disabled={busy}
            >Consulter</Button
          >
        </div>{/each}
    </div>
    {#if !workspace.runs.length}<p class="py-6 text-sm text-ink-muted">
        Aucun calcul enregistré.
      </p>{/if}</Card
  >
{/if}

<Drawer
  bind:open={editOpen}
  title={editMode === 'policy'
    ? 'Règle de planification'
    : kind === 'DEMAND'
      ? 'Besoin daté'
      : 'Arrivage attendu'}
  dismissible={!busy}
>
  <form onsubmit={save} class="space-y-4">
    {#if formError}<p role="alert" class="rounded-md bg-danger/5 p-3 text-sm text-danger">
        {formError}
      </p>{/if}
    <Field label="Article WMS"
      ><Select bind:value={formItem} disabled={busy || Boolean(editing)} required
        ><option value="">Choisir un article</option
        >{#each options.items.filter((i) => editMode !== 'policy' || editing || !workspace.policies.some((p) => p.itemId === i.id)) as item (item.id)}<option
            value={item.id}>{item.sku} · {item.name} ({item.unit})</option
          >{/each}</Select
      ></Field
    >
    {#if editMode === 'policy'}
      <Field label="Mode d’approvisionnement"
        ><Select bind:value={method} disabled={busy}
          ><option value="BUY">Acheter</option><option value="MAKE">Fabriquer</option></Select
        ></Field
      >
      {#if method === 'MAKE'}<Field label="Nomenclature du produit"
          ><Select
            bind:value={bomId}
            disabled={busy}
            required
            onchange={() => {
              bomRevisionId = '';
            }}
            ><option value="">Choisir une nomenclature</option
            >{#each options.boms.filter((b) => b.productRef === itemById.get(formItem)?.sku) as bom (bom.id)}<option
                value={bom.id}>{bom.code} · {bom.name}</option
              >{/each}</Select
          ></Field
        >
        <Field label="Version publiée">
          <Select bind:value={bomRevisionId} disabled={busy} required>
            <option value="">Choisir explicitement une version</option>
            {#each (options.boms.find((b) => b.id === bomId)?.revisions ?? []).filter((r) => r.outputItemId === formItem) as revision (revision.id)}
              <option value={revision.id}
                >Version {revision.revision} · par {revision.outputUnit}</option
              >
            {/each}
            {#if bomRevisionId && !(options.boms.find((b) => b.id === bomId)?.revisions ?? []).some((r) => r.id === bomRevisionId)}<option
                value={bomRevisionId}>Version sélectionnée (historique)</option
              >{/if}
          </Select>
        </Field>
        <p class="text-xs leading-5 text-ink-muted">
          Le calcul utilise cette version, jamais le brouillon ni automatiquement la dernière
          version.
          <a href="/manufacturing/boms" class="text-accent hover:underline"
            >Publier une nomenclature</a
          > si aucune version n’est disponible.
        </p>{/if}
      <Field label="Délai en jours calendaires"
        ><Input
          type="number"
          bind:value={leadDays}
          min={0}
          max={3650}
          step={1}
          required
          disabled={busy}
        /></Field
      >
      <Field label={`Stock de sécurité (${itemById.get(formItem)?.unit ?? 'unité article'})`}
        ><Input
          bind:value={safetyStock}
          pattern={'[0-9]+([.][0-9]{1,3})?'}
          required
          disabled={busy}
        /></Field
      >
      <div class="grid grid-cols-2 gap-3">
        <Field label="Quantité minimum"
          ><Input
            bind:value={minimumOrder}
            pattern={'[0-9]+([.][0-9]{1,3})?'}
            required
            disabled={busy}
          /></Field
        ><Field label="Multiple de commande"
          ><Input
            bind:value={orderMultiple}
            pattern={'[0-9]+([.][0-9]{1,3})?'}
            required
            disabled={busy}
          /></Field
        >
      </div>
      <label
        class="flex items-start gap-2 rounded-md bg-surface-muted p-3 text-sm leading-5 text-ink"
        ><input
          type="checkbox"
          bind:checked={acknowledged}
          required
          disabled={busy}
          class="mt-1"
        />Je confirme les unités WMS et les ratios de nomenclature. Aucune conversion d’unité n’est
        automatique.</label
      >
    {:else}
      <Field label={`Quantité (${itemById.get(formItem)?.unit ?? 'unité article'})`}
        ><Input
          bind:value={quantity}
          pattern={'[0-9]+([.][0-9]{1,3})?'}
          required
          disabled={busy}
        /></Field
      >
      <Field label={kind === 'DEMAND' ? 'Date du besoin (UTC)' : 'Date d’arrivée confirmée (UTC)'}
        ><Input type="date" bind:value={dueDate} required disabled={busy} /></Field
      >
      <Field label="Référence métier"
        ><Input
          bind:value={reference}
          placeholder={kind === 'DEMAND'
            ? 'Commande client, prévision…'
            : 'Confirmation fournisseur…'}
          maxlength={200}
          required
          disabled={busy}
        /></Field
      >
      {#if kind === 'SUPPLY'}<Field label="Réception WMS liée (facultatif)"
          ><Select bind:value={receiptId} disabled={busy}
            ><option value="">Aucune — suivi manuel des quantités reçues</option
            >{#if receiptId && !workspace.receipts.some((r) => r.id === receiptId)}<option
                value={receiptId}>Réception liée hors des 100 dernières</option
              >{/if}{#each workspace.receipts.filter( (r) => r.lines.some((l) => l.itemId === formItem), ) as receipt (receipt.id)}<option
                value={receipt.id}
                >{receipt.number} · {receipt.status === 'POSTED' ? 'Validée' : 'Brouillon'}</option
              >{/each}</Select
          ></Field
        >
        <p class="text-xs leading-5 text-ink-muted">
          Après validation WMS, la quantité reçue est déduite de cet arrivage. Sans lien, réduisez
          la quantité attendue manuellement. Une date dépassée ne couvre jamais un besoin.
        </p>{/if}
      <label class="flex items-center gap-2 text-sm text-ink"
        ><input type="checkbox" bind:checked={isActive} disabled={busy} />Inclure cette entrée dans
        le calcul</label
      >
    {/if}
    <div class="flex justify-end gap-2 border-t border-edge pt-4">
      <Button
        variant="secondary"
        onclick={() => {
          editOpen = false;
        }}
        disabled={busy}>Annuler</Button
      ><Button type="submit" loading={busy}>Enregistrer</Button>
    </div>
  </form>
</Drawer>

<Drawer
  bind:open={detailOpen}
  title={detail ? `${detail.sku} · ${detail.name}` : 'Détail article'}
  width="xl"
>
  {#if detail}
    <div class="mb-5 flex flex-wrap gap-2 text-xs text-ink-muted">
      <span class="rounded bg-surface-muted px-2 py-1">Niveau {detail.level}</span><span
        class="rounded bg-surface-muted px-2 py-1">Unité {detail.unit}</span
      ><span class="rounded bg-surface-muted px-2 py-1"
        >{detail.method === 'MAKE' ? 'Fabriquer' : 'Acheter'}</span
      >
    </div>
    <h3 class="mb-3 font-medium text-ink">Pourquoi ces propositions ?</h3>
    {#if !detailProposals.length}<p class="mb-5 text-sm text-ink-muted">
        Ce besoin est couvert par le stock et les arrivages datés, selon les données de ce calcul.
      </p>{/if}
    <div class="space-y-3">
      {#each detailProposals as proposal (proposal.id)}<div
          class="rounded-lg border border-edge p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong class="text-ink"
              >{proposal.quantity}
              {detail.unit} à {proposal.method === 'MAKE' ? 'fabriquer' : 'acheter'}</strong
            >{#if proposal.expedite}<span class="text-xs font-medium text-warn"
                >Lancement en retard</span
              >{/if}
          </div>
          <p class="mt-2 text-sm text-ink-muted">
            Disponible le {proposal.receipt_date} · lancement le {proposal.release_date}
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            Besoin net {proposal.net_requirement} · seuil de sécurité {proposal.safety_stock} · arrondi
            selon la règle article
          </p>
          <div class="mt-3 border-t border-edge pt-3">
            <h4 class="mb-2 text-xs font-medium text-ink-muted">Besoins à l’origine</h4>
            {#each proposal.reasons as reason, i (`${reason.source}:${i}`)}{@const parent =
                parentOf(proposal, reason.source)}
              <div class="flex flex-wrap justify-between gap-2 py-1 text-sm">
                {#if parent}<button
                    class="text-accent hover:underline"
                    onclick={() => (selectedItem = parent.item_id)}
                    >{reason.reference} <ArrowRight size={12} class="inline" /></button
                  >{:else}<span class="text-ink">{reason.reference}</span>{/if}<span
                  class="font-mono text-xs text-ink-muted">{reason.quantity} · {reason.date}</span
                >
              </div>{/each}{#if !proposal.reasons.length}<p class="text-sm text-ink-muted">
                Reconstitution du stock de sécurité.
              </p>{/if}
          </div>
        </div>{/each}
    </div>
    <h3 class="mb-3 mt-6 font-medium text-ink">Évolution projetée · {detail.unit}</h3>
    <div class="overflow-x-auto">
      <table class="w-full min-w-[520px] text-right text-xs">
        <thead class="border-b border-edge text-ink-muted"
          ><tr
            ><th class="p-2 text-left">Date</th><th class="p-2">Besoin</th><th class="p-2"
              >Arrivage</th
            ><th class="p-2">Proposition</th><th class="p-2">Solde</th></tr
          ></thead
        ><tbody class="divide-y divide-edge font-mono"
          >{#each detail.timeline as point (point.date)}<tr
              ><td class="p-2 text-left">{point.date}</td><td class="p-2">−{point.gross}</td><td
                class="p-2">+{point.scheduled_receipts}</td
              ><td class="p-2 text-accent">+{point.planned_receipts}</td><td class="p-2"
                >{point.projected}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
    <p class="mt-4 text-xs leading-5 text-ink-muted">
      Le solde projeté suppose que toutes les propositions seront réalisées. La capacité réelle, les
      réservations, les consommations de production et les rendements ne sont pas validés par ce
      calcul.
    </p>
    <div class="mt-5 flex flex-wrap gap-2">
      <Button href="/wms/inventory" variant="secondary">Stock WMS</Button><Button
        href="/manufacturing/boms"
        variant="secondary">Nomenclatures</Button
      >
    </div>
  {/if}
</Drawer>
