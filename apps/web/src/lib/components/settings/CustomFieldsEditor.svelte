<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Field, Input, Select, Button, Card } from '$lib/components/ui';

  type EntityType = 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD';
  type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';

  interface FieldRow {
    key: string;
    label: string;
    type: FieldType;
    required: boolean;
    showInList: boolean;
    options: string; // comma-separated for SELECT
  }

  const ENTITY_TYPES: { value: EntityType; label: string }[] = [
    { value: 'TRANSPORT_ORDER', label: 'Transport Order' },
    { value: 'SHIPMENT', label: 'Shipment' },
    { value: 'LOAD', label: 'Load' },
  ];

  const FIELD_TYPES: { value: FieldType; label: string }[] = [
    { value: 'TEXT', label: 'Texte' },
    { value: 'NUMBER', label: 'Nombre' },
    { value: 'DATE', label: 'Date' },
    { value: 'BOOLEAN', label: 'Oui/Non' },
    { value: 'SELECT', label: 'Liste de choix' },
  ];

  let entityType = $state<EntityType>('TRANSPORT_ORDER');
  let rows = $state<FieldRow[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state('');
  let saved = $state(false);

  function emptyRow(): FieldRow {
    return { key: '', label: '', type: 'TEXT', required: false, showInList: false, options: '' };
  }

  async function load(et: EntityType) {
    loading = true;
    error = '';
    saved = false;
    try {
      const defs = await api<
        {
          key: string;
          label: string;
          type: FieldType;
          required: boolean;
          showInList: boolean;
          options?: { value: string; label: string }[];
        }[]
      >('/transportation/custom-fields', { query: { entityType: et } });
      rows = defs.map((d) => ({
        key: d.key,
        label: d.label,
        type: d.type,
        required: d.required,
        showInList: d.showInList,
        // Encode as "value:label" when they differ, so a round-trip preserves labels.
        options: d.options
          ? d.options.map((o) => (o.label !== o.value ? `${o.value}:${o.label}` : o.value)).join(', ')
          : '',
      }));
      if (rows.length === 0) rows = [emptyRow()];
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    error = '';
    saved = false;
    try {
      const definitions = rows
        .filter((r) => r.key.trim() && r.label.trim())
        .map((r) => ({
          key: r.key.trim(),
          label: r.label.trim(),
          type: r.type,
          required: r.required,
          showInList: r.showInList,
          options:
            r.type === 'SELECT'
              ? r.options
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((token) => {
                    // Token format: "value:label" (when label≠value) or plain "value".
                    const colonIdx = token.indexOf(':');
                    if (colonIdx > 0) {
                      return { value: token.slice(0, colonIdx), label: token.slice(colonIdx + 1) };
                    }
                    return { value: token, label: token };
                  })
              : undefined,
        }));
      await api('/transportation/custom-fields', {
        method: 'PUT',
        body: { entityType, definitions },
      });
      saved = true;
      await load(entityType);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void load(entityType);
  });
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Champs personnalisés</h2>

  <div class="mb-4 w-48">
    <Field label="Entité">
      <Select bind:value={entityType}>
        {#each ENTITY_TYPES as et (et.value)}
          <option value={et.value}>{et.label}</option>
        {/each}
      </Select>
    </Field>
  </div>

  {#if loading}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each rows as row, index (index)}
        <div class="grid grid-cols-[1fr_1fr_120px_80px_80px_36px] items-end gap-2">
          <Field label={index === 0 ? 'Clé' : ''}>
            <Input bind:value={row.key} placeholder="ex: priority_code" />
          </Field>
          <Field label={index === 0 ? 'Libellé' : ''}>
            <Input bind:value={row.label} placeholder="ex: Code priorité" />
          </Field>
          <Field label={index === 0 ? 'Type' : ''}>
            <Select bind:value={row.type}>
              {#each FIELD_TYPES as ft (ft.value)}
                <option value={ft.value}>{ft.label}</option>
              {/each}
            </Select>
          </Field>
          <Field label={index === 0 ? 'Requis' : ''}>
            <div class="flex h-9 items-center">
              <input
                type="checkbox"
                bind:checked={row.required}
                class="h-4 w-4 rounded border-edge accent-accent"
              />
            </div>
          </Field>
          <Field label={index === 0 ? 'En liste' : ''}>
            <div class="flex h-9 items-center">
              <input
                type="checkbox"
                bind:checked={row.showInList}
                class="h-4 w-4 rounded border-edge accent-accent"
              />
            </div>
          </Field>
          <div class={index === 0 ? 'mt-5' : ''}>
            {#if rows.length > 1}
              <Button
                variant="danger"
                onclick={() => {
                  rows = rows.filter((_, i) => i !== index);
                }}>✕</Button
              >
            {:else}
              <span></span>
            {/if}
          </div>
        </div>
        {#if row.type === 'SELECT'}
          <div class="ml-2 mb-2">
            <Field label="Options (séparées par des virgules ; valeur:libellé si différents)">
              <Input bind:value={row.options} placeholder="ex: URGENT:Urgent, NORMAL:Normal, LOW" />
            </Field>
          </div>
        {/if}
      {/each}
    </div>

    <div class="mt-3 flex gap-2">
      <Button
        variant="secondary"
        type="button"
        onclick={() => {
          rows = [...rows, emptyRow()];
        }}>Ajouter un champ</Button
      >
      <Button onclick={() => void save()} loading={saving} disabled={saving}>Enregistrer</Button>
      {#if saved}
        <span class="self-center text-sm text-ok">Enregistré ✓</span>
      {/if}
    </div>

    {#if error}
      <p class="mt-2 text-sm text-danger">{error}</p>
    {/if}
  {/if}
</Card>
