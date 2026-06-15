<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { YardSpotType } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Skeleton } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  interface OccupyingVisit {
    id: string;
    visitNumber: string;
    trailerRef: string | null;
    direction: string;
    trailer: { unitNumber: string; plate: string | null } | null;
    carrier: { name: string } | null;
  }

  interface BoardSpot {
    id: string;
    code: string;
    type: string;
    locationId: string;
    occupyingVisit: OccupyingVisit | null;
  }

  interface Board {
    spots: BoardSpot[];
    unassigned: OccupyingVisit[];
  }

  interface Overview {
    trucksInYard: number;
    doorCount: number;
    occupiedDoors: number;
    freeDoors: number;
    visitsWithoutSpot: number;
    appointmentsToday: number;
  }

  const SPOT_TYPE_ORDER: YardSpotType[] = [
    YardSpotType.DOCK_DOOR,
    YardSpotType.PARKING,
    YardSpotType.STAGING,
  ];

  const SPOT_TYPE_LABEL: Record<string, string> = {
    DOCK_DOOR: 'Portes de quai',
    PARKING: 'Stationnement',
    STAGING: 'Staging',
  };

  let locations = $state<LocationOption[]>([]);
  let selectedLocationId = $state('');
  let board = $state<Board | null>(null);
  let overview = $state<Overview | null>(null);
  let loading = $state(true);
  let error = $state('');

  // Spot picker modal (assign / move).
  let pickerOpen = $state(false);
  let pickerVisit = $state<OccupyingVisit | null>(null);
  let pickerMode = $state<'assign' | 'move'>('assign');
  let pickerExcludeSpotId = $state<string | null>(null);
  let pickerSpotId = $state('');
  let pickerSaving = $state(false);

  function directionTone(direction: string): Tone {
    switch (direction) {
      case 'INBOUND':
        return 'info';
      case 'OUTBOUND':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  function trailerLabel(v: OccupyingVisit): string {
    if (v.trailer) return v.trailer.plate ? `${v.trailer.unitNumber} (${v.trailer.plate})` : v.trailer.unitNumber;
    return v.trailerRef ?? '—';
  }

  // Free spots of the current site, optionally excluding one (the spot being moved from).
  const freeSpots = $derived(
    (board?.spots ?? []).filter(
      (s) => !s.occupyingVisit && s.id !== pickerExcludeSpotId,
    ),
  );

  const spotsByType = $derived(
    SPOT_TYPE_ORDER.map((type) => ({
      type,
      label: SPOT_TYPE_LABEL[type] ?? type,
      spots: (board?.spots ?? []).filter((s) => s.type === type),
    })).filter((g) => g.spots.length > 0),
  );

  async function loadLocations() {
    const res = await api<Paginated<LocationOption>>('/transportation/locations', {
      query: { pageSize: 100 },
    });
    locations = res.items;
    if (!selectedLocationId) {
      const dc = locations.find((l) => l.type === 'WAREHOUSE') ?? locations[0];
      selectedLocationId = dc?.id ?? '';
    }
  }

  async function loadBoard() {
    if (!selectedLocationId) {
      board = { spots: [], unassigned: [] };
      return;
    }
    const [b, ov] = await Promise.all([
      api<Board>('/yard/board', { query: { locationId: selectedLocationId } }),
      api<Overview>('/yard/overview'),
    ]);
    board = b;
    overview = ov;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      if (locations.length === 0) await loadLocations();
      await loadBoard();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la cour';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // Reload when the site changes.
  let lastLocationId = '';
  $effect(() => {
    if (selectedLocationId && selectedLocationId !== lastLocationId) {
      lastLocationId = selectedLocationId;
      void reloadBoard();
    }
  });

  async function reloadBoard() {
    try {
      await loadBoard();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du rechargement de la cour');
    }
  }

  function openAssign(visit: OccupyingVisit) {
    pickerMode = 'assign';
    pickerVisit = visit;
    pickerExcludeSpotId = null;
    pickerSpotId = '';
    pickerOpen = true;
  }

  function openMove(spot: BoardSpot) {
    if (!spot.occupyingVisit) return;
    pickerMode = 'move';
    pickerVisit = spot.occupyingVisit;
    pickerExcludeSpotId = spot.id;
    pickerSpotId = '';
    pickerOpen = true;
  }

  async function submitPicker() {
    if (!pickerVisit || !pickerSpotId) {
      toast.error('Sélectionnez un spot libre');
      return;
    }
    pickerSaving = true;
    try {
      const verb = pickerMode === 'move' ? 'move' : 'assign';
      await api(`/yard/visits/${pickerVisit.id}/${verb}`, {
        method: 'POST',
        body: { spotId: pickerSpotId },
      });
      toast.success(pickerMode === 'move' ? 'Visite déplacée' : 'Visite affectée');
      pickerOpen = false;
      await reloadBoard();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'affectation");
    } finally {
      pickerSaving = false;
    }
  }

  async function checkOut(visit: OccupyingVisit) {
    try {
      await api(`/yard/visits/${visit.id}/check-out`, { method: 'POST' });
      toast.success('Check-out effectué');
      await reloadBoard();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du check-out');
    }
  }
</script>

<PageHeader title="Yard" />

<div class="mb-4 flex items-center gap-3">
  <div class="max-w-xs flex-1">
    <Select bind:value={selectedLocationId}>
      <option value="">— Sélectionner un site —</option>
      {#each locations as l (l.id)}
        <option value={l.id}>{l.code} — {l.name}</option>
      {/each}
    </Select>
  </div>
</div>

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <!-- KPI cards -->
  {#if overview}
    <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Camions en cour</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.trucksInYard}</div>
      </Card>
      <Card>
        <div class="text-xs font-medium text-ink-muted">Portes occupées</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.occupiedDoors} / {overview.doorCount}</div>
      </Card>
      <Card>
        <div class="text-xs font-medium text-ink-muted">Portes libres</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.freeDoors}</div>
      </Card>
      <Card>
        <div class="text-xs font-medium text-ink-muted">Rendez-vous du jour</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.appointmentsToday}</div>
      </Card>
    </div>
  {/if}

  <div class="grid gap-4 lg:grid-cols-[1fr_18rem]">
    <!-- Spots grid -->
    <div class="space-y-5">
      {#if !selectedLocationId}
        <Card><EmptyState message="Sélectionnez un site pour voir la cour." /></Card>
      {:else if spotsByType.length === 0}
        <Card><EmptyState message="Aucun spot pour ce site." /></Card>
      {:else}
        {#each spotsByType as group (group.type)}
          <div>
            <h2 class="mb-2 text-sm font-semibold text-ink">{group.label}</h2>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {#each group.spots as spot (spot.id)}
                <Card>
                  <div class="mb-2 flex items-center gap-2">
                    <span class="font-semibold text-ink">{spot.code}</span>
                    <Badge tone="neutral">{spot.type}</Badge>
                    <span class="ml-auto">
                      {#if spot.occupyingVisit}
                        <Badge tone="warn">Occupé</Badge>
                      {:else}
                        <Badge tone="ok">Libre</Badge>
                      {/if}
                    </span>
                  </div>
                  {#if spot.occupyingVisit}
                    <div class="space-y-1 text-sm">
                      <div class="font-medium text-ink">{spot.occupyingVisit.visitNumber}</div>
                      <div class="text-ink-muted">{trailerLabel(spot.occupyingVisit)}</div>
                      {#if spot.occupyingVisit.carrier}
                        <div class="text-ink-muted">{spot.occupyingVisit.carrier.name}</div>
                      {/if}
                      <Badge tone={directionTone(spot.occupyingVisit.direction)}>
                        {spot.occupyingVisit.direction}
                      </Badge>
                    </div>
                    <div class="mt-3 flex gap-2">
                      <Button variant="secondary" onclick={() => openMove(spot)}>Déplacer</Button>
                      <Button variant="ghost" onclick={() => { if (spot.occupyingVisit) void checkOut(spot.occupyingVisit); }}>
                        Check-out
                      </Button>
                    </div>
                  {:else}
                    <p class="text-sm text-ink-faint">Libre</p>
                  {/if}
                </Card>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- À placer -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-ink">À placer</h2>
      <Card padded={false}>
        {#if !board || board.unassigned.length === 0}
          <EmptyState message="Aucune visite à placer." />
        {:else}
          <div class="divide-y divide-edge">
            {#each board.unassigned as v (v.id)}
              <div class="px-4 py-2.5 text-sm">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-ink">{v.visitNumber}</span>
                  <Badge tone={directionTone(v.direction)}>{v.direction}</Badge>
                </div>
                <div class="text-ink-muted">{trailerLabel(v)}</div>
                {#if v.carrier}<div class="text-ink-muted">{v.carrier.name}</div>{/if}
                <div class="mt-2">
                  <Button onclick={() => openAssign(v)}>Affecter</Button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </Card>
    </div>
  </div>
{/if}

<Modal bind:open={pickerOpen} title={pickerMode === 'move' ? 'Déplacer la visite' : 'Affecter un spot'}>
  <div class="space-y-3">
    {#if pickerVisit}
      <p class="text-sm text-ink-muted">
        Visite <span class="font-medium text-ink">{pickerVisit.visitNumber}</span>
      </p>
    {/if}
    <Select bind:value={pickerSpotId}>
      <option value="">— Choisir un spot libre —</option>
      {#each freeSpots as s (s.id)}
        <option value={s.id}>{s.code} ({s.type})</option>
      {/each}
    </Select>
    {#if freeSpots.length === 0}
      <p class="text-sm text-ink-faint">Aucun spot libre disponible.</p>
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { pickerOpen = false; }}>Annuler</Button>
    <Button loading={pickerSaving} onclick={submitPicker} disabled={!pickerSpotId}>
      {pickerMode === 'move' ? 'Déplacer' : 'Affecter'}
    </Button>
  {/snippet}
</Modal>
