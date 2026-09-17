<script lang="ts">
  import { page } from '$app/state';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { PortalApiError } from '$lib/portal/api';
  import { tokenClient } from '$lib/portal/client';
  import ChangeRequestForm from '$lib/portal/components/ChangeRequestForm.svelte';
  import DocumentsPanel from '$lib/portal/components/DocumentsPanel.svelte';
  import InvoicesPanel from '$lib/portal/components/InvoicesPanel.svelte';
  import OrdersPanel from '$lib/portal/components/OrdersPanel.svelte';
  import type { PortalView } from '$lib/portal/types';

  const token = $derived(page.params.token ?? '');
  const client = $derived(tokenClient(token));

  let view = $state<PortalView | null>(null);
  let error = $state('');

  let activeTab = $state<'orders' | 'invoices' | 'documents' | 'change'>('orders');

  async function load() {
    try {
      view = await client.get<PortalView>('/view');
    } catch (e) {
      error = e instanceof PortalApiError ? e.message : 'This link is invalid';
    }
  }

  $effect(() => {
    if (token) void load();
  });
</script>

<PublicShell maxWidth="max-w-3xl" brand={view?.branding}>
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if view}
    <p class="mb-1 text-sm text-ink-muted">Portail client · {view.shipper}</p>
    <div class="mb-4 flex items-center justify-between gap-4">
      <h1 class="text-xl font-bold text-ink">{view.customer}</h1>
    </div>

    <!-- Tab bar -->
    <div class="mb-6 overflow-x-auto border-b border-edge">
      <div class="flex w-max gap-4">
        {#each [['orders', 'Commandes'], ['invoices', 'Factures'], ['documents', 'Documents'], ['change', 'Changement']] as [tab, label] (tab)}
          <button
            type="button"
            class={`shrink-0 pb-2 text-sm whitespace-nowrap transition-colors ${activeTab === tab ? 'border-b-2 border-accent font-semibold text-accent' : 'text-ink-muted hover:text-ink'}`}
            onclick={() => {
              activeTab = tab as typeof activeTab;
            }}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>

    <div hidden={activeTab !== 'orders'}>
      <OrdersPanel {client} {view} onOrderCreated={load} />
    </div>
    <div hidden={activeTab !== 'invoices'}>
      <InvoicesPanel {client} active={activeTab === 'invoices'} />
    </div>
    <div hidden={activeTab !== 'documents'}>
      <DocumentsPanel {client} {view} />
    </div>
    <div hidden={activeTab !== 'change'}>
      <ChangeRequestForm {client} {view} />
    </div>

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {/if}
</PublicShell>
