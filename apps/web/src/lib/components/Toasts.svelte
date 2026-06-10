<script lang="ts">
  import { toasts } from '$lib/stores/toast';
</script>

<div class="toasts">
  {#each $toasts as t (t.id)}
    <div class="toast toast-{t.kind}">{t.message}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
  }

  .toast {
    padding: 10px 16px;
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(16, 24, 40, 0.18);
    font-size: 13px;
    font-weight: 550;
    color: #fff;
    max-width: 360px;
  }

  .toast-success {
    background: var(--color-success);
  }

  .toast-error {
    background: var(--color-danger);
  }
</style>
