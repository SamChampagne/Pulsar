<!--
  A `<Select>` fed by a closed vocabulary (hard rule 53): countries, provinces,
  currencies, WMS units — the pure catalogs of `@pulsar/shared/reference`, or any
  other fixed list. Use `EntityPicker` instead when the values come from a
  tenant-scoped API endpoint.

  The leading placeholder option carries the empty value and is disabled, so the
  control has no accidental default. Pass `clearable` when the empty value is a
  legitimate choice (a filter meaning "all").
-->
<script lang="ts">
  import Select from './Select.svelte';

  export interface ReferenceOption {
    value: string;
    label: string;
  }

  let {
    options = [] as ReferenceOption[],
    value = $bindable(''),
    placeholder = 'Sélectionner…',
    disabled = false,
    clearable = false,
    name = '',
    required = false,
    'aria-label': ariaLabel = undefined as string | undefined,
    onchange = undefined as ((e: Event & { currentTarget: HTMLSelectElement }) => void) | undefined,
  }: {
    options?: ReferenceOption[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    name?: string;
    required?: boolean;
    'aria-label'?: string;
    onchange?: ((e: Event & { currentTarget: HTMLSelectElement }) => void) | undefined;
  } = $props();
</script>

<Select bind:value {disabled} {name} {required} aria-label={ariaLabel} {onchange}>
  <option value="" disabled={!clearable}>{placeholder}</option>
  {#each options as option (option.value)}
    <option value={option.value}>{option.label}</option>
  {/each}
</Select>
