<script lang="ts">
  import { toasts } from '$lib/stores/toast';
</script>

<div class="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
  {#each $toasts as t (t.id)}
    <div
      class={`rounded-card border border-edge bg-surface px-4 py-2.5 text-sm font-semibold shadow-pop max-w-sm ${t.kind === 'success' ? 'text-ok' : 'text-danger'}`}
    >
      {t.message}
    </div>
  {/each}
</div>
