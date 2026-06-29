<script lang="ts">
  // Fleet Control Room — deep operational tool answering "are my assets ready?".
  // Reads-only rollups from /fleet/overview + the asset rosters (status carried in
  // the list payload), plus open maintenance work orders and expiring/expired
  // compliance documents. A contextual fleet-maintenance AI agent rides in the
  // right rail. Mirrors the patterns of /fleet and /fleet/maintenance exactly.
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
    type Tone,
  } from '$lib/components/ui';
  import AgentPanel from '$lib/components/AgentPanel.svelte';

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
    vehicleId: string | null;
    trailerId: string | null;
    type: string;
    status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    description: string;
    dueDate: string | null;
    openedAt: string;
    completedAt: string | null;
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

  let overview = $state<Overview | null>(null);
  let vehicles = $state<Asset[]>([]);
  let trailers = $state<Asset[]>([]);
  let openOrders = $state<MaintenanceOrder[]>([]);
  let inProgressOrders = $state<MaintenanceOrder[]>([]);
  let loading = $state(true);
  let error = $state('');

  function fmtDate(d: string | null): string {
    return d ? new Date(d).toLocaleDateString() : '—';
  }

  // AssetStatus → tone (mirrors /fleet).
  function assetTone(status: string): Tone {
    switch (status) {
      case 'AVAILABLE':
        return 'ok';
      case 'IN_SERVICE':
        return 'info';
      case 'MAINTENANCE':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  function woStatusTone(s: string): Tone {
    return s === 'COMPLETED'
      ? 'ok'
      : s === 'IN_PROGRESS'
        ? 'info'
        : s === 'CANCELLED'
          ? 'neutral'
          : 'warn';
  }
  function woStatusLabel(s: string): string {
    switch (s) {
      case 'OPEN':
        return 'Ouvert';
      case 'IN_PROGRESS':
        return 'En cours';
      case 'COMPLETED':
        return 'Terminé';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return s;
    }
  }
  function woTypeLabel(t: string): string {
    switch (t) {
      case 'PREVENTIVE':
        return 'Préventif';
      case 'REPAIR':
        return 'Réparation';
      case 'INSPECTION':
        return 'Inspection';
      default:
        return t;
    }
  }

  function complianceTone(status: string): Tone {
    return status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warn' : 'ok';
  }
  function subjectLabel(t: string): string {
    return t === 'VEHICLE' ? 'véhicule' : t === 'TRAILER' ? 'remorque' : 'chauffeur';
  }

  // Days-to-expiry: negative = expired (overdue), positive = remaining.
  function daysToExpiry(iso: string): number {
    return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  }
  function expiryLabel(iso: string): string {
    const d = daysToExpiry(iso);
    if (d < 0) return `expiré depuis ${Math.abs(d)} j`;
    if (d === 0) return "expire aujourd'hui";
    return `dans ${d} j`;
  }

  // --- Asset readiness (derived from the rosters, which carry `status`) --------
  const allAssets = $derived([...vehicles, ...trailers]);
  const totalAssets = $derived(allAssets.length);
  const availableAssets = $derived(allAssets.filter((a) => a.status === 'AVAILABLE').length);
  const inServiceAssets = $derived(allAssets.filter((a) => a.status === 'IN_SERVICE').length);
  const maintenanceAssets = $derived(allAssets.filter((a) => a.status === 'MAINTENANCE').length);
  const readyPct = $derived(
    totalAssets > 0 ? Math.round(((availableAssets + inServiceAssets) / totalAssets) * 100) : 0,
  );

  const expiringCount = $derived(overview ? overview.complianceExpiring.length : 0);
  const expiredCount = $derived(overview ? overview.complianceExpired.length : 0);

  // Active work orders (OPEN first, then IN_PROGRESS).
  const activeOrders = $derived([...openOrders, ...inProgressOrders]);

  // Expired first (red), then expiring (amber) — most urgent on top.
  const complianceAttention = $derived(
    overview ? [...overview.complianceExpired, ...overview.complianceExpiring] : [],
  );

  // Asset link + label for a work order (the WO payload carries only the FK id).
  function woAssetHref(wo: MaintenanceOrder): string | null {
    if (wo.vehicleId) return `/fleet/vehicles/${wo.vehicleId}`;
    if (wo.trailerId) return `/fleet/trailers/${wo.trailerId}`;
    return null;
  }
  function woAssetLabel(wo: MaintenanceOrder): string {
    if (wo.vehicleId) return vehicles.find((v) => v.id === wo.vehicleId)?.unitNumber ?? 'Véhicule';
    if (wo.trailerId) return trailers.find((t) => t.id === wo.trailerId)?.unitNumber ?? 'Remorque';
    return '—';
  }
  function woAssetKind(wo: MaintenanceOrder): string {
    return wo.vehicleId ? 'véh.' : wo.trailerId ? 'rem.' : '';
  }
  // Subject (vehicle/trailer) → unit number for compliance rows; drivers keep id.
  function subjectName(doc: ComplianceDoc): string {
    if (doc.subjectType === 'VEHICLE') {
      return vehicles.find((v) => v.id === doc.subjectId)?.unitNumber ?? doc.subjectId.slice(0, 8);
    }
    if (doc.subjectType === 'TRAILER') {
      return trailers.find((t) => t.id === doc.subjectId)?.unitNumber ?? doc.subjectId.slice(0, 8);
    }
    return doc.subjectId.slice(0, 8);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [ov, veh, trl, open, inProgress] = await Promise.all([
        api<Overview>('/fleet/overview'),
        api<Paginated<Asset>>('/transportation/vehicles', { query: { pageSize: 100 } }),
        api<Paginated<Asset>>('/transportation/trailers', { query: { pageSize: 100 } }),
        api<MaintenanceOrder[]>('/fleet/maintenance-orders', { query: { status: 'OPEN' } }),
        api<MaintenanceOrder[]>('/fleet/maintenance-orders', { query: { status: 'IN_PROGRESS' } }),
      ]);
      overview = ov;
      vehicles = veh.items;
      trailers = trl.items;
      openOrders = open;
      inProgressOrders = inProgress;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du Control Room';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Control Room flotte — Pulsar</title></svelte:head>

<PageHeader
  eyebrow="Flotte"
  title="Control Room"
  subtitle="Disponibilité des actifs, maintenance en cours et conformité — vos assets sont-ils prêts ?"
>
  {#snippet actions()}
    <Button href="/fleet/maintenance" variant="secondary">Ordres de maintenance</Button>
    <Button href="/fleet">Flotte</Button>
  {/snippet}
</PageHeader>

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each Array(5) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <ErrorNotice message={error} onretry={load} />
{:else if overview}
  <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
    <!-- MAIN COLUMN -->
    <div class="min-w-0 space-y-5">
      <!-- A. KPI cards -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <div class="text-xs font-medium text-ink-muted">Actifs totaux</div>
          <div class="mt-1 text-3xl font-bold text-ink">{totalAssets}</div>
          <div class="mt-0.5 text-xs text-ink-faint">véhicules + remorques</div>
        </Card>
        <Card>
          <div class="text-xs font-medium text-ink-muted">Disponibles</div>
          <div class="mt-1 text-3xl font-bold text-accent">{availableAssets}</div>
          <div class="mt-0.5 text-xs text-ink-faint">prêts à partir</div>
        </Card>
        <Card>
          <div class="text-xs font-medium text-warn">En maintenance</div>
          <div class="mt-1 text-3xl font-bold text-warn">{maintenanceAssets}</div>
          <div class="mt-0.5 text-xs text-ink-faint">immobilisés</div>
        </Card>
        <Card>
          <div class="text-xs font-medium text-ink-muted">Work orders ouverts</div>
          <div class="mt-1 text-3xl font-bold text-ink">{overview.openWorkOrders}</div>
          <div class="mt-0.5 text-xs text-ink-faint">à traiter</div>
        </Card>
        <Card>
          <div class="text-xs font-medium text-danger">Conformité</div>
          <div class="mt-1 text-3xl font-bold text-danger">{expiredCount}</div>
          <div class="mt-0.5 text-xs text-ink-faint">
            {expiredCount} expirée(s) · {expiringCount} expirante(s)
          </div>
        </Card>
      </div>

      <!-- B. Asset readiness -->
      <div>
        <h2 class="mb-2 text-sm font-semibold text-ink">Disponibilité des actifs</h2>
        <Card>
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm text-ink-muted">Taux de disponibilité</span>
            <span class="text-2xl font-bold text-ink">{readyPct}%</span>
          </div>
          <div class="mt-2 h-2.5 w-full overflow-hidden rounded-inner bg-surface-muted">
            <div class="h-full bg-accent" style={`width: ${readyPct}%`}></div>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="rounded-inner border border-edge-soft bg-surface-muted px-3 py-2">
              <div class="text-xs text-ink-muted">Disponibles</div>
              <div class="text-lg font-semibold text-ink">{availableAssets}</div>
            </div>
            <div class="rounded-inner border border-edge-soft bg-surface-muted px-3 py-2">
              <div class="text-xs text-ink-muted">En service</div>
              <div class="text-lg font-semibold text-ink">{inServiceAssets}</div>
            </div>
            <div class="rounded-inner border border-edge-soft bg-surface-muted px-3 py-2">
              <div class="text-xs text-ink-muted">En maintenance</div>
              <div class="text-lg font-semibold text-ink">{maintenanceAssets}</div>
            </div>
            <div class="rounded-inner border border-edge-soft bg-surface-muted px-3 py-2">
              <div class="text-xs text-ink-muted">Total</div>
              <div class="text-lg font-semibold text-ink">{totalAssets}</div>
            </div>
          </div>
        </Card>
      </div>

      <!-- C. Open maintenance work orders -->
      <div>
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-sm font-semibold text-ink">Ordres de maintenance actifs</h2>
          {#if activeOrders.length > 0}<Badge tone="warn">{activeOrders.length}</Badge>{/if}
        </div>
        <Card padded={false}>
          {#if activeOrders.length === 0}
            <EmptyState message="Aucun ordre de maintenance actif. La flotte tourne.">
              {#snippet children()}
                <Button href="/fleet/maintenance" variant="secondary">Voir tous les ordres</Button>
              {/snippet}
            </EmptyState>
          {:else}
            <div class="divide-y divide-edge">
              {#each activeOrders as wo (wo.id)}
                <div class="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <Badge tone={woStatusTone(wo.status)}>{woStatusLabel(wo.status)}</Badge>
                  {#if woAssetHref(wo)}
                    <a class="font-medium text-accent hover:underline" href={woAssetHref(wo)}>
                      {woAssetLabel(wo)}
                    </a>
                    <span class="text-xs text-ink-faint">{woAssetKind(wo)}</span>
                  {:else}
                    <span class="font-medium text-ink-muted">—</span>
                  {/if}
                  <span class="text-ink-muted">{woTypeLabel(wo.type)}</span>
                  <span class="hidden truncate text-ink-faint sm:inline">{wo.description}</span>
                  <span class="ml-auto text-xs text-ink-muted">
                    {#if wo.dueDate}échéance {fmtDate(wo.dueDate)}{:else}ouvert {fmtDate(wo.openedAt)}{/if}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </Card>
      </div>

      <!-- D. Compliance expiring / expired -->
      <div>
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-sm font-semibold text-ink">Conformité à surveiller</h2>
          {#if expiredCount > 0}<Badge tone="danger">{expiredCount} expirée(s)</Badge>{/if}
          {#if expiringCount > 0}<Badge tone="warn">{expiringCount} expirante(s)</Badge>{/if}
        </div>
        <Card padded={false}>
          {#if complianceAttention.length === 0}
            <EmptyState message="Aucun document à surveiller. La conformité est à jour." />
          {:else}
            <div class="divide-y divide-edge">
              {#each complianceAttention as doc (doc.id)}
                <div
                  class={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm ${doc.status === 'EXPIRED' ? 'bg-danger-soft' : ''}`}
                >
                  <Badge tone={complianceTone(doc.status)}>{doc.status}</Badge>
                  <span class="font-medium text-ink">{doc.docType}</span>
                  <span class="text-ink-muted">
                    {subjectLabel(doc.subjectType)} · {subjectName(doc)}
                  </span>
                  {#if doc.reference}<span class="text-ink-faint">{doc.reference}</span>{/if}
                  <span
                    class={`ml-auto text-xs ${doc.status === 'EXPIRED' ? 'font-semibold text-danger' : 'text-ink-muted'}`}
                  >
                    {expiryLabel(doc.expiresAt)} · {fmtDate(doc.expiresAt)}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </Card>
      </div>
    </div>

    <!-- RIGHT RAIL — contextual AI agent -->
    <div class="h-[560px]">
      <AgentPanel
        presetId="fleet-maintenance"
        title="Agent de maintenance IA"
        intro="Demandez l'état des actifs, l'ouverture d'un ordre de travail ou un point sur la conformité — l'agent propose, vous approuvez."
      />
    </div>
  </div>
{/if}
