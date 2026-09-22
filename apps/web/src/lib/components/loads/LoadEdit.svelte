<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Modal } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import { auth } from '$lib/stores/auth';
  import type { LoadDetail } from './types';
  let { detail, onreload }: { detail: LoadDetail; onreload: () => Promise<void> } = $props();
  let open = $state(false),
    saving = $state(false),
    error = $state(''),
    notes = $state('');
  let version = '';
  const editable = $derived(['OPEN', 'PLANNED'].includes(detail.status));
  function edit() {
    notes = detail.notes ?? '';
    version = detail.updatedAt;
    error = '';
    open = true;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    saving = true;
    error = '';
    try {
      await api(`/transportation/loads/${detail.id}`, {
        method: 'PATCH',
        body: { notes, expectedUpdatedAt: version },
      });
      toast.success('Chargement mis à jour');
      open = false;
      await onreload();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Enregistrement impossible';
    } finally {
      saving = false;
    }
  }
</script>

{#if $auth?.user.permissions.includes('transportation.planning.manage')}
  <Button variant="secondary" disabled={!editable} onclick={edit}>Modifier le chargement</Button>
{/if}
<Modal bind:open title="Modifier le chargement" dismissible={!saving}>
  <form onsubmit={save} class="space-y-4">
    <p class="text-sm text-ink-muted">
      Le numéro reste fixe. Les ressources, expéditions et arrêts se modifient dans leurs sections,
      tant que le chargement est ouvert ou planifié.
    </p>
    {#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
    <Field label="Notes opérationnelles"
      ><textarea
        bind:value={notes}
        maxlength="5000"
        rows="5"
        class="w-full rounded-md border border-edge bg-surface p-3 text-sm"
      ></textarea></Field
    >
    <div class="flex flex-wrap gap-3 text-sm">
      <a
        href="#record-resources"
        class="text-accent underline"
        onclick={() => {
          open = false;
        }}>Modifier les ressources</a
      >
      <a
        href="#record-route"
        class="text-accent underline"
        onclick={() => {
          open = false;
        }}>Modifier la tournée</a
      >
      <a
        href="#record-shipments"
        class="text-accent underline"
        onclick={() => {
          open = false;
        }}>Voir les expéditions</a
      >
    </div>
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          open = false;
        }}>Annuler</Button
      ><Button type="submit" loading={saving}>Enregistrer les notes</Button>
    </div>
  </form>
</Modal>
