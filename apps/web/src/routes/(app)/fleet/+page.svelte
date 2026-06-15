<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, PageHeader, Skeleton, Tabs } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface ComplianceDoc {
    id: string;
    subjectType: 'VEHICLE' | 'TRAILER' | 'DRIVER';
    subjectId: string;
    docType: string;
    expiresAt: string;
    reference?: string | null;
    status: 'VALID' | 'EXPIRING' | 'EXPIRED';
  }

  interface MaintenanceOrder {
    id: string;
    status: string;
    description: string;
    dueDate: string | null;
  }

  interface Overview {
    openWorkOrders: number;
    maintenanceDue: MaintenanceOrder[];
    complianceExpiring: ComplianceDoc[];
    complianceExpired: ComplianceDoc[];
  }

  interface Asset {
    id: string;
    unitNumber: string;
    status: string;
    carrierId: string | null;
  }

  interface Driver {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    licenseNumber?: string | null;
    carrierId: string | null;
  }

  let overview = $state<Overview | null>(null);
  let vehicles = $state<Asset[]>([]);
  let trailers = $state<Asset[]>([]);
  let drivers = $state<Driver[]>([]);
  let loading = $state(true);
  let error = $state('');
  let activeTab = $state('vehicles');

  // AssetStatus → visual tone. Drivers use ACTIVE/INACTIVE (handled separately).
  function assetTone(status: string): Tone {
    switch (status) {
      case 'AVAILABLE':
        return 'ok';
      case 'IN_SERVICE':
        return 'info';
      case 'MAINTENANCE':
        return 'warn';
      case 'RETIRED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function driverTone(status: string): Tone {
    return status === 'ACTIVE' ? 'ok' : 'neutral';
  }

  function complianceTone(status: string): Tone {
    return status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warn' : 'ok';
  }

  function fmtDate(d: string | null): string {
    return d ? new Date(d).toLocaleDateString() : '—';
  }

  // Internal fleet = no carrier assigned.
  const internalVehicles = $derived(vehicles.filter((v) => v.carrierId === null));
  const internalTrailers = $derived(trailers.filter((t) => t.carrierId === null));
  const internalDrivers = $derived(drivers.filter((d) => d.carrierId === null));

  // Expired first (red), then expiring (amber).
  const complianceAttention = $derived(
    overview ? [...overview.complianceExpired, ...overview.complianceExpiring] : [],
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const [ov, veh, trl, drv] = await Promise.all([
        api<Overview>('/fleet/overview'),
        api<Paginated<Asset>>('/transportation/vehicles', { query: { pageSize: 200 } }),
        api<Paginated<Asset>>('/transportation/trailers', { query: { pageSize: 200 } }),
        api<Paginated<Driver>>('/transportation/drivers', { query: { pageSize: 200 } }),
      ]);
      overview = ov;
      vehicles = veh.items;
      trailers = trl.items;
      drivers = drv.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load fleet';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  const tabs = [
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'trailers', label: 'Trailers' },
    { id: 'drivers', label: 'Drivers' },
  ];
</script>

<PageHeader title="Fleet" />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if overview}
  <!-- A. Attention cards -->
  <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Work orders ouverts</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.openWorkOrders}</div>
      </Card>
    </a>
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Maintenance due (7j)</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.maintenanceDue.length}</div>
      </Card>
    </a>
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-warn">Conformité expirante (30j)</div>
        <div class="mt-1 text-3xl font-bold text-warn">{overview.complianceExpiring.length}</div>
      </Card>
    </a>
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-danger">Conformité expirée</div>
        <div class="mt-1 text-3xl font-bold text-danger">{overview.complianceExpired.length}</div>
      </Card>
    </a>
  </div>

  <!-- B. Compliance attention list -->
  <div id="compliance" class="mb-5">
    <h2 class="mb-2 text-sm font-semibold text-ink">Conformité à surveiller</h2>
    <Card padded={false}>
      {#if complianceAttention.length === 0}
        <EmptyState message="Aucun document à surveiller." />
      {:else}
        <div class="divide-y divide-edge">
          {#each complianceAttention as doc (doc.id)}
            <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone={complianceTone(doc.status)}>{doc.status}</Badge>
              <span class="font-medium text-ink">{doc.docType}</span>
              <span class="text-ink-muted">
                {doc.subjectType.toLowerCase()} · {doc.subjectId}
              </span>
              {#if doc.reference}<span class="text-ink-faint">{doc.reference}</span>{/if}
              <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>

  <!-- C. Asset roster -->
  <h2 class="mb-2 text-sm font-semibold text-ink">Flotte interne</h2>
  <Tabs {tabs} bind:active={activeTab}>
    {#if activeTab === 'vehicles'}
      <Card padded={false}>
        {#if internalVehicles.length === 0}
          <EmptyState message="Aucun véhicule interne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each internalVehicles as v (v.id)}
              <a
                href={`/fleet/vehicles/${v.id}`}
                class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <span class="font-medium text-ink">{v.unitNumber}</span>
                <Badge tone={assetTone(v.status)}>{v.status}</Badge>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {:else if activeTab === 'trailers'}
      <Card padded={false}>
        {#if internalTrailers.length === 0}
          <EmptyState message="Aucune remorque interne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each internalTrailers as t (t.id)}
              <a
                href={`/fleet/trailers/${t.id}`}
                class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <span class="font-medium text-ink">{t.unitNumber}</span>
                <Badge tone={assetTone(t.status)}>{t.status}</Badge>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {:else}
      <Card padded={false}>
        {#if internalDrivers.length === 0}
          <EmptyState message="Aucun chauffeur interne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each internalDrivers as d (d.id)}
              <a
                href={`/fleet/drivers/${d.id}`}
                class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <span class="font-medium text-ink">{d.firstName} {d.lastName}</span>
                {#if d.licenseNumber}<span class="text-ink-faint">{d.licenseNumber}</span>{/if}
                <Badge tone={driverTone(d.status)}>{d.status}</Badge>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {/if}
  </Tabs>
{/if}
