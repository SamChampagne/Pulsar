<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Badge,
    Field,
    Input,
    Select,
    Skeleton,
    ErrorNotice,
  } from '$lib/components/ui';
  import {
    CrmDealStage,
    isDealOpen,
    PERMISSIONS,
    type CrmSequenceStep,
    type Paginated,
  } from '@pulsar/shared';
  import PipelineEditor from '$lib/components/crm/PipelineEditor.svelte';
  import StageAutomation from '$lib/components/crm/StageAutomation.svelte';
  type Stage = { id: string; name: string; kind: CrmDealStage };
  type Pipeline = { id: string; name: string; revision: number; stages: Stage[] };
  type Deal = {
    id: string;
    title: string;
    companyName: string;
    amount: string | number | null;
    currency: string;
    ownerName: string | null;
    primaryContactId: string | null;
    stageRevision: number;
    ageDays: number;
    stale: boolean;
  };
  type Column = {
    id: string;
    name: string;
    stage: CrmDealStage;
    deals: Deal[];
    automation: {
      id: string;
      enabled: boolean;
      mode: string;
      agentId: string | null;
      steps: CrmSequenceStep[];
    } | null;
  };
  let pipelines = $state<Pipeline[]>([]),
    selected = $state(''),
    columns = $state<Column[]>([]);
  let loading = $state(true),
    busy = $state(false),
    error = $state(''),
    notice = $state(''),
    configuring = $state(false),
    actionStage = $state('');
  let creatingPipeline = $state(false),
    pipelineName = $state('');
  let createStage = $state(''),
    dealTitle = $state(''),
    companyId = $state(''),
    companySearch = $state('');
  let companies = $state<{ id: string; name: string }[]>([]),
    companyTotal = $state(0);
  let dragging = $state<{ id: string; from: string; revision: number } | null>(null),
    target = $state('');
  const pipeline = $derived(pipelines.find((p) => p.id === selected));
  const activeStage = $derived(columns.find((c) => c.id === actionStage));
  const manage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.CRM.MANAGE));
  const count = $derived(columns.reduce((sum, c) => sum + c.deals.length, 0));
  let requestId = 0;
  async function load(id?: string) {
    const request = ++requestId;
    loading = true;
    error = '';
    try {
      const list = await api<Pipeline[]>('/crm/pipelines');
      const chosen = id || list[0]?.id;
      const board = await api<Column[]>('/crm/pipeline', { query: { pipelineId: chosen } });
      if (request !== requestId) return;
      pipelines = list;
      selected = chosen;
      columns = board;
    } catch (e) {
      if (request === requestId) error = (e as Error).message;
    } finally {
      if (request === requestId) loading = false;
    }
  }
  $effect(() => {
    const id = page.url.searchParams.get('pipelineId') ?? '';
    untrack(() => void load(id));
  });
  async function choose(id: string) {
    configuring = false;
    actionStage = '';
    createStage = '';
    notice = '';
    await goto('/crm/pipeline?pipelineId=' + encodeURIComponent(id), {
      noScroll: true,
      keepFocus: true,
    });
  }
  async function createPipeline() {
    busy = true;
    error = '';
    try {
      const item = await api<Pipeline>('/crm/pipelines', {
        method: 'POST',
        body: { name: pipelineName },
      });
      creatingPipeline = false;
      pipelineName = '';
      await choose(item.id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function moveDeal(deal: Deal, from: string, to: string) {
    if (busy || from === to) return;
    busy = true;
    error = '';
    dragging = null;
    target = '';
    try {
      await api('/crm/deals/' + deal.id + '/advance', {
        method: 'POST',
        body: { pipelineStageId: to, expectedRevision: deal.stageRevision },
      });
      notice = 'Opportunité déplacée. Les relances de l’ancienne étape sont arrêtées.';
      await load(selected);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  function drop(event: DragEvent, column: Column) {
    event.preventDefault();
    if (!dragging) return;
    const source = columns.find((c) => c.id === dragging?.from);
    const deal = source?.deals.find((d) => d.id === dragging?.id);
    if (source && deal) void moveDeal(deal, source.id, column.id);
  }
  function totals(column: Column) {
    const sums = new Map<string, number>();
    for (const deal of column.deals)
      if (deal.amount != null)
        sums.set(deal.currency, (sums.get(deal.currency) ?? 0) + Number(deal.amount));
    return [...sums].map(([currency, amount]) => money(amount, currency)).join(' · ');
  }
  function money(amount: string | number | null, currency: string) {
    if (amount == null) return '—';
    try {
      return new Intl.NumberFormat('fr-CA', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Number(amount));
    } catch {
      return String(amount) + ' ' + currency;
    }
  }
  async function findCompanies() {
    try {
      const result = await api<Paginated<{ id: string; name: string }>>('/crm/companies', {
        query: { search: companySearch, pageSize: 100 },
      });
      companies = result.items;
      companyTotal = result.total;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function quickCreate() {
    busy = true;
    error = '';
    try {
      const deal = await api<{ id: string }>('/crm/deals', {
        method: 'POST',
        body: { title: dealTitle, companyId, pipelineId: selected, pipelineStageId: createStage },
      });
      await goto('/crm/deals/' + deal.id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Pipeline CRM · Pulsar</title></svelte:head>
<PageHeader
  title="Pipeline CRM"
  eyebrow="Ventes"
  subtitle="Faites avancer les opportunités. Chaque colonne porte ses propres actions de suivi."
>
  {#snippet actions()}<Button href="/connect" variant="secondary">Connexions</Button
    >{#if manage}<Button
        variant="secondary"
        onclick={() => {
          configuring = !configuring;
          actionStage = '';
        }}>Configurer les colonnes</Button
      ><Button
        onclick={() => {
          creatingPipeline = !creatingPipeline;
        }}>Nouveau pipeline</Button
      >{/if}{/snippet}
</PageHeader>
<ErrorNotice message={error} />
{#if notice}<p role="status" class="mb-4 rounded-md bg-surface-muted p-3 text-sm">{notice}</p>{/if}
<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div class="w-full max-w-xs">
    <Field label="Pipeline actif"
      ><Select
        value={selected}
        onchange={(e) => void choose(e.currentTarget.value)}
        disabled={loading || busy}
        >{#each pipelines as p}<option value={p.id}>{p.name}</option>{/each}</Select
      ></Field
    >
  </div>
  <div class="flex items-center gap-4 text-sm text-ink-muted">
    <span class="tabular-nums">{count} opportunités · {columns.length} colonnes</span><Button
      variant="ghost"
      disabled={loading || busy}
      onclick={() => void load(selected)}>Actualiser</Button
    >
  </div>
</div>
{#if creatingPipeline}
  <form
    class="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-edge bg-surface p-4"
    onsubmit={(e) => {
      e.preventDefault();
      void createPipeline();
    }}
  >
    <Field label="Nom du nouveau pipeline"
      ><Input
        bind:value={pipelineName}
        required
        maxlength={100}
        placeholder="Ventes services, partenariats…"
      /></Field
    ><Button type="submit" disabled={busy}>Créer le pipeline</Button><Button
      variant="ghost"
      onclick={() => {
        creatingPipeline = false;
      }}>Annuler</Button
    >
  </form>
{/if}
{#if configuring && pipeline && manage}{#key pipeline.id + ':' + pipeline.revision}<PipelineEditor
      {pipeline}
      onclose={() => (configuring = false)}
      onsaved={() => {
        configuring = false;
        notice = 'Pipeline enregistré';
        void load(selected);
      }}
    />{/key}{/if}
{#if activeStage}{#key activeStage.id + JSON.stringify(activeStage.automation)}<StageAutomation
      stage={activeStage}
      onclose={() => (actionStage = '')}
      onsaved={() => {
        notice = 'Actions de la colonne enregistrées';
        void load(selected);
      }}
    />{/key}{/if}
{#if createStage}
  <form
    class="mb-5 space-y-3 rounded-lg border border-edge bg-surface p-4"
    onsubmit={(e) => {
      e.preventDefault();
      void quickCreate();
    }}
  >
    <h2 class="font-semibold">
      Nouvelle opportunité · {columns.find((c) => c.id === createStage)?.name}
    </h2>
    <div class="grid gap-3 md:grid-cols-2">
      <Field label="Titre de l’opportunité"><Input bind:value={dealTitle} required /></Field><Field
        label="Entreprise CRM"
        ><Select bind:value={companyId} required
          ><option value="">Choisir une entreprise</option>{#each companies as company}<option
              value={company.id}>{company.name}</option
            >{/each}</Select
        ></Field
      >
    </div>
    <div class="flex flex-wrap items-end gap-2">
      <Field label="Rechercher une entreprise"><Input bind:value={companySearch} /></Field><Button
        variant="secondary"
        onclick={findCompanies}>Rechercher</Button
      >{#if companyTotal > 100}<span class="text-xs text-ink-muted"
          >100 sur {companyTotal} : affinez la recherche.</span
        >{/if}
    </div>
    <p class="text-sm text-ink-muted">
      Vous choisirez le contact principal sur la fiche. Aucun suivi ne démarre sans destinataire à
      l’entrée dans une colonne.
    </p>
    <Button type="submit" disabled={busy}>Créer l’opportunité</Button><Button
      variant="ghost"
      onclick={() => {
        createStage = '';
      }}>Annuler</Button
    >
  </form>
{/if}
{#if loading && !columns.length}<Skeleton rows={6} />{:else}
  <div class="max-w-full overflow-x-auto pb-4" aria-label="Tableau des opportunités">
    <div class="flex w-max min-w-full items-start gap-3">
      {#each columns as col (col.id)}
        {@const open = isDealOpen(col.stage)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <section
          aria-label={'Colonne ' + col.name}
          class="flex w-[18rem] shrink-0 flex-col rounded-lg border border-edge bg-surface-muted/50"
          class:ring-2={target === col.id}
          class:ring-accent={target === col.id}
          ondragover={(e) => {
            if (dragging && dragging.from !== col.id && !busy) {
              e.preventDefault();
              target = col.id;
            }
          }}
          ondragleave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) target = '';
          }}
          ondrop={(e) => drop(e, col)}
        >
          <header class="border-b border-edge p-3">
            <div class="flex items-center justify-between gap-2">
              <h2 class="truncate font-semibold">{col.name}</h2>
              <Badge tone={col.stage === 'WON' ? 'ok' : col.stage === 'LOST' ? 'danger' : 'neutral'}
                >{col.deals.length}</Badge
              >
            </div>
            <p class="mt-1 min-h-4 text-xs tabular-nums text-ink-muted">
              {totals(col) || 'Aucun montant'}
            </p>
            <button
              class="mt-3 w-full rounded-md border border-edge bg-surface px-2 py-2 text-left text-xs transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={'Automatisations de ' + col.name}
              aria-expanded={actionStage === col.id}
              onclick={() => {
                actionStage = actionStage === col.id ? '' : col.id;
                configuring = false;
              }}
            >
              {#if col.automation?.enabled}{col.automation.steps.length} action(s) · {col.automation
                  .mode === 'SIMULATION'
                  ? 'Simulation'
                  : 'Gouverné'}{:else if col.automation}Actions désactivées{:else}Configurer les
                actions de cette étape{/if}
            </button>
          </header>
          <div class="min-h-24 space-y-2 p-2">
            {#each col.deals as deal (deal.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <article
                draggable={manage && open && !busy}
                ondragstart={(e) => {
                  dragging = { id: deal.id, from: col.id, revision: deal.stageRevision };
                  e.dataTransfer?.setData('text/plain', deal.id);
                }}
                ondragend={() => {
                  dragging = null;
                  target = '';
                }}
                class="rounded-md border border-edge bg-surface p-3"
                class:opacity-40={dragging?.id === deal.id}
              >
                <a
                  href={'/crm/deals/' + deal.id}
                  class="block font-semibold text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >{deal.title}</a
                >
                <p class="mt-1 truncate text-xs text-ink-muted">{deal.companyName}</p>
                <div class="mt-3 flex justify-between gap-2 text-xs">
                  <span class="font-medium tabular-nums">{money(deal.amount, deal.currency)}</span
                  ><span class="text-ink-muted"
                    >{deal.ageDays} j {deal.stale ? '· Sans activité' : ''}</span
                  >
                </div>
                <p class="mt-2 text-xs text-ink-muted">
                  {deal.ownerName || 'Non attribué'}{!deal.primaryContactId
                    ? ' · Contact à choisir'
                    : ''}
                </p>
                {#if manage && open}<div class="mt-3">
                    <Select
                      aria-label={'Déplacer ' + deal.title}
                      value={col.id}
                      disabled={busy}
                      onchange={(e) => void moveDeal(deal, col.id, e.currentTarget.value)}
                      >{#each columns as destination}<option value={destination.id}
                          >{destination.name}</option
                        >{/each}</Select
                    >
                  </div>{/if}
              </article>
            {:else}<p class="py-6 text-center text-xs text-ink-muted">Aucune opportunité</p>{/each}
            {#if manage && open}<Button
                variant="ghost"
                class="w-full"
                onclick={() => {
                  createStage = col.id;
                  dealTitle = '';
                  companyId = '';
                  void findCompanies();
                }}>Ajouter une opportunité</Button
              >{/if}
          </div>
        </section>
      {/each}
    </div>
  </div>
{/if}
