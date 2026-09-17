<!--
  A `<Select>` fed by a closed vocabulary (hard rule 53): countries, provinces,
  currencies, WMS units — the pure catalogs of `@pulsar/shared/reference`, or any
  other fixed list. Use `EntityPicker` instead when the values come from a
  tenant-scoped API endpoint.

  The leading placeholder option carries the empty value and is disabled, so the
  control has no accidental default. Pass `clearable` when the empty value is a
  legitimate choice (a filter meaning "all").

  A stored value outside the catalog (a legacy record, or a code the catalog
  dropped) is never silently blanked: when `value` is non-empty and absent from
  `options`, an extra `{ value, label: value }` option is appended so the select
  still displays it. Callers don't need to build this themselves (see
  `wms/items` before this generalization).
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

  const effectiveOptions = $derived(
    value.trim() && !options.some((o) => o.value === value)
      ? [...options, { value, label: value }]
      : options,
  );
</script>

<Select bind:value {disabled} {name} {required} aria-label={ariaLabel} {onchange}>
  <option value="" disabled={!clearable}>{placeholder}</option>
  {#each effectiveOptions as option (option.value)}
    <option value={option.value}>{option.label}</option>
  {/each}
</Select>
