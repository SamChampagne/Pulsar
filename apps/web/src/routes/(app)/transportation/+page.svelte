<script lang="ts">
  // Accueil Transport — le poste de commande du module Transport.
  // Hub mission/KPI/files de travail, distinct du cockpit /dispatch et de la
  // Load Control Room. Tout est calculé à la lecture depuis les endpoints
  // existants (active-map, backlog non assigné, ordres, exceptions opérationnelles).
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import type { Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Skeleton,
  } from '$lib/components/ui';
  import AgentPanel from '$lib/components/AgentPanel.svelte';

  // ──────────────────────────────────────────────────────────
  // Types — mirror the source pages exactly.
  // ──────────────────────────────────────────────────────────

  interface MapStop {
    sequence: number;
    type: string;
    status: string;
    name: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
  }
  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: MapStop[];
  }

  interface BacklogShipment {
    id: string;
    shipmentNumber: string;
    status: string;
  }

  interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
  }

  interface OperationalTask {
    id: string;
    type: string;
    category: string;
    status: string;
    severity: string;
    title: string;
    createdAt: string;
    caseNumber: string | null;
  }

  // Transport-relevant exception categories (subset of the workbench enum).
  const TRANSPORT_CATEGORIES = ['DELAY', 'TENDER_FAILURE'] as const;

  // Open transport-order statuses = anything not terminal.
  const CLOSED_ORDER_STATUSES = ['CLOSED', 'CANCELLED'];

  // ──────────────────────────────────────────────────────────
  // Data state
  // ──────────────────────────────────────────────────────────

  let loads = $state<MapLoad[]>([]);
  let unassignedTotal = $state(0);
  let openOrdersTotal = $state(0);
  let exceptions = $state<OperationalTask[]>([]);
  let loading = $state(true);
  let error = $state('');

  // ──────────────────────────────────────────────────────────
  // Derived KPIs
  // ──────────────────────────────────────────────────────────

  const inFlightCount = $derived(loads.length);
  const lateLoads = $derived(loads.filter((l) => l.isLate));
  const lateCount = $derived(lateLoads.length);
  const openExceptions = $derived(exceptions.filter((t) => t.status === 'OPEN'));
  const exceptionCount = $derived(openExceptions.length);

  function routeLabel(l: MapLoad): string {
    if (l.stops.length === 0) return '—';
    const origin = l.stops[0]?.city || l.stops[0]?.name || '?';
    const dest = l.stops[l.stops.length - 1]?.city || l.stops[l.stops.length - 1]?.name || '?';
    return `${origin} → ${dest}`;
  }

  // Prioritized work queue: late loads first, then open transport exceptions.
  interface WorkItem {
    tone: 'danger' | 'warn';
    kind: string;
    label: string;
    detail: string;
    href: string;
  }
  const worklist = $derived.by(() => {
    const items: WorkItem[] = [];
    for (const l of lateLoads) {
      items.push({
        tone: 'danger',
        kind: 'Retard',
        label: `Chargement ${l.loadNumber}`,
        detail: `${routeLabel(l)}${l.carrier ? ` · ${l.carrier}` : ''}`,
        href: '/loads/control-room',
      });
    }
    for (const t of openExceptions) {
      items.push({
        tone: 'warn',
        kind: t.category === 'TENDER_FAILURE' ? 'Appel d’offres' : 'Exception',
        label: t.caseNumber ? `${t.caseNumber} — ${t.title}` : t.title,
        detail: t.severity,
        href: '/transportation/exceptions',
      });
    }
    return items.slice(0, 6);
  });

  // ──────────────────────────────────────────────────────────
  // KPI card definitions (clickable, route to the right surface)
  // ──────────────────────────────────────────────────────────

  const kpis = $derived([
    {
      label: 'Chargements en vol',
      value: inFlightCount,
      hint: 'Tournées actives sur la route.',
      href: '/loads/control-room',
      danger: false,
    },
    {
      label: 'En retard',
      value: lateCount,
      hint: 'Chargements en retard à surveiller.',
      href: '/loads/control-room',
      danger: lateCount > 0,
    },
    {
      label: 'Shipments non assignés',
      value: unassignedTotal,
      hint: 'En attente d’un chargement.',
      href: '/dispatch',
      danger: false,
    },
    {
      label: 'Ordres ouverts',
      value: openOrdersTotal,
      hint: 'Commandes de transport en cours.',
      href: '/transport-orders',
      danger: false,
    },
    {
      label: 'Exceptions ouvertes',
      value: exceptionCount,
      hint: 'Retards & échecs d’appels d’offres.',
      href: '/transportation/exceptions',
      danger: exceptionCount > 0,
    },
  ]);

  // ──────────────────────────────────────────────────────────
  // Postes & registres quick-links
  // ──────────────────────────────────────────────────────────

  const registries = [
    {
      href: '/dispatch',
      title: 'Dispatch Cockpit',
      role: 'Construisez les chargements depuis le backlog non assigné.',
    },
    {
      href: '/loads/control-room',
      title: 'Load Control Room',
      role: 'Suivez en temps réel les chargements en vol sur la carte.',
    },
    {
      href: '/transportation/exceptions',
      title: 'Bureau des exceptions',
      role: 'Triez retards et échecs d’appels d’offres.',
    },
    {
      href: '/planning',
      title: 'Planning Board',
      role: 'Planifiez les tournées et les fenêtres de service.',
    },
    {
      href: '/rate-studio',
      title: 'Rate Studio',
      role: 'Gérez grilles tarifaires et lanes transporteurs.',
    },
    {
      href: '/loads',
      title: 'Chargements',
      role: 'Registre complet des chargements et de leur coût.',
    },
    {
      href: '/shipments',
      title: 'Expéditions',
      role: 'Toutes les expéditions et leur statut.',
    },
    {
      href: '/transport-orders',
      title: 'Ordres',
      role: 'Commandes de transport, du brouillon à la clôture.',
    },
  ];

  // ──────────────────────────────────────────────────────────
  // Data loading — parallel, tolerant of individual failures.
  // ──────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const [activeMap, backlog, orders] = await Promise.all([
        api<MapLoad[]>('/transportation/loads/active-map'),
        api<Paginated<BacklogShipment>>('/transportation/shipments', {
          query: { unassigned: 'true', pageSize: 100 },
        }),
        api<Paginated<OrderRow>>('/transportation/transport-orders', {
          query: { page: 1, pageSize: 100 },
        }),
      ]);
      loads = activeMap;
      unassignedTotal = backlog.total;
      // Open orders = total minus terminal-status orders on this page.
      const closedOnPage = orders.items.filter((o) =>
        CLOSED_ORDER_STATUSES.includes(o.status),
      ).length;
      openOrdersTotal = Math.max(0, orders.total - closedOnPage);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement de l’accueil transport impossible.';
    } finally {
      loading = false;
    }

    // Exceptions are best-effort: a 403 on /operational-tasks must not blank
    // the page — wrap in its own try/catch and default to an empty list.
    try {
      const result = await api<Paginated<OperationalTask>>('/operational-tasks', {
        query: { status: 'OPEN', pageSize: 100 },
      });
      exceptions = result.items.filter((t) =>
        (TRANSPORT_CATEGORIES as readonly string[]).includes(t.category),
      );
    } catch {
      exceptions = [];
    }
  }

  onMount(() => {
    void load();
  });
