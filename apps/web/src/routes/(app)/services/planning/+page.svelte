<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import BusinessAssistant from '$lib/components/business/BusinessAssistant.svelte';
  import { serviceLocalDateTime } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Modal,
    Field,
    Input,
    Select,
    EntityPicker,
    ErrorNotice,
    Skeleton,
    EmptyState,
  } from '$lib/components/ui';
  type Job = {
    id: string;
    number: string;
    title: string;
    assigneeUserId: string | null;
    scheduledAt: string | null;
    plannedMinutes: number | null;
    updatedAt: string;
    projectId: string;
    workCenterId: string | null;
  };
  type Board = {
    timeZone: string;
    days: string[];
    truncated: boolean;
    peopleTotal: number;
    unplanned: number;
    people: {
      id: string;
      firstName: string;
      lastName: string;
      team: string | null;
      teamId: string | null;
      hrVerified: boolean;
      absentDays: string[];
    }[];
    jobs: Job[];
  };
  let date = $state(new Date().toISOString().slice(0, 10)),
    days = $state('7'),
    userId = $state(''),
    teamId = $state('');
  let board = $state<Board | null>(null),
    loading = $state(false),
    error = $state('');
  let open = $state(false),
    selected = $state<Job | null>(null),
    saving = $state(false),
    formError = $state('');
  let selectedId = $state(''),
    assigneeId = $state(''),
    localStart = $state(''),
    minutes = $state(60),
    acknowledgeUnknown = $state(false);
  let preview = $state<{ issues: string[]; warnings: string[]; end: string } | null>(null),
    dragged = $state<Job | null>(null);
  let skillIds = $state<string[]>([]),
    skillId = $state(''),
    workCenterId = $state('');
  let requirementNames = $state<Record<string, string>>({}),
    requirementsLoaded = $state(false);
  const hr = $derived($auth?.tenant.enabledModules.includes('hr'));
  const canPlan = $derived(
    $auth?.user.permissions.includes('services.manage') &&
      (!hr || $auth?.user.permissions.includes('hr.availability.read')),
  );
  const canRequirements = $derived(
    canPlan && hr && $auth?.user.permissions.includes('hr.qualifications.read'),
  );
  const canManufacturing = $derived(
    $auth?.tenant.enabledModules.includes('manufacturing') &&
      $auth?.user.permissions.includes('manufacturing.read'),
  );
  let request = 0;
  async function load() {
    const seq = ++request;
    loading = true;
    error = '';
    try {
      const result = await api<Board>('/services/planning', {
        query: { date, days, userId: userId || undefined, teamId: teamId || undefined },
      });
      if (seq === request) board = result;
    } catch (e) {
      if (seq === request) {
        board = null;
        error = (e as Error).message;
      }
    } finally {
      if (seq === request) loading = false;
    }
  }
  $effect(() => {
    date;
    days;
    userId;
    teamId;
    void load();
  });
  let selectionRequest = 0;
  function jobsFor(person: string, day: string) {
    return (
      board?.jobs.filter(
        (j) =>
          j.assigneeUserId === person &&
          j.scheduledAt &&
          serviceLocalDateTime(j.scheduledAt, board!.timeZone).slice(0, 10) <= day &&
          serviceLocalDateTime(
            new Date(
              new Date(j.scheduledAt).getTime() + Math.max(0, (j.plannedMinutes ?? 1) * 60000 - 1),
            ).toISOString(),
            board!.timeZone,
          ).slice(0, 10) >= day,
      ) ?? []
    );
  }
  async function show(id: string, person?: string, day?: string) {
    const seq = ++selectionRequest;
    open = true;
    formError = '';
    selected = null;
    preview = null;
    requirementsLoaded = false;
    acknowledgeUnknown = false;
    try {
      const job = await api<Job>(`/services/jobs/${encodeURIComponent(id)}`);
      if (seq !== selectionRequest || !open) return;
      selected = job;
      selectedId = id;
      assigneeId = person ?? job.assigneeUserId ?? '';
      const local = job.scheduledAt
        ? serviceLocalDateTime(job.scheduledAt, board!.timeZone)
        : `${date}T09:00`;
      localStart = day ? `${day}T${local.slice(11)}` : local;
      minutes = job.plannedMinutes ?? 60;
      if (canRequirements) {
        const r = await api<{
          skillIds: string[];
          workCenterId?: string | null;
          names: Record<string, string>;
        }>(`/services/planning/${id}/requirements`);
        if (seq !== selectionRequest || !open) return;
        skillIds = r.skillIds;
        workCenterId = r.workCenterId ?? '';
        requirementNames = r.names;
        requirementsLoaded = true;
      }
    } catch (e) {
      if (seq === selectionRequest && open) formError = (e as Error).message;
    }
  }
  const body = $derived({
    assigneeUserId: assigneeId,
    localStart,
    plannedMinutes: Number(minutes),
    expectedUpdatedAt: selected?.updatedAt,
    acknowledgeUnknown,
  });
  $effect(() => {
    assigneeId;
    localStart;
    minutes;
    preview = null;
    acknowledgeUnknown = false;
  });
  async function check() {
    if (!selected || saving) return;
    saving = true;
    formError = '';
    try {
      preview = await api(`/services/planning/${selected.id}/check`, { method: 'POST', body });
    } catch (e) {
      formError = (e as Error).message;
    } finally {
      saving = false;
    }
  }
  async function save() {
    if (!selected || saving) return;
    saving = true;
    formError = '';
    try {
      await api(`/services/planning/${selected.id}/schedule`, { method: 'POST', body });
      open = false;
      await load();
    } catch (e) {
      formError = `${(e as Error).message} En cas de réponse incertaine, fermez et rechargez l’intervention avant de recommencer.`;
    } finally {
      saving = false;
    }
  }
  async function saveRequirements() {
    if (!selected || saving || !requirementsLoaded) return;
    saving = true;
    formError = '';
    try {
      await api(`/services/planning/${selected.id}/requirements`, {
        method: 'PUT',
        body: {
          skillIds,
          ...(canManufacturing ? { workCenterId: workCenterId || null } : {}),
          expectedUpdatedAt: selected.updatedAt,
        },
      });
      selected = await api<Job>(`/services/jobs/${selected.id}`);
      preview = null;
    } catch (e) {
      formError = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Planning Services | Pulsar</title></svelte:head>
<PageHeader
  title="Planning des interventions"
  subtitle="Répartir le travail, vérifier les absences et confirmer chaque déplacement."
>
  {#snippet actions()}<Button variant="secondary" href="/services/interventions"
      >Interventions</Button
    ><Button variant="secondary" onclick={load}>Actualiser</Button>{/snippet}
</PageHeader>
<div class="mb-5 flex flex-wrap items-end gap-3">
  <Field label="Début de la période"><Input type="date" bind:value={date} /></Field>
  <Field label="Vue"
    ><Select bind:value={days}
      ><option value="1">Jour</option><option value="7">Semaine</option></Select
    ></Field
  >
  <div class="min-w-56">
    <Field label="Personne">
      <EntityPicker
        label="Personne à afficher"
        endpoint="/services/references/people"
        bind:value={userId}
      />
    </Field>
  </div>
  {#if hr && $auth?.user.permissions.includes('hr.availability.read')}<div class="min-w-48">
      <Field label="Équipe">
        <EntityPicker
          label="Équipe à afficher"
          endpoint="/services/planning/references/teams"
          bind:value={teamId}
        />
      </Field>
    </div>{/if}
  {#if board}<span class="pb-2 text-sm text-ink-muted"
      >{board.timeZone} · {board.unplanned} intervention(s) à compléter</span
    >{/if}
</div>
<ErrorNotice message={error} onretry={load} />
{#if loading}<Skeleton rows={7} />
{:else if board}
  {#if board.truncated}<p class="mb-3 rounded-md bg-warn-soft p-3 text-sm">
      Vue limitée à 100 personnes et 500 interventions. Filtrez une personne avant de conclure sur
      sa charge.
    </p>{/if}
  {#if !board.people.length}<EmptyState
      title="Aucune personne dans cette sélection"
      message="Ajoutez un compte interne actif ou changez le filtre."
    />
  {:else}<div class="overflow-auto rounded-xl border border-edge bg-surface">
      <table class="w-full border-collapse text-sm">
        <thead
          ><tr
            ><th class="min-w-48 border-b border-edge p-3 text-left">Personne / équipe</th
            >{#each board.days as day}<th
                class="min-w-44 border-b border-edge p-3 text-left font-medium">{day}</th
              >{/each}</tr
          ></thead
        >
        <tbody
          >{#each board.people as person}<tr
              ><th class="border-b border-edge p-3 text-left align-top font-medium"
                >{person.firstName}
                {person.lastName}
                <p class="mt-1 text-xs font-normal text-ink-muted">
                  {person.team ?? 'Sans équipe RH'}
                </p>
                {#if !person.hrVerified}<p class="mt-1 text-xs text-warn">
                    RH non vérifié
                  </p>{/if}</th
              >
              {#each board.days as day}<td
                  class={`border-b border-l border-edge p-2 align-top ${person.absentDays.includes(day) ? 'bg-danger-soft/30' : ''}`}
                  ondragover={(e) => {
                    if (canPlan) e.preventDefault();
                  }}
                  ondrop={(e) => {
                    e.preventDefault();
                    if (canPlan && dragged) void show(dragged.id, person.id, day);
                    dragged = null;
                  }}
                >
                  {#if person.absentDays.includes(day)}<p
                      class="mb-2 text-xs font-medium text-danger"
                    >
                      Absence approuvée
                    </p>{/if}
                  {#each jobsFor(person.id, day) as job}<button
                      type="button"
                      draggable={!!canPlan}
                      ondragstart={() => (dragged = job)}
                      ondragend={() => (dragged = null)}
                      onclick={() => void show(job.id)}
                      class="mb-2 block w-full rounded-lg border border-edge bg-surface-muted p-3 text-left transition-colors hover:border-accent focus-visible:outline-accent"
                      ><span class="font-mono text-xs text-accent">{job.number}</span><span
                        class="mt-1 block font-medium">{job.title}</span
                      ><span class="mt-2 block text-xs text-ink-muted"
                        >{serviceLocalDateTime(job.scheduledAt!, board.timeZone).slice(11)} · {job.plannedMinutes
                          ? `${job.plannedMinutes} min`
                          : 'Durée manquante'}</span
                      ></button
                    >{/each}
                </td>{/each}</tr
            >{/each}</tbody
        >
      </table>
    </div>{/if}
  <p class="mt-3 text-xs text-ink-muted">
    Glissez une intervention vers un jour ou une personne pour préparer un déplacement. Le panneau
    demande confirmation et revérifie le créneau. Les postes Fabrication fournissent des exigences;
    ils ne réservent pas la capacité APS.
  </p>
  {#if canPlan}<div class="mt-5 max-w-xl rounded-lg border border-edge p-4">
      <h2 class="mb-3 font-medium">Planifier une intervention existante</h2>
      <EntityPicker
        label="Intervention à planifier"
        endpoint="/services/jobs"
        bind:value={selectedId}
        labelKey="title"
        detailKey="number"
      /><Button variant="secondary" disabled={!selectedId} onclick={() => void show(selectedId)}
        >Ouvrir la planification</Button
      >
    </div>{/if}
{/if}
<Modal bind:open title={selected ? `Planifier ${selected.number}` : 'Planification'} size="lg">
  <ErrorNotice message={formError} />
  {#if selected}<form
      class="grid gap-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p class="text-sm text-ink-muted">{selected.title} · {board?.timeZone}</p>
      <EntityPicker
        label="Intervenant"
        endpoint="/services/references/people"
        bind:value={assigneeId}
      />
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Début dans le fuseau de l’entreprise"
          ><Input type="datetime-local" bind:value={localStart} required /></Field
        ><Field label="Durée prévue (minutes)"
          ><Input type="number" bind:value={minutes} min="1" max="10080" required /></Field
        >
      </div>
      {#if preview}<div class="rounded-lg border border-edge p-3 text-sm" aria-live="polite">
          {#each preview.issues as issue}<p class="text-danger">
              {issue}
            </p>{/each}{#each preview.warnings as warning}<p class="text-warn">
              {warning}
            </p>{/each}{#if !preview.issues.length && !preview.warnings.length}<p>
              Aucun conflit détecté pour ce créneau au moment du contrôle.
            </p>{/if}
        </div>{/if}
      <label class="flex items-start gap-2 text-sm"
        ><input type="checkbox" bind:checked={acknowledgeUnknown} class="mt-1" />Je confirme avoir
        vérifié les contraintes qui restent inconnues (RH absent ou anciennes interventions sans
        durée).</label
      >
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={saving || !canPlan} onclick={check}
          >Vérifier le créneau</Button
        ><Button type="submit" loading={saving} disabled={!canPlan}
          >Confirmer la planification</Button
        ><Button variant="ghost" href={`/services/projects/${selected.projectId}`}
          >Ouvrir le projet</Button
        >
      </div>
    </form>
    <div class="mt-3">
      <BusinessAssistant
        permission="services.read"
        prompt={`Consulte services_get_job pour ${selected.id} et services_planning autour du ${date}. Propose un créneau justifié, puis vérifie-le avec services_check_slot. Cite les sources et les limites. Ne confirme pas de contrainte inconnue; aucun changement sans ma demande explicite.`}
      />
    </div>
    {#if canRequirements && requirementsLoaded}<section class="mt-6 border-t border-edge pt-4">
        <h3 class="mb-3 font-medium">Compétences exigées</h3>
        <EntityPicker
          label="Compétence à ajouter"
          endpoint="/services/planning/references/skills"
          bind:value={skillId}
          onselect={(row) => {
            const id = String(row.id);
            if (!skillIds.includes(id)) skillIds = [...skillIds, id];
            requirementNames[id] = String(row.name);
            skillId = '';
          }}
        />
        <ul class="my-3 space-y-2">
          {#each skillIds as id}<li class="flex items-center justify-between gap-2 text-sm">
              <span>{requirementNames[id] ?? id}</span><Button
                variant="ghost"
                onclick={() => {
                  skillIds = skillIds.filter((s) => s !== id);
                }}>Retirer</Button
              >
            </li>{/each}
        </ul>
        {#if canManufacturing}<EntityPicker
            label="Poste Fabrication de référence"
            endpoint="/manufacturing/work-centers"
            bind:value={workCenterId}
          />{/if}
        <Button variant="secondary" disabled={saving} onclick={saveRequirements}
          >Enregistrer les exigences</Button
        >
      </section>{/if}{/if}
</Modal>
