<script lang="ts">
  let {
    message = '',
    title = 'La demande n’a pas abouti.',
    onretry = undefined,
  } = $props<{
    message?: string;
    title?: string;
    onretry?: (() => void | Promise<void>) | undefined;
  }>();
</script>

{#if message}
  <div role="alert" class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="font-medium text-danger">{title}</div>
        <p class="mt-1 text-sm text-ink-muted">{message}</p>
      </div>
      {#if onretry}
        <button
          type="button"
          class="rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
          onclick={onretry}
        >
          Réessayer
        </button>
      {/if}
    </div>
  </div>
{/if}