</script>

<PageHeader
  title="Accueil Transport"
  eyebrow="Transport / Operations"
  subtitle="Votre poste de commande logistique : ce qui roule, ce qui attend, et où agir."
  count={inFlightCount}
>
  {#snippet actions()}
    <Button href="/dispatch">Ouvrir le Dispatch</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<!-- A. KPI cards (clickable) -->
{#if loading}
  <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    {#each Array(5) as _, i (i)}<Card><Skeleton /></Card>{/each}
  </div>
{:else}
  <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    {#each kpis as kpi (kpi.label)}
      <a href={kpi.href} class="block">
        <Card>
          <p class={`text-xs font-medium ${kpi.danger ? 'text-danger' : 'text-ink-muted'}`}>
            {kpi.label}
          </p>
          <p class={`mt-1 text-3xl font-bold ${kpi.danger ? 'text-danger' : 'text-ink'}`}>
            {kpi.value}
          </p>
          <p class="mt-1 text-xs text-ink-faint">{kpi.hint}</p>
        </Card>
      </a>
    {/each}
  </div>
{/if}

<!-- Two-column layout: work queue + registries on the left, dispatcher AI rail -->
<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
  <div class="flex flex-col gap-5">
    <!-- B. Files de travail — prioritized: late loads then open exceptions -->
    <section>
      <Card padded={false}>
        <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
          <h2 class="text-base font-bold text-ink">Files de travail</h2>
          <Badge tone={worklist.some((w) => w.tone === 'danger') ? 'danger' : worklist.length ? 'warn' : 'ok'}>
            {worklist.length}
          </Badge>
        </div>
        {#if loading}
          <div class="p-4"><Skeleton rows={4} /></div>
        {:else if worklist.length === 0}
          <EmptyState
            title="Tout est sous contrôle"
            message="Aucun retard ni exception ouverte. Surveillez l’activité dans la Load Control Room ou le Dispatch."
          />
        {:else}
          <div class="divide-y divide-edge-soft">
            {#each worklist as item (item.kind + item.label)}
              <a
                href={item.href}
                class="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-surface-muted"
              >
                <Badge tone={item.tone}>{item.kind}</Badge>
                <span class="min-w-0 truncate font-medium text-ink">{item.label}</span>
                <span class="ml-auto shrink-0 text-xs text-ink-muted">{item.detail}</span>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    </section>

    <!-- C. Postes & registres -->
    <section>
      <h2 class="mb-2 text-sm font-semibold text-ink">Postes &amp; registres</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each registries as reg (reg.href)}
          <a href={reg.href} class="block">
            <Card>
              <p class="text-sm font-semibold text-ink">{reg.title}</p>
              <p class="mt-1 text-xs text-ink-muted">{reg.role}</p>
            </Card>
          </a>
        {/each}
      </div>
    </section>
  </div>

  <!-- D. Right rail: dispatcher AI employee -->
  <div class="h-[480px]">
    <AgentPanel
      presetId="dispatcher"
      title="Répartiteur IA"
      intro="Demandez au répartiteur un point sur les retards, une réaffectation ou une relance d’appel d’offres — il propose, vous approuvez."
    />
  </div>
</div>
