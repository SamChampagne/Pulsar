<script lang="ts">
  let { message = '', onretry = undefined } = $props<{
    message?: string;
    onretry?: (() => void | Promise<void>) | undefined;
  }>();
</script>

{#if message}
  <div class="mb-4 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="font-semibold text-danger">Could not load this workspace data</div>
        <p class="mt-1 text-ink-muted">
          The page structure is still available. Retry the request or continue from another operational surface.
        </p>
        <p class="mt-1 text-xs text-ink-faint">{message}</p>
      </div>
      {#if onretry}
        <button
          type="button"
          class="rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
          onclick={onretry}
        >
          Retry
        </button>
      {/if}
    </div>
  </div>
{/if}
