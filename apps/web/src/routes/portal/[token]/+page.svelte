<script lang="ts">
  import { page } from '$app/state';
  import { FileText, Folder, LayoutDashboard, MessageSquareWarning, Package } from 'lucide-svelte';
  import { PortalApiError } from '$lib/portal/api';
  import { tokenClient } from '$lib/portal/client';
  import ChangeRequestsPanel from '$lib/portal/components/ChangeRequestsPanel.svelte';
  import DashboardPanel from '$lib/portal/components/DashboardPanel.svelte';
  import DocumentsPanel from '$lib/portal/components/DocumentsPanel.svelte';
  import InvoicesPanel from '$lib/portal/components/InvoicesPanel.svelte';
  import OrdersPanel from '$lib/portal/components/OrdersPanel.svelte';
  import PortalShell, { type PortalNavItem } from '$lib/portal/components/PortalShell.svelte';
  import type { PortalView } from '$lib/portal/types';

  const token = $derived(page.params.token ?? '');
  const client = $derived(tokenClient(token));

  let view = $state<PortalView | null>(null);
  let error = $state('');

  // The capability-link plane has no sub-routes (the token must stay in a single
  // URL), so the shell's nav switches an in-page tab instead of navigating.
  type Tab = 'dashboard' | 'orders' | 'invoices' | 'documents' | 'change';
  let activeTab = $state<Tab>('dashboard');

  const nav: PortalNavItem[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { key: 'orders', label: 'Commandes', icon: Package },
    { key: 'invoices', label: 'Factures', icon: FileText },
    { key: 'documents', label: 'Documents', icon: Folder },
    { key: 'change', label: 'Demandes', icon: MessageSquareWarning },
  ];

  async function load() {
    try {
      view = await client.get<PortalView>('/view');
    } catch (e) {
      error = e instanceof PortalApiError ? e.message : 'Ce lien est invalide.';
    }
  }

  $effect(() => {
    if (token) void load();
  });
</script>

<PortalShell
  branding={view?.branding}
  shipperName={view?.shipper ?? 'Portail client'}
  customerName={view?.customer ?? ''}
  {nav}
  activeKey={activeTab}
  onselect={(key) => (activeTab = key as Tab)}
>
  {#if error}
    <p class="text-sm text-danger" role="alert">{error}</p>
  {:else if view}
    <!-- Panels stay mounted (`hidden`) so switching tabs keeps their loaded state. -->
    <div hidden={activeTab !== 'dashboard'}>
      <DashboardPanel {client} {view} active={activeTab === 'dashboard'} />
    </div>
    <div hidden={activeTab !== 'orders'}>
      <OrdersPanel {client} {view} onOrderCreated={load} />
    </div>
    <div hidden={activeTab !== 'invoices'}>
      <InvoicesPanel {client} active={activeTab === 'invoices'} />
    </div>
    <div hidden={activeTab !== 'documents'}>
      <DocumentsPanel {client} {view} active={activeTab === 'documents'} />
    </div>
    <div hidden={activeTab !== 'change'}>
      <ChangeRequestsPanel {client} {view} active={activeTab === 'change'} />
    </div>
  {:else}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {/if}
</PortalShell>
