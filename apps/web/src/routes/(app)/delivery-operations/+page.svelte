<script lang="ts">
  import { untrack } from 'svelte';
  import type { DeliveryOperationFilter, DeliveryOperationsPage } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Badge,
    Card,
    EmptyState,
    ErrorNotice,
    Field,
    Input,
    Skeleton,
    labelFor,
    toneFor,
  } from '$lib/components/ui';
  import { auth } from '$lib/stores/auth';
  import { requestAssistantDraft } from '$lib/stores/assistant-draft';
  import { formatDateTime } from '$lib/format';

  const filters: { value: DeliveryOperationFilter; label: string; explanation: string }[] = [
    {
      value: 'all',
      label: 'Tous les chargements',
      explanation: 'Dossiers actifs et historiques; aucun filtre implicite de statut.',
    },
    {
      value: 'to_prepare',
      label: 'Contenu à vérifier',
      explanation:
        'Chargements ouverts ou planifiés avec une expédition active sans colis actif déclaré. Le suivi colis reste facultatif; ce filtre ne décrit pas le stock WMS.',
    },
    {
      value: 'to_load',
      label: 'Colis à charger',
      explanation:
        'Tournées planifiées à en transit avec au moins un colis préparé, pas encore chargé physiquement.',
    },
    {
      value: 'in_delivery',
      label: 'En livraison',
      explanation:
        'Chargements en transit, sans présumer l’heure d’arrivée ou la remise des colis.',
    },
    {
      value: 'blocked',
      label: 'Incidents ouverts',
      explanation:
        'Incidents au statut Ouvert. Ce filtre ne prétend pas détecter tous les blocages possibles du logiciel.',
    },
    {
      value: 'retry',
      label: 'Nouvelles tentatives',
      explanation:
        'Incidents avec une nouvelle tentative planifiée, qui reste à exécuter et confirmer.',
    },
    {
      value: 'returns',
      label: 'Retours',
      explanation:
        'Retours autorisés ou physiquement reçus, y compris sur des chargements clôturés. Aucune entrée en stock implicite.',
    },
  ];
  let filter = $state<DeliveryOperationFilter>('all'),
    search = $state(''),
    submittedSearch = $state(''),
    page = $state(1);
  let data = $state<DeliveryOperationsPage | null>(null),
    loading = $state(true),
    error = $state('');
  let generation = 0;
  const pageSize = 20;
  const canRead = $derived(
    ($auth?.tenant.enabledModules.includes('transportation') ?? false) &&
      ($auth?.user.permissions.includes('transportation.planning.read') ?? false),
  );
  const scope = $derived(`${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}`);
  const canAskAgent = $derived(
    canRead && ($auth?.user.permissions.includes('core.agents.chat') ?? false),
  );
  const pages = $derived(Math.max(1, Math.ceil((data?.total ?? 0) / pageSize)));
  const explanation = $derived(filters.find((entry) => entry.value === filter)?.explanation ?? '');
  async function load() {
    const token = ++generation;
    if (!canRead) {
      data = null;
      loading = false;
      return;
    }
    loading = true;
    error = '';
    data = null;
    try {
      const result = await api<DeliveryOperationsPage>('/transportation/delivery-operations', {
        query: { page, pageSize, filter, search: submittedSearch || undefined },
      });
      if (generation === token) data = result;
    } catch (e) {
      if (generation === token)
        error = e instanceof Error ? e.message : 'Lecture des livraisons indisponible.';
    } finally {
      if (generation === token) loading = false;
    }
  }
  $effect(() => {
    void filter;
    void page;
    void submittedSearch;
    void canRead;
    void scope;
    untrack(() => void load());
  });
  function submit(event: SubmitEvent) {
    event.preventDefault();
    page = 1;
    submittedSearch = search.trim();
  }
  function prepareAgentAnalysis() {
    if (!canAskAgent || !$auth || !data || loading || error) return;
    requestAssistantDraft({
      tenantId: $auth.tenant.id,
      userId: $auth.user.id,
      title: 'Exploitation livraison',
      prompt: `Analyse les livraisons de mon entreprise, en lecture d’abord. Utilise list_delivery_operations avec le filtre ${filter}${submittedSearch ? ` et la recherche ${JSON.stringify(submittedSearch)}` : ''}, puis get_delivery_context pour les dossiers qui demandent une vérification. Cite les numéros des chargements et distingue incident ouvert, tentative planifiée, retour autorisé et retour reçu. Les compteurs ne prouvent ni mouvement WMS ni remboursement. Présente une courte liste de priorités avec les données manquantes; ne change aucun statut, n’envoie aucun message et ne propose pas de livraison fictive. Une nouvelle tentative éventuelle passe par plan_delivery_retry et les contrôles d’approbation, uniquement après ma demande explicite.`,
    });
  }
</script>

<svelte:head><title>Exploitation livraison · Pulsar</title></svelte:head>
<PageHeader
  title="Exploitation livraison"
  eyebrow="Transport"
  subtitle="Les tournées et les prochaines vérifications, au même endroit. Ce poste observe les dossiers; les confirmations restent dans chaque tournée."
  count={data?.total}
