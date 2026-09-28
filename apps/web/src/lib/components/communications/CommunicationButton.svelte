<script lang="ts">
  import { MessageSquare } from 'lucide-svelte';
  import { PERMISSIONS } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { Button, Drawer } from '$lib/components/ui';
  import CommunicationPanel from './CommunicationPanel.svelte';
  let {
    access,
    entityId,
    disabled = false,
  }: { access: string; entityId: string; disabled?: boolean } = $props();
  let open = $state(false),
    busy = $state(false);
  const visible = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.COMMUNICATIONS_READ) &&
      ($auth.user.permissions.includes(PERMISSIONS.SMS.READ) ||
        $auth.user.permissions.includes(PERMISSIONS.EMAIL.READ)),
  );
</script>

{#if visible}
  <Button
    variant="secondary"
    {disabled}
    onclick={() => {
      open = true;
    }}><MessageSquare size={15} />Communications</Button
  >
  <Drawer bind:open title="Communications du dossier" width="xl" dismissible={!busy}>
    {#if open}{#key `${access}/${entityId}`}<CommunicationPanel
          {access}
          {entityId}
          bind:busy
        />{/key}{/if}
  </Drawer>
{/if}
