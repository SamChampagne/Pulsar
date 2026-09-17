<script lang="ts">
  import { PERMISSIONS, type Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    PageHeader,
    Select,
    Skeleton,
    Drawer,
    Input,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import { auth } from '$lib/stores/auth';
  import { CalendarClock, ClipboardCheck, Plus, RefreshCw } from 'lucide-svelte';

  interface Assignment {
    id: string;
    operationId: string;
    orderId: string;
    workCenterId: string;
    setupStart: string;
    start: string;
    end: string;
  }
  interface Run {
    id: string;
    strategy: string;
    solverStatus: string;
    objectiveValue: number;
    wallTimeMs: number;
    orderCount: number;
    operationCount: number;
    assignmentCount: number;
    isBaseline: boolean;
    warnings: string[];
    createdAt: string;
    assignments?: Assignment[];
    timeZone?: string | null;
    replayedFromId?: string | null;
    publishedAt?: string | null;
    horizonStart?: string;
    horizonEnd?: string;
    inputRequest?: {
      snapshot: {
        machines?: { id: string; name: string }[];
        work_orders?: { id: string; name: string; operations: { id: string; name: string }[] }[];
      };
    };
  }
  interface Review {
    runId: string;
    baselineId: string | null;
    timeZone: string;
    canPublish: boolean;
    reviewToken: string;
    blockers: string[];
    assessment: {
      publish_status: 'publishable' | 'review' | 'blocked';
      recommendation: string;
      comparison: {
        metric_delta?: {
          makespan_minutes?: number | null;
          total_lateness_minutes?: number | null;
          on_time_ratio?: number | null;
        };
        stability_report?: {
          changed_operation_count?: number;
          machine_change_count?: number;
          introduced_operation_count?: number;
          removed_operation_count?: number;
        };
      } | null;
    };
  }
  interface WorkCenter {
    id: string;
    code: string;
    name: string;
  }

  let runs = $state<Run[]>([]);
  let selected = $state<Run | null>(null);
  let workCenters = $state<WorkCenter[]>([]);
  let orderNumbers = $state<Record<string, string>>({});
  let opNames = $state<Record<string, string>>({});
  let loading = $state(true);
  let running = $state(false);
  let error = $state('');
  let selecting = $state(false);
  let selectionVersion = 0;
  let settingsOpen = $state(false);
  let runError = $state('');
  let reviewOpen = $state(false);
  let reviewing = $state(false);
  let publishing = $state(false);
  let reviewError = $state('');
  let review = $state<Review | null>(null);
  let reviewRunId = $state('');
  let publicationUncertain = $state(false);
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.MANUFACTURING.MANAGE) ?? false,
  );

  // Run controls
  let strategy = $state('greedy');
  let respectMaterials = $state(false);
  let horizonDays = $state('30');
  let horizonDate = $state(new Date().toISOString().slice(0, 10));
  let timeZone = $state('UTC');

  const PALETTE = [
    '#2563eb',
    '#16a34a',
    '#db2777',
    '#d97706',
    '#7c3aed',
    '#0891b2',
    '#dc2626',
    '#65a30d',
  ];
  function orderColor(orderId: string): string {
    let h = 0;
    for (let i = 0; i < orderId.length; i++) h = (h * 31 + orderId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  const wcName = $derived(
    new Map([
      ...workCenters.map((w) => [w.id, w.name] as const),
      ...(selected?.inputRequest?.snapshot.machines ?? []).map((w) => [w.id, w.name] as const),
    ]),
  );
  const displayZone = $derived(selected?.timeZone ?? 'UTC');
  const formatInstant = (value: string, zone: string) =>
    new Intl.DateTimeFormat('fr-CA', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));

  // The Gantt rows are keyed by work-center id and need the *complete* name map, but the API
  // caps pageSize at 100 (a hard @Max — 200 would 400 the whole request). Page through instead.
  async function loadAllWorkCenters(): Promise<WorkCenter[]> {
    const pageSize = 100;
    const all: WorkCenter[] = [];
    let pageNum = 1;
    // Guard against a runaway loop; 20 pages = 2000 work centers, far beyond any real tenant.
    for (let i = 0; i < 20; i++) {
      const res = await api<Paginated<WorkCenter>>('/manufacturing/work-centers', {
        query: { page: pageNum, pageSize },
      });
      all.push(...res.items);
      if (all.length >= res.total || res.items.length === 0) break;
      pageNum += 1;
    }
    return all;
  }

  async function loadRuns() {
    loading = true;
    error = '';
    try {
      const [runRes, wcAll] = await Promise.all([
        api<Paginated<Run>>('/manufacturing/scheduling/runs', { query: { pageSize: 50 } }),
        loadAllWorkCenters(),
      ]);
      runs = runRes.items;
      workCenters = wcAll;
      if (runs.length > 0 && !selected) await select(runs[0].id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  async function select(id: string) {
    const version = ++selectionVersion;
    selecting = true;
    try {
      const run = await api<Run>(`/manufacturing/scheduling/runs/${id}`);
      if (version !== selectionVersion) return;
      selected = run;
      // Historical labels come from the immutable snapshot, not N+1 live order requests.
      const orders = run.inputRequest?.snapshot.work_orders ?? [];
      orderNumbers = Object.fromEntries(orders.map((o) => [o.id, o.name]));
      opNames = Object.fromEntries(
        orders.flatMap((o) => o.operations.map((op) => [op.id, op.name])),
      );
    } catch (e) {
      if (version === selectionVersion)
        toast.error(e instanceof ApiError ? e.message : 'Scénario indisponible');
    } finally {
      if (version === selectionVersion) selecting = false;
    }
  }

  async function runSchedule() {
    if (running || !canManage) return;
    runError = '';
    if (
      !Number.isInteger(Number(horizonDays)) ||
      Number(horizonDays) < 1 ||
      Number(horizonDays) > 365
    ) {
      runError = 'Choisissez un horizon de 1 à 365 jours.';
      return;
    }
    running = true;
    try {
      const run = await api<Run>('/manufacturing/scheduling/run', {
        method: 'POST',
        body: {
          strategy,
          horizonDays: Number(horizonDays),
          horizonDate,
          timeZone,
          ...(respectMaterials ? { respectMaterials: true } : {}),
        },
      });
      toast.success(`Planification ${run.solverStatus} — ${run.assignmentCount} affectations`);
      settingsOpen = false;
      await loadRuns();
      await select(run.id);
    } catch (e) {
      runError =
        e instanceof ApiError
          ? e.message
          : 'Échec de la planification. Consultez l’historique avant de relancer.';
    } finally {
      running = false;
    }
  }

  async function openReview() {
    if (!selected || selecting) return;
    reviewRunId = selected.id;
    reviewOpen = true;
    publicationUncertain = false;
    await loadReview();
  }

  async function loadReview() {
    reviewing = true;
    review = null;
    reviewError = '';
    try {
      // Inspect first after an uncertain write. Never blindly resend a publication.
      const run = await api<Run>(`/manufacturing/scheduling/runs/${reviewRunId}`);
      if (run.isBaseline) {
        reviewOpen = false;
        toast.success('Ce scénario est déjà le plan publié.');
        await loadRuns();
        await select(run.id);
        return;
      }
      review = await api<Review>(`/manufacturing/scheduling/runs/${reviewRunId}/review`);
      publicationUncertain = false;
    } catch (e) {
      reviewError =
        e instanceof ApiError
          ? e.message
          : 'Revue indisponible. Aucune publication n’est autorisée.';
    } finally {
      reviewing = false;
    }
  }

  async function publish() {
    if (!review?.canPublish || publishing || reviewing || publicationUncertain || !canManage)
      return;
    const id = review.runId;
    publishing = true;
    reviewError = '';
    try {
      await api(`/manufacturing/scheduling/runs/${id}/publish`, {
        method: 'POST',
        body: { reviewToken: review.reviewToken },
      });
      reviewOpen = false;
      toast.success('Le scénario est devenu le plan publié.');
      await loadRuns();
      await select(id);
    } catch (e) {
      publicationUncertain = true;
      reviewError = `${e instanceof ApiError ? e.message : 'Réponse de publication incertaine.'} Vérifiez l’état avant toute nouvelle tentative.`;
    } finally {
      publishing = false;
    }
  }

  $effect(() => {
    void loadRuns();
  });

  // --- Gantt geometry --------------------------------------------------------
  interface Bar {
    a: Assignment;
    leftPct: number;
    widthPct: number;
    color: string;
    label: string;
    title: string;
  }
  interface Tick {
    leftPct: number;
    label: string;
  }

  const gantt = $derived.by(() => {
    const a = selected?.assignments ?? [];
    if (a.length === 0)
      return {
        rows: [] as { wcId: string; name: string; bars: Bar[] }[],
        ticks: [] as Tick[],
        empty: true,
      };
    const startMs = Math.min(...a.map((x) => new Date(x.start).getTime()));
    const endMs = Math.max(...a.map((x) => new Date(x.end).getTime()));
    const span = Math.max(endMs - startMs, 60_000);
    const pct = (ms: number) => ((ms - startMs) / span) * 100;

    // Rows: work centers that carry assignments, ordered by name.
    const wcIds = [...new Set(a.map((x) => x.workCenterId))];
    const rows = wcIds
      .map((wcId) => ({
        wcId,
        name: wcName.get(wcId) ?? wcId,
        bars: a
          .filter((x) => x.workCenterId === wcId)
          .map((x): Bar => {
            const s = new Date(x.start).getTime();
            const e = new Date(x.end).getTime();
            const num = orderNumbers[x.orderId] ?? '';
            const op = opNames[x.operationId] ?? 'Opération';
            return {
              a: x,
              leftPct: pct(s),
              widthPct: Math.max(((e - s) / span) * 100, 0.8),
              color: orderColor(x.orderId),
              label: op,
              title: `${num} · ${op}\n${wcName.get(wcId) ?? wcId}\n${formatInstant(x.start, displayZone)} → ${formatInstant(x.end, displayZone)} (${displayZone})`,
            };
          }),
      }))
      .sort((p, q) => p.name.localeCompare(q.name));

    // Even elapsed-time ticks, explicitly formatted in the captured plant timezone.
    // No host-local setDate/setHours assumptions across DST boundaries.
    const ticks: Tick[] = Array.from({ length: 4 }, (_, i) => ({
      leftPct: i * 25,
      label: formatInstant(new Date(startMs + (span * i) / 4).toISOString(), displayZone),
    }));
    return { rows, ticks, empty: false };
  });

  const STRATEGIES = [
    { key: 'greedy', label: 'Rapide — priorité aux échéances' },
    { key: 'backward', label: 'À rebours depuis les échéances' },
    { key: 'hybrid', label: 'Hybride' },
    { key: 'cpsat', label: 'Optimisation sous contraintes (CP-SAT)' },
    { key: 'auto', label: 'Sélection automatique du moteur' },
  ];
  function delta(value: number | null | undefined, ratio = false) {
    if (value == null) return 'Non disponible';
    const v = ratio ? value * 100 : value;
    return `${v > 0 ? '+' : ''}${v.toLocaleString('fr-CA', { maximumFractionDigits: 1 })} ${ratio ? 'points' : 'min'}`;
  }
</script>

<Drawer bind:open={settingsOpen} title="Nouveau scénario" width="lg" dismissible={!running}>
  <div class="space-y-5">
    <p class="text-sm text-ink-muted">
      Les ordres libérés et les calendriers actifs sont capturés ensemble. Le plan publié reste
      inchangé pendant le calcul.
    </p>
    <Field label="Stratégie"
      ><Select bind:value={strategy} disabled={running}>
        {#each STRATEGIES as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
      </Select></Field
    >
    <div class="grid grid-cols-2 gap-3">
      <Field label="Date de début locale"
        ><Input type="date" bind:value={horizonDate} disabled={running} /></Field
      >
      <Field label="Horizon (jours)"
        ><Input
          type="number"
          min={1}
          max={365}
          step={1}
          bind:value={horizonDays}
          disabled={running}
        /></Field
      >
    </div>
    <Field label="Fuseau des calendriers (IANA)"
      ><Input bind:value={timeZone} placeholder="America/Toronto" disabled={running} /></Field
    >
    <p class="text-xs text-ink-muted">
      Exemples : America/Toronto, Europe/Paris, UTC. Tous les calendriers de ce scénario utilisent
      ce même fuseau. Les échéances des ordres restent des instants absolus.
    </p>
    <div class="rounded-md border border-edge bg-surface-muted p-3 text-xs text-ink-muted">
      Les changements d’heure sont pris en compte. Un début ou une fin de quart ambigu ou inexistant
      est refusé, sans ajustement automatique. Les quarts de nuit et les fuseaux distincts par site
      ne sont pas encore pris en charge.
    </div>
    {#if $auth?.user.permissions.includes('wms.read') && $auth?.tenant.enabledModules.includes('wms')}
      <label class="flex items-start gap-2 text-sm"
        ><input type="checkbox" bind:checked={respectMaterials} disabled={running} />Respecter les
        matières : stock du site et arrivages fournisseurs confirmés.</label
      >
      <p class="text-xs text-ink-muted">
        Les arrivages sont disponibles à 00:00 UTC de leur date promise. Les promesses dépassées
        sont exclues. Un changement de stock ou de date exige un nouveau calcul avant publication. <a
          href="/manufacturing/materials"
          class="text-accent hover:underline">Voir les impacts matières →</a
        >
      </p>
    {/if}
    {#if runError}<p role="alert" class="text-sm text-danger">{runError}</p>{/if}
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={running}
      onclick={() => {
        settingsOpen = false;
      }}>Annuler</Button
    >
    <Button variant="primary" loading={running} onclick={runSchedule}>Calculer le scénario</Button>
  {/snippet}
</Drawer>

<Drawer
  bind:open={reviewOpen}
  title="Revue avant publication"
  width="lg"
  dismissible={!publishing && !reviewing}
>
  {#if reviewing}<Skeleton rows={6} />
  {:else if review}
    <div class="space-y-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone={review.canPublish ? 'ok' : 'warn'}
          >{review.canPublish ? 'Prêt à publier' : 'À corriger / recalculer'}</Badge
        >
        <span class="text-xs text-ink-muted"
          >{review.timeZone} · {review.baselineId
            ? 'Comparaison au plan publié'
            : 'Premier plan publié'}</span
        >
      </div>
      <p class="text-sm text-ink-muted">{review.assessment.recommendation}</p>
      {#if review.assessment.comparison}
        {@const d = review.assessment.comparison.metric_delta}
        {@const s = review.assessment.comparison.stability_report}
        <section aria-label="Écarts avec le plan publié">
          <h3 class="mb-2 text-sm font-medium text-ink">Écarts avec le plan publié</h3>
          <dl class="divide-y divide-edge rounded-md border border-edge text-sm">
            <div class="flex justify-between gap-3 p-3">
              <dt class="text-ink-muted">Durée totale</dt>
              <dd class="font-mono">{delta(d?.makespan_minutes)}</dd>
            </div>
            <div class="flex justify-between gap-3 p-3">
              <dt class="text-ink-muted">Retards cumulés</dt>
              <dd class="font-mono">{delta(d?.total_lateness_minutes)}</dd>
            </div>
            <div class="flex justify-between gap-3 p-3">
              <dt class="text-ink-muted">Respect des échéances</dt>
              <dd class="font-mono">{delta(d?.on_time_ratio, true)}</dd>
            </div>
            <div class="flex justify-between gap-3 p-3">
              <dt class="text-ink-muted">Opérations modifiées</dt>
              <dd class="font-mono">{s?.changed_operation_count ?? 'Non disponible'}</dd>
            </div>
            <div class="flex justify-between gap-3 p-3">
              <dt class="text-ink-muted">Changements de poste</dt>
              <dd class="font-mono">{s?.machine_change_count ?? 'Non disponible'}</dd>
            </div>
            <div class="flex justify-between gap-3 p-3">
              <dt class="text-ink-muted">Opérations ajoutées / retirées</dt>
              <dd class="font-mono">
                {s?.introduced_operation_count ?? '—'} / {s?.removed_operation_count ?? '—'}
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-xs text-ink-muted">
            Écarts calculés par PlaniAdvance. Une métrique absente n’est jamais présentée comme
            zéro.
          </p>
        </section>
      {:else}<p class="text-sm text-ink-muted">
          Aucun plan de référence : il n’y a pas encore d’écart à comparer.
        </p>{/if}
      {#each review.blockers as blocker (blocker)}<p
          class="rounded-md border border-warn/30 bg-warn/10 p-3 text-sm text-ink"
        >
          {blocker}
        </p>{/each}
      <p class="text-xs text-ink-muted">
        La confirmation remplace le plan de référence après une nouvelle vérification serveur. Elle
        ne lance aucune opération et ne réserve aucun stock.
      </p>
    </div>
  {/if}
  {#if reviewError}<p role="alert" class="mt-3 text-sm text-danger">{reviewError}</p>{/if}
  {#snippet footer()}
    <Button variant="secondary" disabled={publishing || reviewing} onclick={loadReview}
      ><RefreshCw size={16} />
      {publicationUncertain ? 'Vérifier l’état' : 'Actualiser la revue'}</Button
    >
    {#if canManage}<Button
        variant="primary"
        loading={publishing}
        disabled={!review?.canPublish || reviewing || publicationUncertain}
        onclick={publish}>Confirmer la publication</Button
      >{/if}
  {/snippet}
</Drawer>

<PageHeader title="Planification" eyebrow="Fabrication / APS">
  {#snippet actions()}
    <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
    {#if canManage}<Button
        variant="primary"
        onclick={() => {
          runError = '';
          settingsOpen = true;
        }}><Plus size={16} /> Nouveau scénario</Button
      >{/if}
  {/snippet}
</PageHeader>

<Card>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <CalendarClock size={20} class="text-ink-muted" />
      <div>
        <p class="text-sm font-medium text-ink">Calculer · Comparer · Publier</p>
        <p class="text-xs text-ink-muted">
          Un scénario reste une simulation jusqu’à sa publication. Aucun stock ni transport n’est
          modifié.
        </p>
      </div>
    </div>
    {#if selected && !selected.isBaseline && !selected.replayedFromId && !selected.publishedAt}
      <Button variant="secondary" disabled={selecting} onclick={openReview}
        ><ClipboardCheck size={16} /> Revoir le scénario</Button
      >
    {/if}
  </div>
</Card>

{#if loading}
  <Card><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if runs.length === 0}
  <Card>
    <EmptyState
      message="Aucune planification pour le moment. Libérez un ordre de fabrication puis lancez une planification."
    >
      {#snippet children()}
        {#if canManage}<Button
            variant="primary"
            onclick={() => {
              settingsOpen = true;
            }}>Nouveau scénario</Button
          >{/if}
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
    <!-- Runs list -->
    <Card padded={false}>
      <div class="border-b border-edge px-3 py-2 text-xs font-medium text-ink-muted">
        Scénarios récents · {runs.length} affichés (max. 50)
      </div>
      <ul class="max-h-[28rem] overflow-y-auto">
        {#each runs as r (r.id)}
          <li>
            <button
              class="w-full border-b border-edge px-3 py-2 text-left hover:bg-surface-muted {selected?.id ===
              r.id
                ? 'bg-accent/5'
                : ''}"
              onclick={() => select(r.id)}
              aria-pressed={selected?.id === r.id}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm text-ink"
                  >{formatInstant(r.createdAt, r.timeZone ?? 'UTC')}</span
                >
                {#if r.isBaseline}<Badge tone="ok">Publié</Badge>{/if}
              </div>
              <div class="text-xs text-ink-muted">
                {r.strategy} · {r.assignmentCount} affectations · {r.timeZone ?? 'UTC historique'}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    </Card>

    <!-- Gantt -->
    <Card>
      {#if selecting}
        <Skeleton rows={4} />
      {:else if !selected}
        <p class="text-sm text-ink-muted">Sélectionnez un scénario.</p>
      {:else}
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={selected.solverStatus.toLowerCase().includes('optimal') ? 'ok' : 'info'}>
            {selected.solverStatus}
          </Badge>
          <span class="text-ink-muted"
            >stratégie <span class="text-ink">{selected.strategy}</span></span
          >
          <span class="text-ink-muted"
            >objectif <span class="text-ink">{selected.objectiveValue}</span></span
          >
          <span class="text-ink-muted">{selected.wallTimeMs} ms</span>
          <span class="text-ink-muted">{selected.assignmentCount} affectations</span>
          {#if selected.isBaseline}<Badge tone="ok">Plan publié</Badge>{/if}
          {#if selected.replayedFromId}<Badge tone="info">Rejeu historique · lecture seule</Badge
            >{/if}
        </div>
        <p class="mb-3 text-xs text-ink-muted">
          Horaires : {displayZone}{!selected.timeZone
            ? ' · fuseau historique non capturé; affichage UTC'
            : ''}
          {#if selected.horizonStart && selected.horizonEnd}
            · {formatInstant(selected.horizonStart, displayZone)} → {formatInstant(
              selected.horizonEnd,
              displayZone,
            )}{/if}
        </p>

        {#if selected.warnings?.length}
          <div class="mb-3 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-ink-muted">
            {#each selected.warnings as w (w)}<div>⚠ {w}</div>{/each}
          </div>
        {/if}

        {#if gantt.empty}
          <p class="text-sm text-ink-muted">
            Ce scénario ne contient aucune affectation. Consultez les diagnostics avant de relancer.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <div class="min-w-[48rem]">
              <!-- time axis -->
              <div class="relative ml-40 h-5 border-b border-edge">
                {#each gantt.ticks as t (t.label)}
                  <div
                    class="absolute top-0 h-full border-l border-edge/60"
                    style="left:{t.leftPct}%"
                  >
                    <span class="ml-1 text-[10px] text-ink-faint">{t.label}</span>
                  </div>
                {/each}
              </div>
              <!-- rows -->
              {#each gantt.rows as row (row.wcId)}
                <div class="flex items-stretch border-b border-edge/50">
                  <div class="w-40 shrink-0 py-2 pr-2 text-sm text-ink">{row.name}</div>
                  <div class="relative my-1 h-8 flex-1">
                    {#each row.bars as bar (bar.a.id)}
                      <div
                        class="absolute top-0 flex h-8 items-center overflow-hidden rounded px-1.5 text-[11px] font-medium text-white shadow-sm"
                        style="left:{bar.leftPct}%; width:{bar.widthPct}%; background:{bar.color}"
                        title={bar.title}
                      >
                        <span class="truncate">{bar.label}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
          <!-- legend -->
          <div class="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
            {#each [...new Set((selected.assignments ?? []).map((a) => a.orderId))] as oid (oid)}
              <span class="inline-flex items-center gap-1">
                <span class="inline-block h-3 w-3 rounded" style="background:{orderColor(oid)}"
                ></span>
                {orderNumbers[oid] ?? oid.slice(0, 8)}
              </span>
            {/each}
          </div>
        {/if}
      {/if}
    </Card>
  </div>
{/if}
