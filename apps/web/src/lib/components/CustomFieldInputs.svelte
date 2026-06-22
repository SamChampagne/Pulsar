<script lang="ts">
  import { Field, Input, Select } from '$lib/components/ui';

  interface Def {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
  }

  let { definitions, data = $bindable() }: { definitions: Def[]; data: Record<string, unknown> } =
    $props();

  // Seed a defined default for every field BEFORE the inputs render. Binding
  // `bind:value={data[key]}` to `undefined` throws in Svelte 5 (props_invalid_value)
  // because the underlying Input/Select declares a `$bindable('')` fallback. The
  // script body runs once at init, ahead of the first render, so the bindings
  // always see a defined value. Empty strings are stripped by the caller on submit.
  for (const d of definitions) {
    if (data[d.key] === undefined) data[d.key] = d.type === 'BOOLEAN' ? false : '';
  }
</script>

{#each definitions as d (d.key)}
  <Field label={d.label}>
    {#if d.type === 'BOOLEAN'}
      <input
        type="checkbox"
        bind:checked={data[d.key] as boolean}
        class="h-4 w-4 rounded border-edge accent-accent"
      />
    {:else if d.type === 'SELECT'}
      <Select bind:value={data[d.key] as string} required={d.required}>
        <option value="">—</option>
        {#each d.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </Select>
    {:else if d.type === 'NUMBER'}
      <Input type="number" bind:value={data[d.key] as string | number} required={d.required} />
    {:else if d.type === 'DATE'}
      <Input type="date" bind:value={data[d.key] as string} required={d.required} />
    {:else}
      <Input type="text" bind:value={data[d.key] as string} required={d.required} />
    {/if}
  </Field>
{/each}
