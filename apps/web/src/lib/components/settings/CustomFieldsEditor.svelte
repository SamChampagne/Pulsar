<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Field, Input, Select, Button, Card } from '$lib/components/ui';

  type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';

  interface EntityTypeDef {
    value: string;
    label: string;
  }

  interface FieldRow {
    key: string;
    label: string;
    type: FieldType;
    required: boolean;
    showInList: boolean;
    options: string; // comma-separated for SELECT
  }

  // Default entity types for transportation (back-compat).
  const TRANSPORTATION_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'TRANSPORT_ORDER', label: 'Transport Order' },
    { value: 'SHIPMENT', label: 'Shipment' },
    { value: 'LOAD', label: 'Load' },
  ];

  const BILLING_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'INCOMING_CARRIER_INVOICE', label: 'Facture transporteur entrante' },
    { value: 'CUSTOMER_INVOICE', label: 'Facture client' },
  ];

  const WMS_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'RECEIPT', label: 'Réception' },
    { value: 'PICK_ORDER', label: 'Pick order' },
  ];

  const YARD_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'YARD_VISIT', label: 'Visite de cour' },
    { value: 'DOCK_APPOINTMENT', label: 'Rendez-vous quai' },
  ];

  const FLEET_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'VEHICLE', label: 'Véhicule' },
    { value: 'TRAILER', label: 'Remorque' },
    { value: 'MAINTENANCE_ORDER', label: 'Ordre de maintenance' },
  ];

  const PROCUREMENT_ENTITY_TYPES: EntityTypeDef[] = [{ value: 'RFP', label: 'RFP' }];

  const CRM_ENTITY_TYPES: EntityTypeDef[] = [
    { value: 'CRM_COMPANY', label: 'Sociétés' },
    { value: 'CRM_CONTACT', label: 'Contacts' },
    { value: 'CRM_DEAL', label: 'Deals' },
  ];

  const FIELD_TYPES: { value: FieldType; label: string }[] = [
    { value: 'TEXT', label: 'Texte' },
    { value: 'NUMBER', label: 'Nombre' },
    { value: 'DATE', label: 'Date' },
    { value: 'BOOLEAN', label: 'Oui/Non' },
    { value: 'SELECT', label: 'Liste de choix' },
  ];

  // Props: module defaults to 'transportation' for back-compat.
  let { module: moduleProp = 'transportation' }: { module?: string } = $props();

  const entityTypes = $derived(
    moduleProp === 'billing'
      ? BILLING_ENTITY_TYPES
      : moduleProp === 'wms'
        ? WMS_ENTITY_TYPES
        : moduleProp === 'yard'
          ? YARD_ENTITY_TYPES
          : moduleProp === 'fleet'
            ? FLEET_ENTITY_TYPES
            : moduleProp === 'procurement'
              ? PROCUREMENT_ENTITY_TYPES
              : moduleProp === 'crm'
                ? CRM_ENTITY_TYPES
                : TRANSPORTATION_ENTITY_TYPES,
  );
  const apiBase = $derived(`/${moduleProp}/custom-fields`);

  let entityType = $state<string>('');
  let rows = $state<FieldRow[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state('');
  let saved = $state(false);

  // Initialize entityType when entityTypes changes (i.e. when module prop changes).
  $effect(() => {
    if (entityTypes.length > 0 && !entityTypes.find((et) => et.value === entityType)) {
      entityType = entityTypes[0].value;
    }
  });

  function emptyRow(): FieldRow {
    return { key: '', label: '', type: 'TEXT', required: false, showInList: false, options: '' };
  }

  async function load(et: string) {
    if (!et) return;
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
      >(apiBase, { query: { entityType: et } });
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
      await api(apiBase, {
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
        {#each entityTypes as et (et.value)}
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
