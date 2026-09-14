<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { CrmDealStage, validateCrmPipelineStages } from '@pulsar/shared';
  import { Button, Field, Input, Select, ErrorNotice } from '$lib/components/ui';
  type Column = { id?: string; name: string; kind: CrmDealStage };
  let {
    pipeline,
    onsaved,
    onclose,
    saving = $bindable(false),
    dirty = $bindable(false),
  }: {
    pipeline: { id: string; name: string; revision: number; stages: Column[] };
    onsaved: () => void;
    onclose: () => void;
    saving?: boolean;
    dirty?: boolean;
  } = $props();
  // The parent keys this editor by pipeline + revision to preserve the edit snapshot.
  let name = $state(untrack(() => pipeline.name));
  let stages = $state<Column[]>(
    untrack(() => pipeline.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))),
  );
  let error = $state('');
  const initialSnapshot = untrack(() => JSON.stringify({ name, stages }));
  $effect(() => {
    dirty = JSON.stringify({ name, stages }) !== initialSnapshot;
  });
  const phases: Record<string, string> = {
    LEAD: 'Prospection',
    QUALIFIED: 'Qualification',
    PROPOSAL: 'Proposition',
    WON: 'Gagné (final)',
    LOST: 'Perdu (final)',
  };
  function move(index: number, delta: number) {
    const copy = [...stages];
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    stages = copy;
  }
  async function save() {
    error = validateCrmPipelineStages(stages) ?? '';
    if (error) return;
    saving = true;
    try {
      await api(`/crm/pipelines/${pipeline.id}`, {
        method: 'PUT',
        body: { name, revision: pipeline.revision, stages },
      });
      onsaved();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<section aria-label="Configuration du pipeline" class="min-w-0">
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
    class="space-y-4"
  >
    <div class="flex items-center justify-between gap-3">
      <p class="text-sm text-ink-muted">Personnalisez les étapes sans quitter votre tableau.</p>
    </div>
    <ErrorNotice message={error} />
    <fieldset disabled={saving} class="min-w-0 space-y-4">
      <Field label="Nom du pipeline"><Input bind:value={name} required maxlength={100} /></Field>
      <p class="max-w-3xl text-sm text-ink-muted">
        L’ordre et les noms sont libres. La phase métier conserve les liens avec les ventes : les
        colonnes gagnées et perdues sont finales. Une colonne occupée ne peut pas être retirée.
      </p>
      <ol class="space-y-2">
        {#each stages as stage, i}
          <li
            class="grid items-end gap-2 rounded-md border border-edge bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_10rem]"
          >
            <Field label={`Nom de la colonne ${i + 1}`}
              ><Input bind:value={stage.name} required maxlength={80} /></Field
            >
            <Field label={`Phase métier ${i + 1}`}
              ><Select bind:value={stage.kind} disabled={!!stage.id}
                >{#each Object.entries(phases) as [value, label]}<option {value}>{label}</option
                  >{/each}</Select
              ></Field
            >
            <div class="flex justify-end gap-1 sm:col-span-2">
              <Button
                variant="ghost"
                aria-label={`Monter ${stage.name}`}
                disabled={i === 0}
                onclick={() => move(i, -1)}>↑</Button
              ><Button
                variant="ghost"
                aria-label={`Descendre ${stage.name}`}
                disabled={i === stages.length - 1}
                onclick={() => move(i, 1)}>↓</Button
              ><Button
                variant="ghost"
                aria-label={`Retirer ${stage.name}`}
                disabled={stages.length <= 3}
                onclick={() => {
                  stages = stages.filter((_, index) => index !== i);
                }}>Retirer</Button
              >
            </div>
          </li>
        {/each}
      </ol>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={stages.length >= 30}
          onclick={() => {
            stages = [...stages, { name: 'Nouvelle étape', kind: CrmDealStage.QUALIFIED }];
          }}>Ajouter une colonne</Button
        ><Button type="submit" loading={saving}>Enregistrer le pipeline</Button>
        <Button variant="ghost" onclick={onclose} disabled={saving}>Annuler</Button>
      </div>
    </fieldset>
  </form>
</section>
