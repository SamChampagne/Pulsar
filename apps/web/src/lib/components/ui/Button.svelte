<script lang="ts">
  let {
    variant = 'primary' as 'primary' | 'secondary' | 'danger' | 'ghost',
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    href = undefined as string | undefined,
    'aria-label': ariaLabel = undefined as string | undefined,
    class: className = '',
    onclick = undefined as ((e: MouseEvent) => void | Promise<void>) | undefined,
    children,
  } = $props();
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'border border-edge bg-surface text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  };
  const classes = $derived(
    `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`,
  );
</script>

{#if href && !disabled && !loading}
  <a {href} class={`${classes} ${className}`} aria-label={ariaLabel} {onclick}>
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class={`${classes} ${className}`}
    aria-label={ariaLabel}
    disabled={disabled || loading}
    aria-busy={loading}
    {onclick}
  >
    {#if loading}<span
        class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      ></span>{/if}
    {@render children()}
  </button>
{/if}
