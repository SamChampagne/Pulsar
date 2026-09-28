<script lang="ts">
  let {
    value = $bindable(''),
    rows = 3,
    disabled = false,
    readonly = false,
    placeholder = '',
    name = '',
    'aria-label': ariaLabel = undefined as string | undefined,
    oninput = undefined as
      | ((e: Event & { currentTarget: HTMLTextAreaElement }) => void)
      | undefined,
    required = false,
    maxlength = undefined as number | undefined,
    minlength = undefined as number | undefined,
  } = $props();
</script>

<textarea
  aria-label={ariaLabel}
  {oninput}
  {required}
  {maxlength}
  {minlength}
  {rows}
  {placeholder}
  {disabled}
  {readonly}
  name={name || undefined}
  bind:value
  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
></textarea>
