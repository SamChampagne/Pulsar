<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { Field, Select } from '$lib/components/ui';
  import type { PortalClient } from '../client';
  import type { Template } from '../types';

  let {
    client,
    templates = $bindable<Template[]>([]),
    selectedTemplateId = $bindable(''),
  }: {
    client: PortalClient;
    templates?: Template[];
    selectedTemplateId?: string;
  } = $props();

  async function reload() {
    try {
      templates = await client.get<Template[]>('/templates');
    } catch {
      templates = [];
    }
  }

  async function deleteTemplate(tpl: Template) {
    if (!(await confirmAction('Supprimer ce modèle ?'))) return;
    try {
      await client.del(`/templates/${tpl.id}`);
      await reload();
    } catch {
      // ignore
    }
  }

  $effect(() => {
    void reload();
  });
</script>

{#if templates.length > 0}
  <div class="mb-4">
    <Field label="Utiliser un modèle">
      <Select bind:value={selectedTemplateId}>
        <option value="">— Aucun modèle —</option>
        {#each templates as tpl (tpl.id)}
          <option value={tpl.id}>{tpl.name}</option>
        {/each}
      </Select>
    </Field>
    <!-- Template delete list -->
    <div class="mt-2 flex flex-wrap gap-2">
      {#each templates as tpl (tpl.id)}
        <span
          class="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-ink-muted"
        >
          {tpl.name}
          <button
            type="button"
            class="text-danger hover:text-danger ml-1"
            onclick={() => deleteTemplate(tpl)}
            aria-label="Supprimer {tpl.name}">×</button
          >
        </span>
      {/each}
    </div>
  </div>
{/if}
