<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { browserTimeZone } from '@pulsar/shared';
  import { beforeNavigate, goto } from '$app/navigation';
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import TimeWorkspace from './TimeWorkspace.svelte';
  import ServiceAcceptance from './ServiceAcceptance.svelte';
  import CommunicationButton from '$lib/components/communications/CommunicationButton.svelte';
  import PartsWorkspace from './PartsWorkspace.svelte';
  import AvailabilityCheck from './AvailabilityCheck.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    BUSINESS_STATUS_LABELS,
    SERVICE_ACCEPTANCE_LABELS,
    HR_AVAILABILITY_LABELS,
    type HrAvailabilityResult,
    type Paginated,
  } from '@pulsar/shared';
  import {
    Button,
    Drawer,
    Modal,
    Field,
    Input,
    Textarea,
    EntityPicker,
    Select,
    Badge,
    Skeleton,
    EmptyState,
  } from '$lib/components/ui';
  import type { Project, ServiceJob } from './types';
  let { project = undefined, onchanged = () => {} }: { project?: Project; onchanged?: () => void } =
    $props();
  const manage = $derived(
    (($auth?.user.permissions ?? []) as string[]).includes('services.manage'),
  );
  let rows = $state<ServiceJob[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    statusFilter = $state(''),
    assignment = $state(''),
    loading = $state(true),
    error = $state('');
  let open = $state(false),
    editing = $state<ServiceJob | null>(null),
    saving = $state(false),
    formError = $state(''),
    uncertain = $state(false);
  let title = $state(''),
    projectId = $state(''),
    catalogItemId = $state(''),
    instructions = $state(''),
    assigneeLabel = $state(''),
    assigneeUserId = $state(''),
    scheduledAt = $state(''),
    report = $state('');
  let confirm = $state(false),
    nextStatus = $state('');
  let tab = $state<'details' | 'time' | 'parts' | 'acceptance'>('details'),
    timeFormOpen = $state(false),
    timeBusy = $state(false);
  const editable = $derived(!editing || ['PLANNED', 'IN_PROGRESS'].includes(editing.status));
  const dirty = $derived(
    !!editing &&
      (title !== editing.title ||
        instructions !== editing.instructions ||
        assigneeLabel !== editing.assigneeLabel ||
        assigneeUserId !== (editing.assigneeUserId ?? '') ||
        catalogItemId !== (editing.catalogItemId ?? '') ||
        scheduledAt !== (editing.scheduledAt ? toLocal(editing.scheduledAt) : '')),
  );
  let generation = 0;
  let availability = $state<Record<string, HrAvailabilityResult['items'][number]>>({});
  const plannedEntries = $derived(
    rows.flatMap((row) =>
      ['PLANNED', 'IN_PROGRESS'].includes(row.status) && row.assigneeUserId && row.scheduledAt
        ? [{ key: row.id, userId: row.assigneeUserId, scheduledAt: row.scheduledAt }]
        : [],
    ),
  );
  const previewEntries = $derived.by(() => {
    const instant = new Date(scheduledAt);
    if (
      !assigneeUserId ||
      !scheduledAt ||
      !Number.isFinite(instant.getTime()) ||
      toLocal(instant.toISOString()) !== scheduledAt
    )
      return [];
    return [{ key: 'draft', userId: assigneeUserId, scheduledAt: instant.toISOString() }];
  });
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const r = await api<Paginated<ServiceJob>>('/services/jobs', {
        query: {
          page: current,
          pageSize: 20,
          search,
          projectId: project?.id,
          status: statusFilter,
          assignment,
        },
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
  let openedLink = '';
  $effect(() => {
    const id = page.url.searchParams.get('jobId');
    if (id && id !== openedLink) {
      openedLink = id;
      void api<ServiceJob>(`/services/jobs/${encodeURIComponent(id)}`)
        .then((job) => {
          edit(job);
          tab =
            page.url.searchParams.get('section') === 'acceptance'
              ? 'acceptance'
              : page.url.searchParams.get('section') === 'parts'
                ? 'parts'
                : 'time';
        })
        .catch((e) => {
          error = e instanceof Error ? e.message : 'Intervention introuvable.';
        });
    }
  });
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Fermez ce dossier ou enregistrez vos changements avant de quitter.';
    }
  });
  function edit(job: ServiceJob | null) {
    editing = job;
    title = job?.title ?? '';
    projectId = job?.projectId ?? project?.id ?? '';
    catalogItemId = job?.catalogItemId ?? '';
    instructions = job?.instructions ?? '';
    assigneeLabel = job?.assigneeLabel ?? '';
    assigneeUserId = job?.assigneeUserId ?? '';
    scheduledAt = job?.scheduledAt ? toLocal(job.scheduledAt) : '';
    report = job?.report ?? '';
    formError = '';
    uncertain = false;
    open = true;
    tab = 'details';
    timeFormOpen = false;
    timeBusy = false;
  }
  function toLocal(iso: string) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  async function save() {
    if (saving || uncertain) return;
    if (
      scheduledAt &&
      (!Number.isFinite(new Date(scheduledAt).getTime()) ||
        toLocal(new Date(scheduledAt).toISOString()) !== scheduledAt)
    ) {
      formError =
        'Cette heure locale n’existe pas dans votre fuseau. Vérifiez la date et le changement d’heure.';
      return;
    }
    saving = true;
    formError = '';
    try {
      await api('/services/jobs' + (editing ? '/' + editing.id : ''), {
        method: editing ? 'PATCH' : 'POST',
        body: {
          title,
          instructions,
          assigneeLabel,
          assigneeUserId: assigneeUserId || null,
          catalogItemId: catalogItemId || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          ...(editing ? { expectedUpdatedAt: editing.updatedAt } : { projectId }),
        },
      });
      open = false;
      await load();
      onchanged();
    } catch (e) {
      failed(e);
    } finally {
      saving = false;
    }
  }
  function failed(e: unknown) {
    formError = e instanceof Error ? e.message : 'Enregistrement impossible.';
    uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
  }
  async function transition() {
    if (!editing || saving || uncertain) return;
    saving = true;
    formError = '';
    try {
      await api(`/services/jobs/${editing.id}/transition`, {
        method: 'POST',
        body: {
          status: nextStatus,
          expectedUpdatedAt: editing.updatedAt,
          ...(nextStatus === 'COMPLETED' ? { report } : {}),
        },
      });
      confirm = false;
      open = false;
      await load();
      onchanged();
    } catch (e) {
      failed(e);
    } finally {
      saving = false;
    }
  }
  function ask(status: string) {
    nextStatus = status;
    formError = '';
    confirm = true;
  }
  const shown = $derived(rows);
