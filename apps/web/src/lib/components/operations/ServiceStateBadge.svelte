<script lang="ts">
  import { SERVICE_STATE_LABELS, type ServiceState } from '@pulsar/shared';
  let { state }: { state: ServiceState } = $props();
  const tones: Record<ServiceState, string> = {
    OPERATIONAL: 'bg-ok-soft text-ok',
    DEGRADED: 'bg-warn-soft text-warn',
    UNAVAILABLE: 'bg-danger-soft text-danger',
    NOT_CONFIGURED: 'bg-neutral-soft text-neutral',
    UNVERIFIED: 'bg-surface-muted text-ink-muted',
  };
</script>

<span class="inline-flex whitespace-nowrap rounded px-2 py-1 text-xs font-semibold {tones[state]}"
  >{SERVICE_STATE_LABELS[state]}</span
>
