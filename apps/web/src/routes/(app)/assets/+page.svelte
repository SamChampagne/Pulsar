<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';

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
  let rosterPartial = $state(false);

  const internalVehicles = $derived(vehicles.filter((v) => v.carrierId === null));
  const internalTrailers = $derived(trailers.filter((t) => t.carrierId === null));
  const internalDrivers = $derived(drivers.filter((d) => d.carrierId === null));
  const rollingAssets = $derived([...internalVehicles, ...internalTrailers]);
  const readyAssets = $derived(rollingAssets.filter((a) => a.status === 'AVAILABLE').length);
  const maintainedAssets = $derived(rollingAssets.filter((a) => a.status === 'MAINTENANCE').length);
  const inServiceAssets = $derived(rollingAssets.filter((a) => a.status === 'IN_SERVICE').length);
  const retiredAssets = $derived(rollingAssets.filter((a) => a.status === 'RETIRED').length);
  const complianceAttention = $derived(
    overview ? [...overview.complianceExpired, ...overview.complianceExpiring] : [],
  );

  function fmtDate(d: string | null): string {
    return formatDate(d);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [ov, veh, trl, drv] = await Promise.all([
        api<Overview>('/fleet/overview'),
        api<Paginated<Asset>>('/fleet/data/vehicles', { query: { pageSize: 100 } }),
        api<Paginated<Asset>>('/fleet/data/trailers', { query: { pageSize: 100 } }),
        api<Paginated<Driver>>('/fleet/data/drivers', { query: { pageSize: 100 } }),
      ]);
      rosterPartial =
        veh.total > veh.items.length ||
        trl.total > trl.items.length ||
        drv.total > drv.items.length;
      overview = ov;
      vehicles = veh.items;
      trailers = trl.items;
      drivers = drv.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger la flotte';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Flotte et équipements"
  subtitle="Disponibilité, conformité et interventions à planifier."
>
  {#snippet actions()}<Button variant="secondary" href="/fleet/maintenance">Maintenance</Button
    ><Button href="/fleet">Gérer la flotte</Button>{/snippet}
</PageHeader>

{#if error}<ErrorNotice message={error} onretry={load} />{/if}

{#if rosterPartial}<p class="mb-3 text-xs text-ink-muted">
    Disponibilité calculée sur les 100 premiers résultats de chaque catégorie. Consultez la flotte
    pour la liste complète.
  </p>{/if}

<section class="mb-5 rounded-card border border-edge bg-surface p-4 shadow-sm">
  <div class="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Disponibles</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : readyAssets}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Maintenance</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : maintainedAssets}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Conformité</p>
      <p class="mt-1 text-2xl font-semibold text-ink">
        {loading ? '—' : complianceAttention.length}
      </p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Chauffeurs</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : internalDrivers.length}</p>
    </div>
  </div>
</section>

{#if loading}
  <div class="grid gap-4 lg:grid-cols-3">
    {#each Array(3) as _, i (i)}<Card><Skeleton /></Card>{/each}
  </div>
{:else}
  <div class="min-w-0">
    <div class="space-y-4">
      <div class="grid gap-4 md:grid-cols-3">
        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Équipements</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Parc de véhicules</h2>
          <div class="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div class="rounded-inner bg-surface-muted p-2">
              <strong>{internalVehicles.length}</strong><span class="block text-xs text-ink-faint"
                >Véhicules</span
              >
            </div>
            <div class="rounded-inner bg-surface-muted p-2">
              <strong>{internalTrailers.length}</strong><span class="block text-xs text-ink-faint"
                >Remorques</span
              >
            </div>
            <div class="rounded-inner bg-surface-muted p-2">
              <strong>{internalDrivers.length}</strong><span class="block text-xs text-ink-faint"
                >Chauffeurs</span
              >
            </div>
          </div>
          <a
            href="/fleet"
            class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
            >Voir les équipements →</a
          >
        </Card>

        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Maintenance</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Interventions</h2>
          <div
            class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm"
          >
            <span class="text-ink-muted">Bons de maintenance ouverts</span><span
              class="font-semibold text-ink">{overview?.openWorkOrders ?? 0}</span
            >
          </div>
        </Card>

        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">
            Disponibilité
          </p>
          <h2 class="mt-1 text-lg font-bold text-ink">État de la flotte</h2>
          <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-inner bg-surface-muted p-2">
              <strong class="text-ok">{readyAssets}</strong><span
                class="block text-xs text-ink-faint">Disponibles</span
              >
            </div>
            <div class="rounded-inner bg-surface-muted p-2">
              <strong class="text-info">{inServiceAssets}</strong><span
                class="block text-xs text-ink-faint">En service</span
              >
            </div>
            <div class="rounded-inner bg-surface-muted p-2">
              <strong class="text-warn">{maintainedAssets}</strong><span
                class="block text-xs text-ink-faint">Maintenance</span
              >
            </div>
            <div class="rounded-inner bg-surface-muted p-2">
              <strong class="text-ink-muted">{retiredAssets}</strong><span
                class="block text-xs text-ink-faint">Retirés</span
              >
            </div>
          </div>
          <a
            href="/fleet"
            class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
            >Gérer la flotte →</a
          >
        </Card>
      </div>

      <div id="attention">
        <Card padded={false}>
          <div class="border-b border-edge-soft px-4 py-3">
            <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">À traiter</p>
            <h2 class="mt-1 text-base font-bold text-ink">Conformité et maintenance à traiter</h2>
          </div>
          {#if complianceAttention.length === 0 && (overview?.maintenanceDue.length ?? 0) === 0}
            <EmptyState message="Aucune intervention à signaler." />
          {:else}
            <div class="divide-y divide-edge-soft">
              {#each complianceAttention as doc (doc.id)}
                <div class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Badge tone={doc.status === 'EXPIRED' ? 'danger' : 'warn'}>{doc.status}</Badge>
                  <span class="font-medium text-ink">{doc.docType}</span>
                  <a
                    class="text-accent hover:underline"
                    href={`/fleet/${doc.subjectType === 'VEHICLE' ? 'vehicles' : doc.subjectType === 'TRAILER' ? 'trailers' : 'drivers'}/${doc.subjectId}`}
                    >Ouvrir la fiche</a
                  >
                  <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
                </div>
              {/each}
              {#each overview?.maintenanceDue ?? [] as order (order.id)}
                <div class="flex items-center gap-3 px-4 py-3 text-sm">
                  <Badge tone="warn">MAINTENANCE</Badge>
                  <span class="font-medium text-ink">{order.description}</span>
                  <span class="ml-auto text-ink-muted">échéance {fmtDate(order.dueDate)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </Card>
      </div>
    </div>
  </div>
{/if}