</script>

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
  <div class="flex flex-wrap gap-3">
    <div class="w-64">
      <Input
        aria-label="Rechercher une intervention"
        bind:value={search}
        oninput={() => (current = 1)}
        placeholder="Numéro, titre ou responsable…"
      />
    </div>
    <div class="w-48">
      <Select
        aria-label="État des interventions"
        bind:value={statusFilter}
        onchange={() => {
          current = 1;
        }}
        ><option value="">Tous les états</option
        >{#each ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as s}<option value={s}
            >{BUSINESS_STATUS_LABELS[s]}</option
          >{/each}</Select
      >
    </div>
    <div class="w-48">
      <Select
        aria-label="Affectation"
        bind:value={assignment}
        onchange={() => {
          current = 1;
        }}
        ><option value="">Toute l’équipe</option><option value="mine">Mes interventions</option
        ><option value="unassigned">Sans intervenant</option></Select
      >
    </div>
  </div>
  {#if manage}<Button disabled={!!project && project.status !== 'ACTIVE'} onclick={() => edit(null)}
      >Nouvelle intervention</Button
    >{/if}
</div>
{#if project?.status === 'DRAFT'}<p class="mb-4 rounded-md bg-info-soft p-3 text-sm text-info">
    Activez ce projet pour planifier sa première intervention.
  </p>{/if}
{#if error}<p role="alert" class="mb-4 text-sm text-danger">{error}</p>{/if}
{#if !loading && !error}<div class="mb-4">
    <AvailabilityCheck entries={plannedEntries} summary bind:results={availability} />
  </div>{/if}
{#if loading}<Skeleton rows={4} />{:else if !shown.length}<div
    class="rounded-lg border border-edge bg-surface"
  >
    <EmptyState
      title="Aucune intervention à afficher"
      message="Planifiez le travail sur un projet actif : titre, prestation facultative, équipe responsable et horaire."
    />
  </div>{:else}<div class="space-y-2">
    {#each shown as job}<button
        type="button"
        onclick={() => edit(job)}
        class="grid w-full gap-3 rounded-lg border border-edge bg-surface p-4 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_12rem_9rem]"
        ><div class="min-w-0">
          <span class="font-mono text-xs text-ink-muted">{job.number}</span>
          <h3 class="mt-1 font-medium">{job.title}</h3>
          {#if !project}<p class="mt-1 text-xs text-ink-muted">
              {job.project.number} · {job.project.title}
            </p>{/if}
          {#if job.status === 'COMPLETED' && job.project.acceptanceRequired}<p
              class="mt-2 text-xs"
              class:text-warn={job.acceptanceStatus !== 'ACCEPTED'}
            >
              {SERVICE_ACCEPTANCE_LABELS[job.acceptanceStatus]}
            </p>{/if}
        </div>
        <div class="text-sm">
          <p>
            {job.assignee ? `${job.assignee.firstName} ${job.assignee.lastName}` : 'À attribuer'}
          </p>
          {#if job.assigneeLabel}<p class="text-xs text-ink-muted">{job.assigneeLabel}</p>{/if}
          {#if job.assignee && job.assignee.status !== 'ACTIVE'}<p class="text-xs text-warn">
              Compte inactif · réaffectation à prévoir
            </p>{/if}
          <p class="mt-1 text-xs text-ink-muted">
            {job.scheduledAt ? fmtUserInstant(job.scheduledAt) : 'Horaire à définir'}
          </p>
        </div>
        <div class="sm:text-right">
          {#if availability[job.id]}<p
              class="mb-2 text-xs"
              class:text-warn={availability[job.id].state !== 'NO_APPROVED_ABSENCE'}
              class:text-ink-muted={availability[job.id].state === 'NO_APPROVED_ABSENCE'}
            >
              {HR_AVAILABILITY_LABELS[availability[job.id].state]}
            </p>{/if}
          <Badge
            tone={job.status === 'COMPLETED'
              ? 'ok'
              : job.status === 'IN_PROGRESS'
                ? 'info'
                : 'neutral'}>{BUSINESS_STATUS_LABELS[job.status]}</Badge
          >
        </div></button
      >{/each}
  </div>{/if}
<div class="mt-3 flex items-center justify-end gap-3 text-sm">
  <span class="mr-auto text-ink-muted">{total} intervention(s)</span><Button
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
<Drawer
  bind:open
  title={editing ? `${editing.number} · Intervention` : 'Nouvelle intervention'}
  width="lg"
  dismissible={!saving && !timeBusy && !timeFormOpen}
  onbeforeclose={() => {
    if (editable && manage) {
      formError = 'Utilisez Fermer pour abandonner les changements non enregistrés.';
      return false;
    }
    return true;
  }}
>
  {#if editing}<div
      class="mb-5 flex flex-wrap gap-2 border-b border-edge pb-3"
      aria-label="Sections de l’intervention"
    >
      <Button
        variant={tab === 'details' ? 'secondary' : 'ghost'}
        disabled={timeFormOpen || timeBusy}
        onclick={() => {
          tab = 'details';
        }}>Détails et workflow</Button
      >
      <Button
        variant={tab === 'time' ? 'secondary' : 'ghost'}
        disabled={dirty || saving || timeBusy || timeFormOpen}
        onclick={() => {
          tab = 'time';
        }}>Temps de travail</Button
      >
      <Button
        variant={tab === 'parts' ? 'secondary' : 'ghost'}
        disabled={dirty || saving || timeBusy || timeFormOpen}
        onclick={() => {
          tab = 'parts';
        }}>Pièces et stock</Button
      >
      <Button
        variant={tab === 'acceptance' ? 'secondary' : 'ghost'}
        disabled={dirty || saving || timeBusy || timeFormOpen}
        onclick={() => {
          tab = 'acceptance';
        }}>Acceptation</Button
      >
      <CommunicationButton
        access="services/jobs"
        entityId={editing.id}
        disabled={dirty || saving || timeBusy || timeFormOpen}
      />
    </div>{/if}
  {#if tab === 'acceptance' && editing}
    {#key editing.id}<ServiceAcceptance
        jobId={editing.id}
        bind:busy={timeBusy}
        bind:formOpen={timeFormOpen}
        onchanged={async () => {
          if (editing) editing = await api<ServiceJob>(`/services/jobs/${editing.id}`);
          await load();
          onchanged();
        }}
      />{/key}
    <div class="mt-5 flex justify-end">
      <Button
        variant="secondary"
        disabled={timeBusy || timeFormOpen}
        onclick={() => {
          open = false;
        }}>Fermer</Button
      >
    </div>
  {:else if tab === 'parts' && editing}
    {#key editing.id}<PartsWorkspace
        job={editing}
        onjournal={async () => {
          if (!editing) return;
          const id = editing.id;
          open = false;
          await tick();
          await goto(`/wms/movements?refType=service-job&refId=${encodeURIComponent(id)}`);
        }}
        bind:formOpen={timeFormOpen}
        bind:busy={timeBusy}
        onchanged={async () => {
          if (editing) editing = await api<ServiceJob>(`/services/jobs/${editing.id}`);
          await load();
          onchanged();
        }}
      />{/key}
    <div class="mt-5 flex justify-end">
      <Button
        variant="secondary"
        disabled={timeBusy || timeFormOpen}
        onclick={() => {
          open = false;
        }}>Fermer</Button
      >
    </div>
  {:else if tab === 'time' && editing}
    <TimeWorkspace job={editing} bind:formOpen={timeFormOpen} bind:busy={timeBusy} />
    <div class="mt-5 flex justify-end">
      <Button
        variant="secondary"
        disabled={timeFormOpen || timeBusy}
        onclick={() => {
          open = false;
        }}>Fermer</Button
      >
    </div>
  {:else}
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {#if formError}<p role="alert" class="text-sm text-danger">
          {formError}
        </p>{/if}{#if uncertain}<p class="text-sm text-warn">
          Réponse incertaine. Fermez et vérifiez l’état du dossier avant une nouvelle action.
        </p>{/if}
      {#if editing}<Badge tone={editing.status === 'COMPLETED' ? 'ok' : 'info'}
          >{BUSINESS_STATUS_LABELS[editing.status]}</Badge
        >{/if}
      {#if !project && !editing}<div>
          <p class="mb-1.5 text-xs font-medium text-ink-muted">Projet actif</p>
          <EntityPicker
            endpoint="/services/projects"
            label="Projet actif"
            labelKey="title"
            detailKey="number"
            filters={{ active: 'true' }}
            bind:value={projectId}
          />
        </div>{:else}<p class="text-sm text-ink-muted">
          Projet : {project?.title ?? editing?.project.title}
        </p>{/if}
      <Field label="Titre de l’intervention"
        ><Input
          bind:value={title}
          required
          maxlength={200}
          disabled={!manage || !editable}
        /></Field
      >
      <div>
        <p class="mb-1.5 text-xs font-medium text-ink-muted">Prestation (facultative)</p>
        <EntityPicker
          endpoint="/services/references/items"
          label="Prestation (facultative)"
          bind:value={catalogItemId}
          selectedLabel={catalogItemId === editing?.catalogItemId
            ? (editing?.catalogItem?.name ?? '')
            : ''}
          disabled={!manage || !editable}
        />
      </div>
      <div>
        <p class="mb-1.5 text-xs font-medium text-ink-muted">Intervenant affecté</p>
        <EntityPicker
          endpoint="/services/references/people"
          label="Intervenant affecté"
          bind:value={assigneeUserId}
          selectedLabel={assigneeUserId === editing?.assigneeUserId && editing?.assignee
            ? `${editing.assignee.firstName} ${editing.assignee.lastName}`
            : ''}
          disabled={!manage || !editable}
        />
      </div>
      <Field label="Équipe ou responsable"
        ><Input bind:value={assigneeLabel} maxlength={200} disabled={!manage || !editable} /></Field
      >
      <p class="text-xs text-ink-muted">
        Le libellé complète l’affectation nominative. Celle-ci n’accorde aucun droit et ne réserve
        pas la disponibilité de la personne.
      </p>
      <Field label={`Date et heure prévues · saisie ${browserTimeZone()}`}
        ><Input
          type="datetime-local"
          bind:value={scheduledAt}
          disabled={!manage || !editable}
        /></Field
      >
      {#if open && editable}<AvailabilityCheck entries={previewEntries} />{/if}
      <Field label="Consignes"
        ><Textarea bind:value={instructions} disabled={!manage || !editable} /></Field
      >
      {#if editing?.report}<section class="rounded-md bg-surface-muted p-4">
          <h3 class="mb-2 text-sm font-semibold">Compte rendu</h3>
          <p class="whitespace-pre-wrap text-sm leading-6">{editing.report}</p>
          <p class="mt-2 text-xs text-ink-muted">
            Terminé le {editing.completedAt ? fmtUserInstant(editing.completedAt) : ''}
          </p>
        </section>{/if}
      <div class="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
        <Button
          variant="secondary"
          disabled={saving}
          onclick={() => {
            open = false;
            void load();
          }}>Fermer</Button
        >{#if manage && editable}<Button
            type="submit"
            loading={saving}
            disabled={!title.trim() || !projectId || uncertain}>Enregistrer</Button
          >{/if}
      </div>
      {#if manage && editing && editable}<section class="border-t border-edge pt-4">
          <h3 class="mb-2 text-sm font-semibold">Workflow de l’intervention</h3>
          <p class="mb-3 text-xs text-ink-muted">
            Enregistrez les changements de formulaire avant de passer à l’étape suivante.
          </p>
          <div class="flex flex-wrap gap-2">
            {#if editing.status === 'PLANNED'}<Button
                disabled={saving || uncertain || dirty}
                onclick={() => ask('IN_PROGRESS')}>Démarrer</Button
              >{:else}<Button
                disabled={saving || uncertain || dirty}
                onclick={() => ask('COMPLETED')}>Terminer avec un rapport</Button
              >{/if}<Button
              variant="danger"
              disabled={saving || uncertain || dirty}
              onclick={() => ask('CANCELLED')}>Annuler l’intervention</Button
            >
          </div>
        </section>{/if}
    </form>
  {/if}
</Drawer>
<Modal bind:open={confirm} dismissible={!saving} title="Confirmer le changement d’état"
  ><div class="space-y-4">
    <p class="text-sm">{editing?.number} → {BUSINESS_STATUS_LABELS[nextStatus]}</p>
    {#if nextStatus === 'COMPLETED'}<Field label="Compte rendu obligatoire"
        ><Textarea bind:value={report} /></Field
      >{:else}<p class="text-sm text-ink-muted">
        Cette action modifie l’intervention enregistrée. Elle ne facture rien et ne consomme aucun
        stock.
      </p>{/if}{#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          confirm = false;
        }}>Retour</Button
      ><Button
        loading={saving}
        disabled={uncertain || (nextStatus === 'COMPLETED' && !report.trim())}
        onclick={transition}>Confirmer</Button
      >
    </div>
  </div></Modal
>