>
  {#snippet actions()}{#if canAskAgent}<Button
        variant="secondary"
        onclick={prepareAgentAnalysis}
        disabled={loading || !!error || !data}>Analyser avec un agent</Button
      >{/if}<Button variant="secondary" onclick={load} disabled={loading || !canRead}
      >Actualiser</Button
    >{/snippet}
</PageHeader>

{#if !canRead}<ErrorNotice
    message="Transport activé et droit de lecture de la planification requis."
  />
{:else}
  <Card>
    <form
      class="flex flex-wrap items-end gap-3"
      onsubmit={submit}
      aria-label="Filtres de livraison"
    >
      <div class="min-w-0 flex-1 basis-60">
        <Field label="Dossiers à examiner"
          ><select
            class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            bind:value={filter}
            onchange={() => {
              page = 1;
            }}
          >
            {#each filters as entry}<option value={entry.value}>{entry.label}</option>{/each}
          </select></Field
        >
      </div>
      <div class="min-w-0 flex-1 basis-60">
        <Field label="Numéro de chargement"
          ><Input
            bind:value={search}
            maxlength={120}
            placeholder="Rechercher un chargement"
          /></Field
        >
      </div>
      <Button type="submit" variant="secondary" disabled={loading}>Rechercher</Button>
    </form>
    <p class="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">{explanation}</p>
  </Card>
  <section
    aria-label="Dossiers de livraison"
    data-tour="delivery-workspace"
    class="mt-4 space-y-3"
    aria-busy={loading}
  >
    {#if error}<ErrorNotice message={error} />
    {:else if loading}<Card><Skeleton rows={6} /></Card>
    {:else if data}
      <div class="flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
        <p>
          {data.total} chargement{data.total > 1 ? 's' : ''} correspondent au filtre · {data.items
            .length} sur cette page
        </p>
        <p>État lu : {formatDateTime(data.observedAt)}</p>
      </div>
      {#each data.items as row (row.id)}<Card>
          <article aria-label={`Chargement ${row.loadNumber}`}>
            <header class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="font-mono text-sm font-semibold">{row.loadNumber}</h2>
                  <Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge>
                </div>
                <p class="mt-2 text-xs text-ink-muted">
                  {row.shipmentCount} expédition{row.shipmentCount > 1 ? 's' : ''} · {row.packages
                    .total} colis déclarés · Dernière modification {formatDateTime(row.updatedAt)}
                </p>
              </div>
              <a
                href={row.nextAction.href}
                class="inline-flex min-h-9 items-center rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >{row.nextAction.label}</a
              >
            </header>
            <dl
              class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-edge-soft pt-3 text-xs sm:grid-cols-4 lg:grid-cols-6"
            >
              {#each [{ label: 'À charger', value: row.packages.prepared }, { label: 'Dans le camion', value: row.packages.loaded }, { label: 'Livrés', value: row.packages.delivered }, { label: 'Retournés', value: row.packages.returned }, { label: 'Annulés', value: row.packages.cancelled }, { label: 'Sans colis actif', value: row.shipmentsWithoutPackages }] as metric}<div
                >
                  <dt class="text-ink-muted">{metric.label}</dt>
                  <dd class="mt-1 font-mono text-base tabular-nums">{metric.value}</dd>
                </div>{/each}
            </dl>
            {#if row.exceptions.open || row.exceptions.retry || row.exceptions.returnAuthorized || row.exceptions.returnReceived}<div
                class="mt-4 flex flex-wrap gap-2"
                aria-label="Incidents et retours"
              >
                {#if row.exceptions.open}<Badge tone="warn"
                    >{row.exceptions.open} incident{row.exceptions.open > 1 ? 's' : ''} ouvert{row
                      .exceptions.open > 1
                      ? 's'
                      : ''}</Badge
                  >{/if}
                {#if row.exceptions.retry}<Badge tone="info"
                    >{row.exceptions.retry} nouvelle{row.exceptions.retry > 1 ? 's' : ''} tentative{row
                      .exceptions.retry > 1
                      ? 's'
                      : ''}</Badge
                  >{/if}
                {#if row.exceptions.returnAuthorized}<Badge tone="warn"
                    >{row.exceptions.returnAuthorized} retour{row.exceptions.returnAuthorized > 1
                      ? 's'
                      : ''} à recevoir</Badge
                  >{/if}
                {#if row.exceptions.returnReceived}<Badge tone="neutral"
                    >{row.exceptions.returnReceived} retour{row.exceptions.returnReceived > 1
                      ? 's'
                      : ''} reçu{row.exceptions.returnReceived > 1 ? 's' : ''}</Badge
                  >{/if}
              </div>{/if}
            <p class="mt-3 text-xs leading-relaxed text-ink-muted">{row.nextAction.reason}</p>
          </article>
        </Card>{/each}
      {#if !data.items.length}<Card
          ><EmptyState
            title="Aucun dossier dans cette vue"
            message="Changez de filtre ou recherchez un autre numéro. Cette vue n’exécute aucune action automatiquement."
          /></Card
        >{/if}
      {#if data.total > pageSize || page > 1}<nav
          class="flex items-center justify-between gap-2 py-2 text-xs text-ink-muted"
          aria-label="Pages des livraisons"
        >
          <Button
            variant="ghost"
            onclick={() => {
              page--;
            }}
            disabled={page <= 1}>Précédent</Button
          ><span>Page {page} sur {pages}</span><Button
            variant="ghost"
            onclick={() => {
              page++;
            }}
            disabled={page >= pages}>Suivant</Button
          >
        </nav>{/if}
      <p class="text-xs text-ink-muted">
        Les compteurs décrivent des dossiers et des colis, pas des quantités d’articles
        additionnées. Les retours n’ajoutent aucun stock et ne déclenchent aucun remboursement.
      </p>
    {/if}
  </section>
{/if}
