<script lang="ts">
  let {
    value = $bindable(''),
    disabled = false,
    name = '',
    required = false,
    onchange = undefined as ((e: Event & { currentTarget: HTMLSelectElement }) => void) | undefined,
    children,
  } = $props();
</script>

<select
  bind:value {disabled} name={name || undefined} {required} {onchange}
  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
>
  {@render children()}
</select>
