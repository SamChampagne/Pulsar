<script lang="ts">
  import LotChoice from '$lib/components/wms/LotChoice.svelte';
  let {
    itemId,
    binId,
    quantity,
    disabled = false,
    value = $bindable(''),
    ready = $bindable(false),
  }: {
    itemId: string;
    binId: string;
    quantity: string;
    disabled?: boolean;
    value?: string;
    ready?: boolean;
  } = $props();
  let previousBin: string | undefined;
  $effect(() => {
    if (previousBin !== undefined && previousBin !== binId) value = '';
    previousBin = binId;
  });
  $effect(() => {
    if (Number(quantity) === 0) {
      value = '';
      ready = quantity.trim() !== '';
    }
  });
</script>

{#if Number(quantity) > 0}
  <LotChoice outgoing {itemId} {binId} bind:value bind:ready disabled={disabled || !binId} />
{:else if quantity.trim() !== '' && Number(quantity) === 0}
  <p class="text-xs text-ink-muted">
    Zéro explicite : aucun mouvement ni lien de lot pour cette ligne.
  </p>
{/if}
