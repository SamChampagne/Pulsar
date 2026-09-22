<script lang="ts">
  import { goto, beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import type { Paginated } from '@pulsar/shared';
  import { BUSINESS_STATUS_LABELS } from '@pulsar/shared';
  import { PageHeader, Button, Input, EmptyState, Skeleton, Badge } from '$lib/components/ui';
  import ProjectForm from '$lib/components/business/ProjectForm.svelte';
  import type { Project } from '$lib/components/business/types';
  let rows = $state<Project[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    loading = $state(true),
    error = $state(''),
    open = $state(false);
  const manage = $derived(
    (($auth?.user.permissions ?? []) as string[]).includes('services.manage'),
  );
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const r = await api<Paginated<Project>>('/services/projects', {
        query: { page: current, pageSize: 20, search },
      });
      if (g === generation) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Chargement impossible.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void load();
  });
  beforeNavigate((n) => {
    if (open) n.cancel();
  });
</script>

<svelte:head><title>Projets | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl">
  <PageHeader
    title="Projets"
    subtitle="Un dossier client, ses interventions et le travail restant à terminer."
    count={total}
    >{#snippet actions()}<Button variant="secondary" href="/services/interventions"
        >Voir les interventions</Button
      >{#if manage}<Button
          onclick={() => {
            open = true;
          }}>Nouveau projet</Button
        >{/if}{/snippet}</PageHeader
  >
  <div class="mb-4 max-w-sm">
    <Input
      aria-label="Rechercher un projet"
      bind:value={search}
      oninput={() => (current = 1)}
      placeholder="Numéro ou titre…"
    />
  </div>
  {#if error}<p role="alert" class="mb-4 text-sm text-danger">{error}</p>{/if}
  {#if loading}<Skeleton rows={5} />{:else if !rows.length}<div
      class="rounded-lg border border-edge bg-surface"
    >
      <EmptyState
        title="Organisez votre premier travail client"
        message="Préparez le client dans Catalogue, créez un projet puis activez-le pour planifier des interventions."
      />
    </div>{:else}<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {#each rows as p}<a
          href={`/services/projects/${p.id}`}
          class="group rounded-lg border border-edge bg-surface p-5 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
          ><div class="mb-3 flex items-center justify-between gap-2">
            <span class="font-mono text-xs text-ink-muted">{p.number}</span><Badge
              tone={p.status === 'ACTIVE' ? 'info' : p.status === 'COMPLETED' ? 'ok' : 'neutral'}
              >{BUSINESS_STATUS_LABELS[p.status]}</Badge
            >
          </div>
          <h2 class="font-semibold group-hover:text-accent">{p.title}</h2>
          <p class="mt-1 text-sm text-ink-muted">{p.partner.name}</p>
          <div
            class="mt-5 flex justify-between gap-2 border-t border-edge pt-3 text-xs text-ink-muted"
          >
            <span>{p._count.jobs} intervention(s)</span><span
              >{p.dueDate ? `Échéance ${p.dueDate.slice(0, 10)}` : 'Sans échéance'}</span
            >
          </div></a
        >{/each}
    </div>{/if}
  <div class="mt-4 flex justify-end items-center gap-3 text-sm">
    <Button
      variant="ghost"
      disabled={current === 1 || loading}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span>{current} / {Math.max(1, Math.ceil(total / 20))}</span><Button
      variant="ghost"
      disabled={current * 20 >= total || loading}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</div>
<ProjectForm bind:open onsaved={(p) => void goto(`/services/projects/${p.id}`)} />
