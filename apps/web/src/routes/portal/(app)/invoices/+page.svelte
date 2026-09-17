<script lang="ts">
  import { sessionClient } from '$lib/portal/client';
  import InvoicesPanel from '$lib/portal/components/InvoicesPanel.svelte';

  const client = sessionClient();
</script>

<InvoicesPanel {client} active={true} />
