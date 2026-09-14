<script lang="ts">
  import { onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { confirmation, answerConfirmation, cancelConfirmation } from '$lib/stores/confirmation';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';

  beforeNavigate(cancelConfirmation);
  onDestroy(cancelConfirmation);
</script>

{#if $confirmation}
  {@const request = $confirmation}
  <Modal open title={request.title} size="sm" onclose={() => answerConfirmation(request.id, false)}>
    <p class="whitespace-pre-line text-sm leading-6 text-ink-muted">{request.message}</p>
    {#snippet footer()}
      <Button variant="secondary" onclick={() => answerConfirmation(request.id, false)}
        >Annuler</Button
      >
      <Button
        variant={request.dangerous ? 'danger' : 'primary'}
        onclick={() => answerConfirmation(request.id, true)}>{request.confirmLabel}</Button
      >
    {/snippet}
  </Modal>
{/if}
