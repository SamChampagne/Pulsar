<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
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
    carrierId: string | null;
  }

  let overview = $state<Overview | null>(null);
  let vehicles = $state<Asset[]>([]);
  let trailers = $state<Asset[]>([]);
  let drivers = $state<Driver[]>([]);
  let loading = $state(true);
  let error = $state('');

  const internalVehicles = $derived(vehicles.filter((v) => v.carrierId === null));
  const internalTrailers = $derived(trailers.filter((t) => t.carrierId === null));
  const internalDrivers = $derived(drivers.filter((d) => d.carrierId === null));
  const availableVehicles = $derived(internalVehicles.filter((v) => v.status === 'AVAILABLE').length);
  const maintenanceVehicles = $derived(internalVehicles.filter((v) => v.status === 'MAINTENANCE').length);
  const complianceAttention = $derived(
    overview ? [...overview.complianceExpired, ...overview.complianceExpiring] : [],
  );
  const blockers = $derived(
    (overview?.openWorkOrders ?? 0) + (overview?.maintenanceDue.length ?? 0) + (overview?.complianceExpired.length ?? 0),
  );

  function complianceTone(status: string): Tone {
    return status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warn' : 'ok';
  }

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
      error = e instanceof ApiError ? e.message : 'Failed to load assets';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Assets / Fleet"
  subtitle="Le module qui contrôle les actifs physiques de l’entreprise : disponibilité, maintenance, conformité, coûts et assignations."
/>

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if overview}
  <section class="mb-5 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
    <div class="grid gap-5 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:p-6">
      <div>
        <p class="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">Asset operating system</p>
        <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
          Assets n’est pas juste la flotte du TMS : c’est l’inventaire vivant des ressources physiques.
        </h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
          Les véhicules, remorques, équipements, outils et machines doivent pouvoir être assignés à un transport,
          un projet, un site, un employé ou une maintenance — avec audit, documents et agents communs.
        </p>
      </div>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
          <p class="text-xs text-white/55">Actifs internes</p>
          <p class="mt-1 text-2xl font-semibold">{internalVehicles.length + internalTrailers.length}</p>
        </div>
        <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
          <p class="text-xs text-white/55">Drivers</p>
          <p class="mt-1 text-2xl font-semibold">{internalDrivers.length}</p>
        </div>
        <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
          <p class="text-xs text-white/55">Disponibles</p>
          <p class="mt-1 text-2xl font-semibold">{availableVehicles}</p>
        </div>
        <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
          <p class="text-xs text-white/55">Bloqueurs</p>
          <p class="mt-1 text-2xl font-semibold">{blockers}</p>
        </div>
      </div>
    </div>
  </section>

  <div class="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <Card>
      <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Readiness</p>
      <p class="mt-2 text-3xl font-bold text-ink">{availableVehicles}</p>
      <p class="mt-1 text-sm text-ink-muted">véhicules disponibles maintenant</p>
    </Card>
    <Card>
      <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Maintenance</p>
      <p class="mt-2 text-3xl font-bold text-ink">{maintenanceVehicles + overview.maintenanceDue.length}</p>
      <p class="mt-1 text-sm text-ink-muted">unités en maintenance ou due bientôt</p>
    </Card>
    <Card>
      <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Compliance</p>
      <p class="mt-2 text-3xl font-bold text-ink">{complianceAttention.length}</p>
      <p class="mt-1 text-sm text-ink-muted">documents expirés ou à renouveler</p>
    </Card>
    <Card>
      <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Assignment graph</p>
      <p class="mt-2 text-3xl font-bold text-ink">Next</p>
      <p class="mt-1 text-sm text-ink-muted">lier actifs à transports, projets, sites et employés</p>
    </Card>
  </div>

  <div class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
    <Card>
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Workflows du module</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Un vrai domaine Assets</h2>
          <p class="mt-2 text-sm leading-6 text-ink-muted">
            Ce module doit fonctionner pour une compagnie de transport, construction, services terrain ou distribution.
            Le TMS peut utiliser ces ressources, mais ne doit pas définir tout le module.
          </p>
        </div>
        <Badge tone="info">LSOS app</Badge>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <a href="/fleet" class="rounded-inner border border-edge-soft bg-surface-muted p-3 hover:border-accent">
          <p class="font-semibold text-ink">Fleet roster</p>
          <p class="mt-1 text-sm text-ink-muted">véhicules, remorques, drivers et statuts opérationnels</p>
        </a>
        <a href="/fleet#compliance" class="rounded-inner border border-edge-soft bg-surface-muted p-3 hover:border-accent">
          <p class="font-semibold text-ink">Maintenance & compliance</p>
          <p class="mt-1 text-sm text-ink-muted">work orders, documents expirés, inspections et preuves</p>
        </a>
        <div class="rounded-inner border border-dashed border-edge bg-surface p-3">
          <p class="font-semibold text-ink">Equipment & tools</p>
          <p class="mt-1 text-sm text-ink-muted">future extension pour machines, outils, IT assets et kits terrain</p>
        </div>
        <div class="rounded-inner border border-dashed border-edge bg-surface p-3">
          <p class="font-semibold text-ink">Lifecycle cost</p>
          <p class="mt-1 text-sm text-ink-muted">coûts, amortissement, incidents et décision remplacer/réparer</p>
        </div>
      </div>
    </Card>

    <Card>
      <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Agent lane</p>
      <h2 class="mt-1 text-lg font-bold text-ink">Assets operator agent</h2>
      <p class="mt-2 text-sm leading-6 text-ink-muted">
        L’agent doit surveiller documents, maintenance, assignabilité et coûts, puis proposer des actions gouvernées.
      </p>
      <div class="mt-4 space-y-2 text-sm">
        <div class="rounded-inner border border-edge-soft bg-surface-muted p-3">
          <span class="font-medium text-ink">ProposeAction</span>
          <span class="text-ink-muted"> · renouveler document expirant</span>
        </div>
        <div class="rounded-inner border border-edge-soft bg-surface-muted p-3">
          <span class="font-medium text-ink">ProposeAction</span>
          <span class="text-ink-muted"> · bloquer une assignation non conforme</span>
        </div>
        <div class="rounded-inner border border-edge-soft bg-surface-muted p-3">
          <span class="font-medium text-ink">ProposeAction</span>
          <span class="text-ink-muted"> · créer work order maintenance</span>
        </div>
      </div>
    </Card>
  </div>

  <div class="mt-5">
    <Card padded={false}>
      <div class="border-b border-edge px-4 py-3">
        <h2 class="text-base font-bold text-ink">Compliance attention</h2>
        <p class="mt-1 text-sm text-ink-muted">Preuves et documents qui empêchent une ressource d’être assignable.</p>
      </div>
      {#if complianceAttention.length === 0}
        <EmptyState message="Aucun document à surveiller pour le tenant seed actuel." />
      {:else}
        <div class="divide-y divide-edge">
          {#each complianceAttention as doc (doc.id)}
            <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone={complianceTone(doc.status)}>{doc.status}</Badge>
              <span class="font-medium text-ink">{doc.docType}</span>
              <span class="text-ink-muted">{doc.subjectType.toLowerCase()} · {doc.subjectId}</span>
              {#if doc.reference}<span class="text-ink-faint">{doc.reference}</span>{/if}
              <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{/if}
