<script lang="ts">
  import { AlertTriangle, AlertCircle, Info, X } from 'lucide-svelte';

  type Severity = 'danger' | 'warn' | 'info';

  let {
    severity = 'warn' as Severity,
    title,
    message = '',
    dismissible = false,
    action = undefined,
  }: {
    severity?: Severity;
    title: string;
    message?: string;
    dismissible?: boolean;
    action?: import('svelte').Snippet;
  } = $props();

  let dismissed = $state(false);

  const styles: Record<Severity, { bg: string; fg: string; icon: typeof AlertTriangle }> = {
    danger: { bg: 'bg-danger-soft', fg: 'text-danger', icon: AlertTriangle },
    warn: { bg: 'bg-warn-soft', fg: 'text-warn', icon: AlertCircle },
    info: { bg: 'bg-info-soft', fg: 'text-info', icon: Info },
  };

  const style = $derived(styles[severity]);
  const Icon = $derived(style.icon);
</script>

{#if !dismissed}
  <div class={`flex items-start gap-3 rounded-card ${style.bg} p-3`} role="alert">
    <Icon class={`size-5 shrink-0 ${style.fg}`} />
    <div class="min-w-0 flex-1">
      <div class={`text-sm font-semibold ${style.fg}`}>{title}</div>
      {#if message}
        <div class="mt-0.5 text-sm text-ink-muted">{message}</div>
      {/if}
      {#if action}
        <div class="mt-2">{@render action()}</div>
      {/if}
    </div>
    {#if dismissible}
      <button
        class={`shrink-0 ${style.fg} opacity-70 hover:opacity-100`}
        onclick={() => (dismissed = true)}
        aria-label="Ignorer"
      >
        <X class="size-4" />
      </button>
    {/if}
  </div>
{/if}
