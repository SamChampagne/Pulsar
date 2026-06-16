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
  subtitle="Le module qui protège la disponibilité physique: véhicules, remorques, chauffeurs, conformité, maintenance et readiness."
/>

{#if error}<ErrorNotice message={error} onretry={load} />{/if}

<section class="mb-5 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
  <div class="grid gap-5 p-5 lg:grid-cols-[1.12fr_0.88fr] lg:p-6">
    <div>
      <p class="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">{universe.signal}</p>
      <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
        Assets n’est pas une liste de trucks — c’est la couche readiness de l’entreprise.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
        Le module garde la vérité sur ce qui peut être assigné, ce qui doit être inspecté, ce qui bloque une opération
        et ce que l’agent maintenance doit préparer avant que Transport ou Yard en ait besoin.
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        {#each universe.workflows as flow (flow)}
          <span class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/15">{flow}</span>
        {/each}
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Ready assets</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : readyAssets}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Maintenance</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : maintainedAssets}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Compliance risk</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : complianceAttention.length}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Drivers</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : internalDrivers.length}</p>
      </div>
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
          <p class="mt-2 text-sm leading-6 text-ink-muted">Véhicules, remorques et chauffeurs internes deviennent des objets de capacité, pas seulement du master data.</p>
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
          <p class="mt-2 text-sm leading-6 text-ink-muted">Les actifs passent dans un workflow: inspecter, réparer, remettre disponible, prouver la conformité.</p>
          <div class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm">
            <span class="text-ink-muted">Open work orders</span><span class="font-semibold text-ink">{overview?.openWorkOrders ?? 0}</span>
          </div>
        </Card>

        <Card>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Assignment graph</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Capacity links</h2>
          <p class="mt-2 text-sm leading-6 text-ink-muted">Prochaine profondeur: relier assets ⇄ loads ⇄ yard spots ⇄ maintenance windows.</p>
          <div class="mt-4 rounded-inner border border-edge-soft bg-surface-muted p-3 text-xs leading-5 text-ink-muted">
            Transport reçoit seulement les actifs prêts; Yard sait quelles remorques peuvent être spotées; Finance voit le coût par actif.
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div class="border-b border-edge-soft px-4 py-3">
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Attention lane</p>
          <h2 class="mt-1 text-base font-bold text-ink">Compliance & maintenance blockers</h2>
        </div>
        {#if complianceAttention.length === 0 && (overview?.maintenanceDue.length ?? 0) === 0}
          <EmptyState message="Aucun blocker assets dans les données actuelles. La home garde quand même le contexte module prêt pour des données plus riches." />
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

    <div class="space-y-4">
      <Card>
        <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Assigned employee</p>
        <h2 class="mt-1 text-lg font-bold text-ink">{universe.agent}</h2>
        <p class="mt-3 text-sm leading-6 text-ink-muted">
          Surveille les expirations, prépare les inspections, propose les immobilisations et empêche un dispatch d’utiliser un actif non prêt.
        </p>
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
