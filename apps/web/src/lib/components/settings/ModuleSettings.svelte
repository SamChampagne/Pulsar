<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Select, Input, Button } from '$lib/components/ui';

  let { module }: { module: string } = $props();

  interface SettingOption {
    value: string;
    label: string;
  }

  interface SettingDescriptor {
    key: string;
    label: string;
    help?: string;
    type: 'enum' | 'boolean' | 'number' | 'string';
    default: string | number | boolean;
    options?: SettingOption[];
    min?: number;
    max?: number;
    pattern?: string;
    maxLength?: number;
  }

  let descriptors = $state<SettingDescriptor[]>([]);
  let values = $state<Record<string, string | number | boolean>>({});
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let saved = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<{
        descriptors: SettingDescriptor[];
        values: Record<string, string | number | boolean>;
      }>(`/modules/${module}/settings`);
      descriptors = res.descriptors;
      values = { ...res.values };
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
      const res = await api<{ values: Record<string, string | number | boolean> }>(
        `/modules/${module}/settings`,
        { method: 'PUT', body: { settings: values } },
      );
      values = { ...res.values };
      saved = true;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    if (module) void load();
  });
</script>

{#if loading}
  <p class="text-sm text-ink-muted">Chargement…</p>
{:else if error}
  <p class="text-sm text-danger">{error}</p>
{:else if descriptors.length === 0}
  <p class="text-sm text-ink-muted">Aucun paramètre configurable pour ce module.</p>
{:else}
  <div class="space-y-5">
    {#each descriptors as d (d.key)}
      <div class="space-y-1">
        {#if d.type !== 'boolean'}
          <label class="block text-sm font-medium text-ink">{d.label}</label>
        {/if}
        {#if d.help}
          <p class="text-xs text-ink-muted">{d.help}</p>
        {/if}

        {#if d.type === 'enum'}
          <Select bind:value={values[d.key] as string}>
            {#each d.options ?? [] as o (o.value)}
              <option value={o.value}>{o.label}</option>
            {/each}
          </Select>
        {:else if d.type === 'boolean'}
          <label class="flex cursor-pointer items-center gap-2 text-sm text-ink" for="setting-bool-{d.key}">
            <input
              id="setting-bool-{d.key}"
              type="checkbox"
              bind:checked={values[d.key] as boolean}
              class="h-4 w-4 rounded border-edge accent-accent"
            />
            {d.label}
          </label>
        {:else if d.type === 'string'}
          <Input type="text" bind:value={values[d.key] as string} maxlength={d.maxLength} />
        {:else}
          <Input
            type="number"
            bind:value={values[d.key] as string | number}
            min={d.min}
            max={d.max}
          />
        {/if}
      </div>
    {/each}

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <div class="flex items-center gap-3 border-t border-edge pt-4">
      <Button onclick={() => void save()} loading={saving} disabled={saving}>Enregistrer</Button>
      {#if saved}
        <span class="text-sm text-ok">Enregistré ✓</span>
      {/if}
    </div>
  </div>
{/if}
