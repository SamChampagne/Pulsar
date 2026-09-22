<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    EntityPicker,
    Field,
    Input,
    Badge,
    Skeleton,
  } from '$lib/components/ui';
  type Skill = { id: string; code: string; name: string; active: boolean };
  type Requirements = {
    id: string;
    name: string;
    isActive: boolean;
    updatedAt: string;
    skillRequirements: { skill: Skill }[];
  };
  type Check = {
    date: string;
    employee: { name: string };
    workCenter: { name: string };
    requirements: (Skill & { covered: boolean })[];
    result: string;
  };
  const enabled = $derived($auth?.tenant.enabledModules.includes('hr'));
  const manage = $derived($auth?.user.permissions.includes('manufacturing.manage'));
  let workCenterId = $state(''),
    employeeId = $state(''),
    date = $state(new Date().toISOString().slice(0, 10)),
    skillId = $state('');
  let requirements = $state<Requirements | null>(null),
    result = $state<Check | null>(null),
    loading = $state(false),
    busy = $state(false),
    error = $state(''),
    refresh = $state(0);
  const labels: Record<string, string> = {
    MET: 'Exigences couvertes',
    MISSING: 'Qualification manquante',
    NO_REQUIREMENTS: 'Aucune exigence définie',
    EMPLOYEE_INACTIVE: 'Employé inactif',
    WORK_CENTER_INACTIVE: 'Poste inactif',
  };
  $effect(() => {
    const id = workCenterId,
      v = refresh;
    let cancelled = false;
    requirements = null;
    result = null;
    error = '';
    if (!id) return;
    loading = true;
    void api<Requirements>(`/manufacturing/qualifications/requirements/${id}`)
      .then((r) => {
        if (!cancelled) requirements = r;
      })
      .catch((e) => {
        if (!cancelled) error = e.message;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    void employeeId;
    void date;
    result = null;
  });
  async function change(ids: string[]) {
    if (!requirements || busy) return;
    busy = true;
    error = '';
    result = null;
    try {
      requirements = await api<Requirements>(
        `/manufacturing/qualifications/requirements/${requirements.id}`,
        { method: 'PUT', body: { skillIds: ids, expectedUpdatedAt: requirements.updatedAt } },
      );
      skillId = '';
    } catch (e) {
      error = (e as Error).message + ' Rechargez les exigences avant une nouvelle action.';
      requirements = null;
    } finally {
      busy = false;
    }
  }
  async function check() {
    if (busy || !requirements) return;
    busy = true;
    error = '';
    result = null;
    const body = { employeeId, workCenterId, date };
    try {
      const checked = await api<Check>('/manufacturing/qualifications/check', {
        method: 'POST',
        body,
      });
      if (
        employeeId === body.employeeId &&
        workCenterId === body.workCenterId &&
        date === body.date
      )
        result = checked;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Qualifications des opérateurs | Pulsar</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-4">
  <PageHeader
    title="Qualifications des opérateurs"
    subtitle="Vérifier les exigences d’un poste, sans exposer les pièces et notes RH."
  />
  {#if !enabled}<p role="alert" class="rounded-lg border border-warn p-4">
      Activez Ressources humaines pour utiliser cette connexion. Le droit hr.qualifications.read est
      également requis.
    </p>{:else}
    <div class="rounded-lg border border-edge bg-surface p-4">
      <EntityPicker
        endpoint="/manufacturing/work-centers"
        label="Poste de charge à contrôler"
        bind:value={workCenterId}
        disabled={busy}
      />
    </div>
    {#if error}<p role="alert" class="text-danger">{error}</p>
      <Button
        variant="secondary"
        onclick={() => {
          refresh++;
        }}>Recharger les exigences</Button
      >{/if}
    {#if loading}<Skeleton rows={4} />{:else if requirements}
      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div>
            <p class="text-xs uppercase text-ink-muted">01 · Exigences du poste</p>
            <h2 class="text-lg font-semibold">{requirements.name}</h2>
          </div>
          {#if !requirements.isActive}<p class="text-warn">
              Poste inactif : aucune couverture opérationnelle.
            </p>{/if}
          {#each requirements.skillRequirements as { skill }}<div
              class="flex items-center justify-between gap-2 border-b border-edge pb-2"
            >
              <div>
                <p>{skill.code} · {skill.name}</p>
                {#if !skill.active}<p class="text-xs text-warn">
                    Référence inactive : remplacez ou retirez cette exigence.
                  </p>{/if}
              </div>
              {#if manage}<Button
                  variant="ghost"
                  disabled={busy || !requirements.isActive}
                  onclick={() =>
                    change(
                      requirements!.skillRequirements
                        .filter((r) => r.skill.id !== skill.id)
                        .map((r) => r.skill.id),
                    )}>Retirer</Button
                >{/if}
            </div>{:else}<p class="text-sm text-ink-muted">
              Aucune exigence configurée. Cela ne prouve pas que l’employé est qualifié.
            </p>{/each}
          {#if manage && requirements.isActive}<EntityPicker
              endpoint="/manufacturing/qualifications/skills"
              label="Compétence exigée"
              bind:value={skillId}
              disabled={busy}
            /><Button
              disabled={busy ||
                !skillId ||
                requirements.skillRequirements.some((r) => r.skill.id === skillId) ||
                requirements.skillRequirements.length >= 30}
              onclick={() =>
                change([...requirements!.skillRequirements.map((r) => r.skill.id), skillId])}
              >Ajouter l’exigence</Button
            >{/if}
        </section>
        <section class="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div>
            <p class="text-xs uppercase text-ink-muted">02 · Vérification ponctuelle</p>
            <h2 class="text-lg font-semibold">Qui peut satisfaire ces exigences ?</h2>
          </div>
          <EntityPicker
            endpoint="/manufacturing/qualifications/people"
            label="Employé à vérifier"
            bind:value={employeeId}
            disabled={busy}
          /><Field label="Date prévue"
            ><Input type="date" required bind:value={date} disabled={busy} /></Field
          ><Button disabled={busy || !employeeId || !date} loading={busy} onclick={check}
            >Vérifier les qualifications</Button
          >
          {#if result}<div class="space-y-3 border-t border-edge pt-4" aria-live="polite">
              <Badge tone={result.result === 'MET' ? 'ok' : 'warn'}
                >{labels[result.result] ?? result.result}</Badge
              >
              <p class="text-sm">{result.employee.name} · {result.date}</p>
              {#each result.requirements as r}<p class="flex justify-between gap-3 text-sm">
                  <span>{r.code} · {r.name}</span><span
                    class={r.covered ? 'text-success' : 'text-warn'}
                    >{r.covered ? 'Couverte' : 'Non couverte'}</span
                  >
                </p>{/each}
              <p class="text-xs text-ink-muted">
                Résultat à la lecture. Une révocation ou modification exige une nouvelle
                vérification.
              </p>
            </div>{/if}
        </section>
      </div>
    {/if}
  {/if}
  <p class="text-sm text-ink-muted">
    Ce contrôle ne vérifie ni présence, ni absence, ni capacité du planning et n’affecte personne à
    une opération. Toutes les exigences doivent être couvertes à la date choisie; une révocation
    actuelle invalide aussi une consultation d’une date passée.
  </p>
</div>
