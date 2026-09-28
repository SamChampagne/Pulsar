<script lang="ts">
  import FinancialDocument from './FinancialDocument.svelte';
  let {
    invoiceId,
    noteId,
    number,
    busy = $bindable(false),
  }: {
    invoiceId: string;
    noteId: string;
    number: string;
    busy?: boolean;
  } = $props();
</script>

<FinancialDocument {invoiceId} {noteId} {number} bind:busy />
