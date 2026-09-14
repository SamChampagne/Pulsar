<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlatformOperations, ServiceObservation } from '@pulsar/shared';
  import { platformApi } from '$lib/api/platform';
  import { Button, Drawer, ErrorNotice, Skeleton, Table } from '$lib/components/ui';
  import ServiceStateBadge from '$lib/components/operations/ServiceStateBadge.svelte';
  let data = $state<PlatformOperations | null>(null);
  let loading = $state(false);
  let error = $state('');
  let autoRefresh = $state(false);
  let selected = $state<ServiceObservation | null>(null);
  let detailOpen = $state(false);
  async function load() {
    if (loading) return;
    loading = true;
    error = '';
    try {
      data = await platformApi<PlatformOperations>('/platform/operations');
    } catch {
      error =
        'Le diagnostic est indisponible. Les mesures précédentes, si présentes, ne sont plus à jour.';
    } finally {
      loading = false;
    }
  }
  const date = (s: string | null) =>
    s ? new Date(s).toLocaleString('fr-CA') : 'Aucune observation';
  onMount(() => {
    void load();
  });
  $effect(() => {
    if (autoRefresh) {
      const id = setInterval(() => {
        if (!document.hidden) void load();
      }, 30_000);
      return () => clearInterval(id);
    }
  });
</script>

<svelte:head><title>Exploitation | Pulsar</title></svelte:head>
<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Centre d’exploitation</h1>
    <p class="mt-1 max-w-2xl text-sm text-ink-muted">
      L’état des services et des traitements, distinct de l’activité métier des entreprises.
    </p>
  </div>
  <div class="flex flex-wrap items-center gap-3">
    <label class="flex items-center gap-2 text-xs text-ink-muted"
      ><input type="checkbox" bind:checked={autoRefresh} />Actualisation 30 s</label
    ><Button variant="secondary" onclick={load} {loading}>Actualiser</Button>
  </div>
</div>
<ErrorNotice message={error} onretry={load} />
{#if !data && loading}<Skeleton rows={8} />{:else if data}
  <section
    aria-label="Environnement"
    class="mb-6 flex flex-wrap gap-x-7 gap-y-2 border-y border-edge py-3 text-xs text-ink-muted"
  >
    <span
      >Environnement <strong class="ml-2 font-mono text-ink">{data.environment.name}</strong></span
    >
    <span>Version <strong class="ml-2 font-mono text-ink">{data.environment.version}</strong></span>
    <span>{data.environment.deployment}</span><span
      >Processus actif : <strong class="font-mono text-ink"
        >{Math.floor(data.environment.uptimeSeconds / 60)} min</strong
      ></span
    >
    <span>Mesuré : <time datetime={data.checkedAt}>{date(data.checkedAt)}</time></span>
  </section>
  {#if data.tenants}
    <section aria-label="Parc d’entreprises" class="mb-7 grid grid-cols-2 gap-4 md:grid-cols-4">
      {#each [{ label: 'Entreprises actives', value: data.tenants.active }, { label: 'Entreprises suspendues', value: data.tenants.suspended }, { label: 'Configurations IA enregistrées', value: data.tenants.runtimeConfigured }, { label: 'Agents enregistrés', value: data.tenants.agents }] as item}
        <div class="border-l-2 border-edge pl-3">
          <div class="font-mono text-2xl font-semibold tabular-nums">{item.value}</div>
          <div class="mt-1 text-xs text-ink-muted">{item.label}</div>
        </div>
      {/each}
    </section>
  {:else}<p class="mb-4 text-sm text-warn">
      Statistiques entreprises indisponibles, aucun zéro de remplacement.
    </p>{/if}
  <section aria-labelledby="services-title" class="mb-8">
    <h2 id="services-title" class="mb-3 text-base font-semibold">Santé fonctionnelle</h2>
    <Table>
      {#snippet head()}<th>Service</th><th>État</th><th>Observation</th><th
          ><span class="sr-only">Diagnostic</span></th
        >{/snippet}
      {#snippet body()}{#each data?.services ?? [] as service (service.key)}<tr
            ><td class="whitespace-nowrap font-medium">{service.label}</td><td
              ><ServiceStateBadge state={service.state} /></td
            ><td class="min-w-64 max-w-xl text-xs leading-5 text-ink-muted">{service.detail}</td><td
              ><Button
                variant="ghost"
                onclick={() => {
                  selected = service;
                  detailOpen = true;
                }}>Diagnostic</Button
              ></td
            ></tr
          >{/each}{/snippet}
    </Table>
  </section>
  <section aria-labelledby="queues-title" class="mb-8">
    <h2 id="queues-title" class="mb-1 text-base font-semibold">Files et traitements</h2>
    <p class="mb-3 text-xs text-ink-muted">
      En attente et échecs conservés, toutes dates. Dernier enregistrement créé, pas dernier passage
      du worker.
    </p>
    {#if !data.queuesAvailable}<p
        role="alert"
        class="rounded border border-warn p-4 text-sm text-warn"
      >
        Les files n’ont pas pu être lues. Leur état est inconnu.
      </p>{:else}
      <Table
        >{#snippet head()}<th>Traitement</th><th>État observé</th><th>En attente</th><th
            >Échecs conservés</th
          ><th>Plus ancien en attente</th><th>Dernier enregistrement</th>{/snippet}
        {#snippet body()}{#each data?.queues ?? [] as queue (queue.key)}<tr
              ><td class="whitespace-nowrap font-medium">{queue.label}</td><td
                ><ServiceStateBadge state={queue.state} /></td
              ><td class="font-mono tabular-nums">{queue.pending}</td><td
                class="font-mono tabular-nums {queue.failed ? 'text-danger' : ''}"
                >{queue.failed}</td
              ><td class="whitespace-nowrap text-xs text-ink-muted"
                >{date(queue.oldestPendingAt)}</td
              ><td class="whitespace-nowrap text-xs text-ink-muted">{date(queue.lastActivityAt)}</td
              ></tr
            >{/each}{/snippet}
      </Table>
    {/if}
  </section>
  <aside class="rounded-inner bg-surface-muted p-4 text-xs leading-6 text-ink-muted">
    <h2 class="font-semibold text-ink">Portée du diagnostic</h2>
    <ul class="list-disc pl-4">
      {#each data.limits as limit}<li>{limit}</li>{/each}
    </ul>
  </aside>
{/if}
<Drawer bind:open={detailOpen} title={selected?.label ?? 'Diagnostic'}>
  {#if selected}<ServiceStateBadge state={selected.state} />
    <p class="mt-4 text-sm leading-6">{selected.detail}</p>
    <h3 class="mt-6 text-sm font-semibold">Prochaine action</h3>
    <p class="mt-2 text-sm leading-6 text-ink-muted">{selected.nextAction}</p>
    <p class="mt-6 text-xs text-ink-muted">Dernière mesure : {date(selected.checkedAt)}</p>{/if}
</Drawer>
