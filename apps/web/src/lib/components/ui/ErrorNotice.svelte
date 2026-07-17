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
        <div class="font-semibold text-danger">Impossible de charger ces données.</div>
        <p class="mt-1 text-ink-muted">
          La structure de la page reste disponible. Réessayez la requête ou poursuivez depuis une autre surface opérationnelle.
        </p>
        <p class="mt-1 text-xs text-ink-faint">{message}</p>
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
