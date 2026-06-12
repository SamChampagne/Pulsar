<script lang="ts">
  let { value = $bindable(''), rows = 3, disabled = false, placeholder = '', name = '' } = $props();
</script>

<textarea
  {rows} {placeholder} {disabled} name={name || undefined}
  bind:value
  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
></textarea>
