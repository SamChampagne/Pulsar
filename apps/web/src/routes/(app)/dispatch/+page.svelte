<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { PageHeader } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import DispatchBacklog from '$lib/components/dispatch/DispatchBacklog.svelte';
  import LoadBuilder from '$lib/components/dispatch/LoadBuilder.svelte';
  import DispatchSidePanel from '$lib/components/dispatch/DispatchSidePanel.svelte';

  interface BacklogShipment {
    id: string;
    shipmentNumber: string;
    status: string;
    plannedPickupEarly: string | null;
    plannedDeliveryEarly: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
    weightKg?: number | null;
    volumeM3?: number | null;
    palletCount?: number | null;
  }

  interface OpenLoad {
    id: string;
    loadNumber: string;
    status: string;
  }

  type LoadDetail = {
    id: string; loadNumber: string; status: string;
    estimatedCost?: string | number | null; costCurrency?: string | null;
    shipments?: Array<{ id: string; shipmentNumber: string; status: string; weightKg?: number | null; volumeM3?: number | null; palletCount?: number | null; [key: string]: unknown }>;
    route?: { stops?: Array<{ id: string; sequence: number; type: string; [key: string]: unknown }> | null } | null;
    [key: string]: unknown;
  };

  let backlog = $state<BacklogShipment[]>([]);
  let backlogLoading = $state(true);
  let selectedIds = $state<Set<string>>(new Set());
  let openLoads = $state<OpenLoad[]>([]);
  let selectedLoadId = $state<string | null>(null);
  let selectedLoad = $state<LoadDetail | null>(null);
  let busy = $state(false);

  const hasSelection = $derived(selectedIds.size > 0);

  async function loadBacklog() {
    backlogLoading = true;
    try {
      const res = await api<Paginated<BacklogShipment>>('/transportation/shipments', {
        query: { unassigned: 'true', pageSize: 100 },
      });
      backlog = res.items;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load backlog');
    } finally {
      backlogLoading = false;
    }
  }

  type LoadOption = OpenLoad;

  async function loadOpenLoads() {
    try {
      const [open, planned] = await Promise.all([
        api<{ items: LoadOption[] }>('/transportation/loads', { query: { status: 'OPEN', pageSize: 100 } }),
        api<{ items: LoadOption[] }>('/transportation/loads', { query: { status: 'PLANNED', pageSize: 100 } }),
      ]);
      openLoads = [...planned.items, ...open.items];
    } catch { openLoads = []; }
  }

  async function selectLoad(id: string) {
    selectedLoadId = id;
    try {
      selectedLoad = await api<LoadDetail>(`/transportation/loads/${id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load load');
    }
  }

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  async function consolidate() {
    if (selectedIds.size === 0) return;
    busy = true;
    try {
      const created = await api<OpenLoad>('/transportation/loads/consolidate', {
        method: 'POST',
        body: { shipmentIds: [...selectedIds] },
      });
      selectedIds = new Set();
      await Promise.all([loadBacklog(), loadOpenLoads()]);
      await selectLoad(created.id);
      toast.success(`${created.loadNumber} created`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to consolidate');
    } finally {
      busy = false;
    }
  }

  async function addSelectionToLoad() {
    if (!selectedLoadId || selectedIds.size === 0) return;
    busy = true;
    try {
      for (const sid of selectedIds) {
        await api(`/transportation/shipments/${sid}/assign-load`, {
          method: 'POST',
          body: { loadId: selectedLoadId },
        });
      }
      selectedIds = new Set();
      await loadBacklog();
      if (selectedLoadId) await selectLoad(selectedLoadId);
      toast.success('Shipments assigned to load');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Assignation (capacité ?)');
      selectedIds = new Set();
      await loadBacklog();
      if (selectedLoadId) await selectLoad(selectedLoadId);
    } finally {
      busy = false;
    }
  }

  async function removeShipment(sid: string) {
    busy = true;
    try {
      await api(`/transportation/shipments/${sid}/remove-load`, { method: 'POST' });
      await loadBacklog();
      if (selectedLoadId) await selectLoad(selectedLoadId);
      toast.success('Shipment returned to planning pool');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove shipment');
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void loadBacklog();
    void loadOpenLoads();
  });
</script>

<PageHeader title="Dispatch" />

<div class="grid gap-3 lg:grid-cols-[26%_minmax(0,1fr)_30%]">
  <DispatchBacklog {backlog} {backlogLoading} {selectedIds} onToggle={toggle} />
  <LoadBuilder
    {selectedLoad}
    {openLoads}
    {selectedLoadId}
    {hasSelection}
    {busy}
    onSelectLoad={selectLoad}
    onConsolidate={consolidate}
    onAddSelection={addSelectionToLoad}
    onRemoveShipment={removeShipment}
  />
  <DispatchSidePanel
    {selectedLoad}
    onChanged={() => selectedLoadId && selectLoad(selectedLoadId)}
  />
</div>
