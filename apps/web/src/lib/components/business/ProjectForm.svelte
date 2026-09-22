<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Drawer, Button, Field, Input, Textarea, EntityPicker } from '$lib/components/ui';
  import type { Project } from './types';
  let {
    open = $bindable(false),
    project = null,
    onsaved,
  }: { open?: boolean; project?: Project | null; onsaved: (p: Project) => void } = $props();
  let title = $state(''),
    description = $state(''),
    partnerId = $state(''),
    dueDate = $state(''),
    saving = $state(false),
    error = $state(''),
    uncertain = $state(false);
  $effect(() => {
    if (open) {
      title = project?.title ?? '';
      description = project?.description ?? '';
      partnerId = project?.partnerId ?? '';
      dueDate = project?.dueDate?.slice(0, 10) ?? '';
      error = '';
      uncertain = false;
    }
  });
  async function save() {
    if (saving || uncertain) return;
    saving = true;
    error = '';
    try {
      const p = await api<Project>('/services/projects' + (project ? '/' + project.id : ''), {
        method: project ? 'PATCH' : 'POST',
        body: {
          title,
          description,
          partnerId,
          dueDate: dueDate || null,
          ...(project ? { expectedUpdatedAt: project.updatedAt } : {}),
        },
      });
      open = false;
      onsaved(p);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Échec de sauvegarde.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      saving = false;
    }
  }
</script>

<Drawer
  bind:open
  title={project ? 'Modifier le projet' : 'Nouveau projet'}
  dismissible={!saving}
  onbeforeclose={() => {
    error = 'Utilisez Annuler pour abandonner la saisie.';
    return false;
  }}
>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}{#if uncertain}<p
        class="text-sm text-warn"
      >
        Réponse incertaine. Fermez puis rechargez la liste avant de réessayer.
      </p>{/if}
    <Field label="Titre du projet"><Input bind:value={title} required maxlength={200} /></Field>
    <div>
      <p class="mb-1.5 text-xs font-medium text-ink-muted">Client</p>
      <EntityPicker
        endpoint="/services/references/customers"
        label="Client"
        bind:value={partnerId}
        selectedLabel={project?.partner.name ?? ''}
      />
    </div>
    <p class="text-xs leading-5 text-ink-muted">
      Clients actifs du Catalogue commun. Si la liste est vide, demandez à un gestionnaire du
      Catalogue de créer la fiche.
    </p>
    <Field label="Échéance"><Input type="date" bind:value={dueDate} /></Field><Field
      label="Description du travail"><Textarea bind:value={description} /></Field
    >
    <div class="flex justify-end gap-2 border-t border-edge pt-4">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          open = false;
        }}>Annuler</Button
      ><Button type="submit" loading={saving} disabled={!title.trim() || !partnerId || uncertain}
        >Enregistrer</Button
      >
    </div>
  </form>
</Drawer>
