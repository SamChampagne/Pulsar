<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';
  import { MODULE_UNIVERSES } from '$lib/modules/universe';

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

  const universe = MODULE_UNIVERSES.fleet;

  const internalVehicles = $derived(vehicles.filter((v) => v.carrierId === null));
  const internalTrailers = $derived(trailers.filter((t) => t.carrierId === null));
  const internalDrivers = $derived(drivers.filter((d) => d.carrierId === null));
  const readyAssets = $derived([...internalVehicles, ...internalTrailers].filter((a) => a.status === 'AVAILABLE').length);
  const maintainedAssets = $derived([...internalVehicles, ...internalTrailers].filter((a) => a.status === 'MAINTENANCE').length);
  const complianceAttention = $derived(overview ? [...overview.complianceExpired, ...overview.complianceExpiring] : []);

  function fmtDate(d: string | null): string {
    return d ? new Date(d).toLocaleDateString() : '—';
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [ov, veh, trl, drv] = await Promise.all([
        api<Overview>('/fleet/overview'),
        api<Paginated<Asset>>('/transportation/vehicles', { query: { pageSize: 100 } }),
        api<Paginated<Asset>>('/transportation/trailers', { query: { pageSize: 100 } }),
        api<Paginated<Driver>>('/transportation/drivers', { query: { pageSize: 100 } }),
      ]);
      overview = ov;
      vehicles = veh.items;
      trailers = trl.items;
      drivers = drv.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement Assets';
    } finally {
      loading = false;
    }
  }

  $effect(() => { void load(); });
</script>

<PageHeader
  title="Assets / Fleet"
  subtitle="Disponibilité physique, conformité, maintenance."
/>

{#if error}<ErrorNotice message={error} onretry={load} />{/if}

<section class="mb-5 rounded-card border border-edge bg-surface p-4 shadow-sm">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Asset readiness</p>
      <h1 class="mt-1 text-xl font-bold tracking-tight text-ink">Fleet command</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      <a href="/fleet" class="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-strong">Ajouter / gérer assets</a>
      <a href="#attention" class="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted">Blockers</a>
      <a href="/agents" class="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted">Agent</a>
    </div>
  </div>
  <div class="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Ready</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : readyAssets}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Maintenance</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : maintainedAssets}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Conformité</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : complianceAttention.length}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Drivers</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : internalDrivers.length}</p>
    </div>
  </div>
</section>

{#if loading}
  <div class="grid gap-4 lg:grid-cols-3">
    {#each Array(3) as _, i (i)}<Card><Skeleton /></Card>{/each}
  </div>
{:else}
  <div class="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
    <div class="space-y-4">
      <div class="grid gap-4 md:grid-cols-3">
        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Fleet objects</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Physical roster</h2>
          <div class="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div class="rounded-inner bg-surface-muted p-2"><strong>{internalVehicles.length}</strong><span class="block text-xs text-ink-faint">Vehicles</span></div>
            <div class="rounded-inner bg-surface-muted p-2"><strong>{internalTrailers.length}</strong><span class="block text-xs text-ink-faint">Trailers</span></div>
            <div class="rounded-inner bg-surface-muted p-2"><strong>{internalDrivers.length}</strong><span class="block text-xs text-ink-faint">Drivers</span></div>
          </div>
          <a href="/fleet" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">Ouvrir le roster →</a>
        </Card>

        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Maintenance</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Work orders & due</h2>
          <div class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm">
            <span class="text-ink-muted">Open work orders</span><span class="font-semibold text-ink">{overview?.openWorkOrders ?? 0}</span>
          </div>
        </Card>

        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Assignment graph</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Capacity links</h2>
          <div class="mt-4 grid gap-2 text-xs">
            <div class="rounded-inner bg-surface-muted p-2"><strong>Transport</strong><span class="ml-1 text-ink-muted">actifs prêts</span></div>
            <div class="rounded-inner bg-surface-muted p-2"><strong>Yard</strong><span class="ml-1 text-ink-muted">remorques + spots</span></div>
            <div class="rounded-inner bg-surface-muted p-2"><strong>Finance</strong><span class="ml-1 text-ink-muted">coût par actif</span></div>
          </div>
        </Card>
      </div>

      <div id="attention">
        <Card padded={false}>
        <div class="border-b border-edge-soft px-4 py-3">
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Attention lane</p>
          <h2 class="mt-1 text-base font-bold text-ink">Compliance & maintenance blockers</h2>
        </div>
        {#if complianceAttention.length === 0 && (overview?.maintenanceDue.length ?? 0) === 0}
          <EmptyState message="Aucun blocker assets." />
        {:else}
          <div class="divide-y divide-edge-soft">
            {#each complianceAttention as doc (doc.id)}
              <div class="flex items-center gap-3 px-4 py-3 text-sm">
                <Badge tone={doc.status === 'EXPIRED' ? 'danger' : 'warn'}>{doc.status}</Badge>
                <span class="font-medium text-ink">{doc.docType}</span>
                <span class="text-ink-muted">{doc.subjectType.toLowerCase()} · {doc.subjectId}</span>
                <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
              </div>
            {/each}
            {#each overview?.maintenanceDue ?? [] as order (order.id)}
              <div class="flex items-center gap-3 px-4 py-3 text-sm">
                <Badge tone="warn">MAINTENANCE</Badge>
                <span class="font-medium text-ink">{order.description}</span>
                <span class="ml-auto text-ink-muted">due {fmtDate(order.dueDate)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </Card>
    </div>
    </div>

    <div class="space-y-4">
      <Card>
        <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Assigned employee</p>
        <h2 class="mt-1 text-lg font-bold text-ink">{universe.agent}</h2>
        <a href="/agents" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">Voir les agents →</a>
      </Card>

      <Card>
        <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Cross-module feeds</p>
        <div class="mt-3 space-y-2 text-sm">
          <div class="rounded-inner bg-surface-muted p-3"><strong>Transport</strong><span class="block text-ink-muted">demande des véhicules/remorques disponibles.</span></div>
          <div class="rounded-inner bg-surface-muted p-3"><strong>Yard</strong><span class="block text-ink-muted">voit remorques, spots et contraintes physiques.</span></div>
          <div class="rounded-inner bg-surface-muted p-3"><strong>Finance</strong><span class="block text-ink-muted">reçoit coûts, downtime et marge par actif.</span></div>
        </div>
      </Card>
    </div>
  </div>
{/if}
