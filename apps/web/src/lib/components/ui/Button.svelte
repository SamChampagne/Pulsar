<script lang="ts">
  let {
    variant = 'primary' as 'primary' | 'secondary' | 'danger' | 'ghost',
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    href = undefined as string | undefined,
    onclick = undefined as ((e: MouseEvent) => void | Promise<void>) | undefined,
    children,
  } = $props();
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'border border-edge bg-surface text-ink hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  };
</script>

{#if href}
  <a
    {href}
    class={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${disabled ? 'pointer-events-none opacity-50' : ''} ${variants[variant]}`}
    {onclick}
  >
    {#if loading}<span class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>{/if}
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
    disabled={disabled || loading}
    {onclick}
  >
    {#if loading}<span class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>{/if}
    {@render children()}
  </button>
{/if}
