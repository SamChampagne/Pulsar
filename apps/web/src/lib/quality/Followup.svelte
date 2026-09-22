<script lang="ts">
  import { api } from '$lib/api/client';
  import { Button, Field, Input, EntityPicker } from '$lib/components/ui';
  import type { Nonconformity } from './types';
  let {
    row,
    disabled,
    manage,
    dirty = $bindable(false),
    busy = $bindable(false),
    onupdated,
  }: {
    row: Nonconformity;
    disabled: boolean;
    manage: boolean;
    dirty?: boolean;
    busy?: boolean;
    onupdated: (row: Nonconformity) => void;
  } = $props();
  let assignee = $state(''),
    dueDate = $state(''),
    error = $state(''),
    uncertain = $state(false);
  $effect(() => {
    assignee = row.assigneeUserId ?? '';
    dueDate = row.dueDate?.slice(0, 10) ?? '';
    uncertain = false;
  });
  $effect(() => {
    dirty =
      assignee !== (row.assigneeUserId ?? '') || dueDate !== (row.dueDate?.slice(0, 10) ?? '');
  });
  async function save() {
    if (busy || disabled || uncertain) return;
    busy = true;
    error = '';
    try {
      onupdated(
        await api<Nonconformity>(`/quality/nonconformities/${row.id}/assignment`, {
          method: 'PATCH',
          body: {
            assigneeUserId: assignee || null,
            dueDate: dueDate || null,
            expectedUpdatedAt: row.updatedAt,
          },
        }),
      );
    } catch (e) {
      error = `${(e as Error).message} Rechargez le dossier avant une nouvelle modification.`;
      uncertain = true;
    } finally {
      busy = false;
    }
  }
</script>

<section
  class="mb-4 space-y-4 rounded-lg border border-edge bg-surface p-5"
  aria-label="Responsable et échéance"
>
  <h2 class="font-semibold">Organiser le suivi</h2>
  <div class="grid gap-4 md:grid-cols-2">
    <EntityPicker
      label="Responsable"
      endpoint="/quality/people"
      bind:value={assignee}
      selectedLabel={row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}` : ''}
      disabled={disabled || busy || uncertain || !manage || row.status === 'CLOSED'}
    />
    <Field label="Échéance"
      ><Input
        type="date"
        bind:value={dueDate}
        min="1900-01-01"
        max="2199-12-31"
        disabled={disabled || busy || uncertain || !manage || row.status === 'CLOSED'}
      /></Field
    >
  </div>
  <p class="text-xs text-ink-muted">
    Responsable = compte utilisateur interne actif. Cette affectation ne crée ni notification
    automatique ni disponibilité RH. Les échéances sont des dates civiles, comparées au jour UTC.
  </p>
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  {#if manage && row.status !== 'CLOSED'}<Button
      onclick={save}
      loading={busy}
      disabled={disabled || !dirty || uncertain}>Enregistrer le suivi</Button
    >{/if}
</section>
