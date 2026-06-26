<script lang="ts">
  let {
    value = $bindable('' as string | number | null),
    type = 'text',
    placeholder = '',
    disabled = false,
    name = '',
    required = false,
    step = undefined as string | number | undefined,
    min = undefined as string | number | undefined,
    max = undefined as string | number | undefined,
    maxlength = undefined as number | undefined,
    minlength = undefined as number | undefined,
    oninput = undefined as ((e: Event & { currentTarget: HTMLInputElement }) => void) | undefined,
  } = $props();
</script>

<input
  {type} {placeholder} {disabled} name={name || undefined}
  {required}
  step={step !== undefined ? step : type === 'number' ? 'any' : undefined}
  min={min !== undefined ? min : undefined}
  max={max !== undefined ? max : undefined}
  maxlength={maxlength !== undefined ? maxlength : undefined}
  minlength={minlength !== undefined ? minlength : undefined}
  {oninput}
  bind:value
  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
/>
