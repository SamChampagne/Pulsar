<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { enterNext } from '$lib/forms/enter-next';
  import { Button, Field, Input, Modal, Select } from '$lib/components/ui';
  let {
    open = $bindable(false),
    locationId,
    oncreated,
  }: {
    open?: boolean;
    locationId: string;
    oncreated: (bin: { id: string; code: string }) => void;
  } = $props();
  let code = $state(''),
    zone = $state(''),
    kind = $state('STORAGE'),
    error = $state(''),
    saving = $state(false);
  $effect(() => {
    if (open) {
      code = '';
      zone = '';
      kind = 'STORAGE';
      error = '';
    }
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !locationId) return;
    saving = true;
    error = '';
    try {
      const bin = await api<{ id: string; code: string }>('/wms/bins', {
        method: 'POST',
        body: { locationId, code: code.trim(), zone: zone.trim() || null, kind },
      });
      open = false;
      oncreated(bin);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Création impossible';
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:open title="Nouvel emplacement de destination" dismissible={!saving}>
  <form onsubmit={save} use:enterNext class="space-y-3">
    <p class="text-sm text-ink-muted">
      L’emplacement sera créé dans l’entrepôt de la source. Aucun stock n’est déplacé à cette étape.
    </p>
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
    <Field label="Code"
      ><Input bind:value={code} required maxlength={80} placeholder="A-01-01" /></Field
    >
    <Field label="Zone"
      ><Input bind:value={zone} maxlength={80} placeholder="Matières premières" /></Field
    >
    <Field label="Type"
      ><Select bind:value={kind}
        ><option value="STORAGE">Stockage</option><option value="RECEIVING">Réception</option
        ><option value="SHIPPING">Expédition</option></Select
      ></Field
    >
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          open = false;
        }}>Annuler</Button
      ><Button type="submit" loading={saving}>Créer et sélectionner</Button>
    </div>
  </form>
</Modal>
