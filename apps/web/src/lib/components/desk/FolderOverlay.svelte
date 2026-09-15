<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  let {
    open = $bindable(false),
    name = '',
    onclose = undefined as (() => void) | undefined,
    children,
    footer = undefined,
  } = $props();
</script>

<Modal bind:open title={name} {onclose} size="lg" variant="folder" {footer}>
  <div class="grid grid-cols-3 justify-items-center gap-x-3 gap-y-7 py-3 sm:grid-cols-4">
    {@render children()}
  </div>
</Modal>
