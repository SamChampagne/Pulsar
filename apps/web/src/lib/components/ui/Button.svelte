<script lang="ts">
  let {
    variant = 'primary' as 'primary' | 'secondary' | 'danger' | 'ghost',
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    onclick = undefined as (() => void | Promise<void>) | undefined,
    children,
  } = $props();
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'border border-edge bg-surface text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  };
</script>

<button
  {type}
  class={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
  disabled={disabled || loading}
  {onclick}
>
  {#if loading}<span class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>{/if}
  {@render children()}
</button>
