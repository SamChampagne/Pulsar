<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { BUSINESS_STATUS_LABELS } from '@pulsar/shared';
  import { PageHeader, Button, Badge, Modal, Skeleton } from '$lib/components/ui';
  import type { Project } from '$lib/components/business/types';
  import ProjectForm from '$lib/components/business/ProjectForm.svelte';
  import JobsWorkspace from '$lib/components/business/JobsWorkspace.svelte';
  import TimeWorkspace from '$lib/components/business/TimeWorkspace.svelte';
  import ServiceBilling from '$lib/components/business/ServiceBilling.svelte';
  let project = $state<Project | null>(null),
    loading = $state(true),
    error = $state(''),
    edit = $state(false),
    confirm = $state(false),
    nextStatus = $state(''),
    saving = $state(false),
    uncertain = $state(false);
  const manage = $derived(
    (($auth?.user.permissions ?? []) as string[]).includes('services.manage'),
  );
  let generation = 0;
  let timeFormOpen = $state(false),
    timeBusy = $state(false);
  async function load() {
    const id = page.params.id,
      g = ++generation;
    if (!untrack(() => project)) loading = true;
    error = '';
    try {
      const p = await api<Project>(`/services/projects/${id}`);
      if (g === generation) {
        project = p;
        uncertain = false;
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
    if (edit || saving) n.cancel();
  });
  function ask(status: string) {
    nextStatus = status;
    error = '';
    confirm = true;
  }
  async function transition() {
    if (!project || saving || uncertain) return;
    saving = true;
    try {
      project = await api<Project>(`/services/projects/${project.id}/transition`, {
        method: 'POST',
        body: { status: nextStatus, expectedUpdatedAt: project.updatedAt },
      });
      confirm = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Action impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{project?.number ?? 'Projet'} | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl">
  <a href="/services" class="mb-4 inline-block text-sm text-accent">← Projets</a>
  {#if loading}<Skeleton rows={5} />{:else if project}<PageHeader
      title={project.title}
      eyebrow={project.number}
      subtitle={project.partner.name}
      >{#snippet actions()}{#if project}<Badge
            tone={project.status === 'ACTIVE'
              ? 'info'
              : project.status === 'COMPLETED'
                ? 'ok'
                : 'neutral'}>{BUSINESS_STATUS_LABELS[project.status]}</Badge
          >{#if manage && ['DRAFT', 'ACTIVE'].includes(project.status)}<Button
              variant="secondary"
              disabled={timeFormOpen || timeBusy}
              onclick={() => {
                edit = true;
              }}>Modifier</Button
            >{#if project.status === 'DRAFT'}<Button
                disabled={timeFormOpen || timeBusy}
                onclick={() => ask('ACTIVE')}>Activer le projet</Button
              >{:else}<Button disabled={timeFormOpen || timeBusy} onclick={() => ask('COMPLETED')}
                >Terminer le projet</Button
              >{/if}<Button
              variant="ghost"
              disabled={timeFormOpen || timeBusy}
              onclick={() => ask('CANCELLED')}>Annuler le projet</Button
            >{/if}{/if}{/snippet}</PageHeader
    >
    <div
      class="mb-6 grid gap-4 rounded-lg border border-edge bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_12rem]"
    >
      <p class="whitespace-pre-wrap text-sm leading-6 text-ink-muted">
        {project.description || 'Aucune description ajoutée.'}
      </p>
      <div class="text-sm">
        <p class="text-xs text-ink-muted">Échéance</p>
        <p class="mt-1 font-medium">{project.dueDate?.slice(0, 10) ?? 'Non définie'}</p>
      </div>
    </div>
    <h2 class="mb-3 text-base font-semibold">Interventions du projet</h2>
    <JobsWorkspace {project} onchanged={() => void load()} />
    <div class="mt-8">
      {#key project.status}<TimeWorkspace
          projectId={project.id}
          bind:formOpen={timeFormOpen}
          bind:busy={timeBusy}
        />{/key}
    </div>
    <ServiceBilling projectId={project.id} />
    <ProjectForm bind:open={edit} {project} onsaved={(p) => (project = p)} />{/if}
  {#if error}<p role="alert" class="my-4 text-sm text-danger">{error}</p>{/if}{#if uncertain}<Button
      variant="secondary"
      onclick={() => void load()}>Vérifier l’état du projet</Button
    >{/if}
</div>
<Modal bind:open={confirm} dismissible={!saving} title="Confirmer le changement du projet"
  ><div class="space-y-4">
    <p class="text-sm">{project?.number} → {BUSINESS_STATUS_LABELS[nextStatus]}</p>
    <p class="text-sm text-ink-muted">
      {nextStatus === 'ACTIVE'
        ? 'Le projet pourra recevoir des interventions.'
        : 'Toutes les interventions doivent être terminées ou annulées. Le projet fermé sera en lecture seule.'}
    </p>
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          confirm = false;
        }}>Retour</Button
      ><Button loading={saving} disabled={uncertain} onclick={transition}>Confirmer</Button>
    </div>
  </div></Modal
>
