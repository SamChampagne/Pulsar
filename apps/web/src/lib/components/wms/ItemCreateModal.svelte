<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { WMS_UNITS } from '@pulsar/shared';
  import { enterNext } from '$lib/forms/enter-next';
  import { Button, Field, Input, Modal, ReferenceSelect } from '$lib/components/ui';
  let {
    open = $bindable(false),
    oncreated,
  }: {
    open?: boolean;
    oncreated: (item: { id: string; sku: string; name: string; unit: string }) => void;
  } = $props();
  let sku = $state(''),
    name = $state(''),
    unit = $state('EA'),
    barcode = $state(''),
    error = $state(''),
    saving = $state(false);
  const units = WMS_UNITS.map((u) => ({ value: u.code, label: u.name }));
  $effect(() => {
    if (open) {
      sku = '';
      name = '';
      unit = 'EA';
      barcode = '';
      error = '';
    }
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    saving = true;
    error = '';
    try {
      const item = await api<{ id: string; sku: string; name: string; unit: string }>(
        '/wms/items',
        {
          method: 'POST',
          body: { sku: sku.trim(), name: name.trim(), unit, barcode: barcode.trim() || undefined },
        },
      );
      open = false;
      oncreated(item);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Création impossible';
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:open title="Nouvel article d’inventaire" dismissible={!saving}>
  <form onsubmit={save} use:enterNext class="space-y-3">
    <p class="text-sm text-ink-muted">
      Cet article sera disponible en fabrication et dans l’inventaire. Aucun stock n’est créé.
    </p>
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
    <Field label="SKU"><Input bind:value={sku} required maxlength={80} /></Field>
    <Field label="Nom"><Input bind:value={name} required maxlength={200} /></Field>
    <Field label="Unité"><ReferenceSelect options={units} bind:value={unit} /></Field>
    <Field label="Code-barres (facultatif)"><Input bind:value={barcode} maxlength={100} /></Field>
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          open = false;
        }}>Annuler</Button
      ><Button type="submit" loading={saving}>Créer l’article</Button>
    </div>
  </form>
</Modal>
