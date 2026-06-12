<script lang="ts">
  import type { Tone } from './status';
  let { tone = 'neutral' as Tone, children } = $props();
  const tones: Record<Tone, string> = {
    ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info',
    neutral: 'bg-neutral-soft text-neutral',
  };
</script>

<span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
  <span class="text-[8px] leading-none">●</span>{@render children()}
</span>
