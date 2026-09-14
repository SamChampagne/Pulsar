<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Select, Input, Button, ErrorNotice, Skeleton, EmptyState } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';

  let { module }: { module: string } = $props();
  interface SettingDescriptor {
    key: string;
    label: string;
    help?: string;
    type: 'enum' | 'boolean' | 'number' | 'string';
    default: string | number | boolean;
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    pattern?: string;
    maxLength?: number;
  }
  type Values = Record<string, string | number | boolean>;
  let descriptors = $state<SettingDescriptor[]>([]);
  let values = $state<Values>({});
  let baseline = $state<Values>({});
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let saved = $state(false);
  let generation = 0;
  const dirty = $derived(descriptors.some((d) => values[d.key] !== baseline[d.key]));

  async function load() {
    const request = ++generation;
    loading = true;
    saving = false;
    error = '';
    saved = false;
    descriptors = [];
    try {
      const res = await api<{ descriptors: SettingDescriptor[]; values: Values }>(
        `/modules/${module}/settings`,
      );
      if (request !== generation) return;
      descriptors = res.descriptors;
      values = { ...res.values };
      baseline = { ...res.values };
    } catch (e) {
      if (request === generation) error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      if (request === generation) loading = false;
    }
  }

  async function save() {
    if (saving || loading || !dirty) return;
    const request = generation;
    saving = true;
    error = '';
    saved = false;
    try {
      const res = await api<{ values: Values }>(`/modules/${module}/settings`, {
        method: 'PUT',
        body: { settings: { ...values } },
      });
      if (request !== generation) return;
      values = { ...res.values };
      baseline = { ...res.values };
      saved = true;
    } catch (e) {
      if (request === generation)
        error = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      if (request === generation) saving = false;
    }
  }

  async function revert() {
    const request = generation;
    if (
      await confirmAction(
        'Revenir aux derniers réglages enregistrés ? Vos modifications locales seront perdues.',
        {
          title: 'Abandonner les modifications',
          confirmLabel: 'Abandonner',
          dangerous: false,
        },
      )
    ) {
      if (request !== generation) return;
      values = { ...baseline };
      error = '';
      saved = false;
    }
  }

  $effect(() => {
    if (module) void load();
  });
</script>

{#if loading}
  <div aria-label="Chargement des réglages" aria-busy="true"><Skeleton rows={5} /></div>
{:else}
  <ErrorNotice message={error} onretry={descriptors.length ? undefined : load} />
  {#if descriptors.length === 0 && !error}
    <EmptyState message="Aucun paramètre configurable pour ce module." />
  {:else if descriptors.length > 0}
    <form
      aria-label="Réglages du module"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      class="space-y-4"
    >
      <fieldset
        disabled={saving}
        class="divide-y divide-edge rounded-lg border border-edge bg-surface"
      >
        {#each descriptors as d (d.key)}
          <label
            class="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-center md:gap-8"
          >
            <span class="min-w-0">
              <span class="block text-sm font-medium text-ink">{d.label}</span>
              {#if d.help}<span class="mt-1 block text-xs leading-relaxed text-ink-muted"
                  >{d.help}</span
                >{/if}
            </span>
            <span class="min-w-0">
              {#if d.type === 'enum'}
                <Select bind:value={values[d.key] as string} aria-label={d.label}>
                  {#each d.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option
                    >{/each}
                </Select>
              {:else if d.type === 'boolean'}
                <span class="flex min-h-9 items-center gap-3">
                  <input
                    type="checkbox"
                    bind:checked={values[d.key] as boolean}
                    aria-label={d.label}
                    class="h-4 w-4 rounded border-edge accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />
                  <span class="text-sm text-ink-muted"
                    >{values[d.key] ? 'Activé' : 'Désactivé'}</span
                  >
                </span>
              {:else if d.type === 'string'}
                <Input
                  bind:value={values[d.key] as string}
                  aria-label={d.label}
                  maxlength={d.maxLength}
                  pattern={d.pattern}
                />
              {:else}
                <Input
                  type="number"
                  bind:value={values[d.key] as string | number}
                  aria-label={d.label}
                  min={d.min}
                  max={d.max}
                />
              {/if}
            </span>
          </label>
        {/each}
      </fieldset>
      <div
        class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-surface p-3 shadow-sm"
      >
        <p class="text-xs text-ink-muted" role="status">
          {saving
            ? 'Enregistrement…'
            : dirty
              ? 'Modifications non enregistrées'
              : saved
                ? 'Réglages enregistrés'
                : 'Réglages à jour'}
        </p>
        <div class="flex items-center gap-2">
          {#if dirty}<Button variant="secondary" disabled={saving} onclick={revert}
              >Annuler les modifications</Button
            >{/if}
          <Button type="submit" loading={saving} disabled={saving || !dirty}>Enregistrer</Button>
        </div>
      </div>
    </form>
  {/if}
{/if}
