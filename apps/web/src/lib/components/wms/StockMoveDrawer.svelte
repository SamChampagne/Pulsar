<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { Button, Drawer } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import { pendingMove } from '$lib/wms/move-intent';
  import StockMoveForm from './StockMoveForm.svelte';
  import type { WmsPutawayRow } from '@pulsar/shared';
  let {
    source,
    onclose,
    onsaved,
  }: { source: WmsPutawayRow; onclose: () => void; onsaved: () => void | Promise<void> } = $props();
  let open = $state(true),
    busy = $state(false);
  beforeNavigate(({ cancel }) => {
    if (open) cancel();
  });
  async function close() {
    if (busy) return;
    if (
      !$pendingMove &&
      !(await confirmAction('Abandonner la saisie de ce déplacement ?', {
        title: 'Fermer le déplacement',
        confirmLabel: 'Abandonner',
      }))
    )
      return;
    open = false;
    onclose();
  }
</script>

<Drawer
  bind:open
  title={`Ranger ${source.sku}`}
  width="md"
  dismissible={!busy}
  onbeforeclose={() => {
    void close();
    return false;
  }}
>
  <StockMoveForm
    {source}
    onbusy={(b) => (busy = b)}
    oncancel={close}
    onsaved={async () => {
      open = false;
      await onsaved();
    }}
  />
  {#snippet footer()}<Button variant="secondary" disabled={busy} onclick={close}>Fermer</Button
    >{/snippet}
</Drawer>
