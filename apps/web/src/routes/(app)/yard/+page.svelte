<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Button, Card, PageHeader, Select, Skeleton } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import YardPlan from '$lib/components/yard/YardPlan.svelte';
  import YardContextDrawer from '$lib/components/yard/YardContextDrawer.svelte';

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  interface OccupyingVisit {
    id: string;
    visitNumber: string;
    direction: string;
    trailerRef: string | null;
    checkInAt: string | null;
    trailer: { unitNumber: string; plate: string | null } | null;
    carrier: { name: string } | null;
  }

  interface BoardSpot {
    id: string;
    code: string;
    type: string;
    isActive: boolean;
    posX: number | null;
    posY: number | null;
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

  interface LayoutPos {
    id: string;
    posX: number;
    posY: number;
  }

  let locations = $state<LocationOption[]>([]);
  let locationId = $state('');
  let board = $state<Board>({ spots: [], unassigned: [] });
  let overview = $state<Overview | null>(null);
  let editing = $state(false);
  let layoutDraft = $state<LayoutPos[]>([]);
  let drawerVisitId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');

  async function loadLocations() {
    const res = await api<Paginated<LocationOption>>('/transportation/locations', {
      query: { pageSize: 100 },
    });
    locations = res.items;
    if (!locationId) {
      const dc = locations.find((l) => l.type === 'WAREHOUSE') ?? locations[0];
      locationId = dc?.id ?? '';
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      if (locations.length === 0) await loadLocations();
      if (!locationId) {
        board = { spots: [], unassigned: [] };
        overview = null;
        return;
      }
      const [ov, b] = await Promise.all([
        api<Overview>('/yard/overview'),
        api<Board>('/yard/board', { query: { locationId } }),
      ]);
      overview = ov;
      board = b;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la cour';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  let lastLocationId = '';
  $effect(() => {
    if (locationId !== lastLocationId) {
      lastLocationId = locationId;
      // Leaving edit mode if the site changes mid-edit.
      editing = false;
      drawerVisitId = null;
      void load();
    }
  });

  // Initial load (covers the no-location-yet case).
  let didInit = false;
  $effect(() => {
    if (!didInit) {
      didInit = true;
      void load();
    }
  });

  // Spots merged with the working layout draft (edit mode).
  const draftSpots = $derived(
    board.spots.map((s) => {
      const d = layoutDraft.find((p) => p.id === s.id);
      return d ? { ...s, posX: d.posX, posY: d.posY } : { ...s, posX: null, posY: null };
    }),
  );

  const freeSpots = $derived(board.spots.filter((s) => !s.occupyingVisit && s.isActive));

  const allUnplaced = $derived(board.spots.length > 0 && board.spots.every((s) => s.posX == null));

  async function assign(visitId: string, spotId: string) {
    try {
      await api(`/yard/visits/${visitId}/assign`, { method: 'POST', body: { spotId } });
      toast.success('Visite affectée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'affectation");
    }
  }

  async function move(visitId: string, spotId: string) {
    try {
      await api(`/yard/visits/${visitId}/move`, { method: 'POST', body: { spotId } });
      toast.success('Visite déplacée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du déplacement');
    }
  }

  function openSpot(spot: BoardSpot) {
    drawerVisitId = spot.occupyingVisit?.id ?? null;
  }

  function enterEdit() {
    // Seed the draft from current placed coords.
    layoutDraft = board.spots
      .filter((s) => s.posX != null && s.posY != null)
      .map((s) => ({ id: s.id, posX: s.posX as number, posY: s.posY as number }));
    drawerVisitId = null;
    editing = true;
  }

  async function saveLayout() {
    try {
      await api('/yard/spots/layout', {
        method: 'PUT',
        body: {
          positions: layoutDraft
            .filter((p) => p.posX != null && p.posY != null)
            .map((p) => ({ id: p.id, posX: p.posX, posY: p.posY })),
        },
      });
      toast.success('Disposition enregistrée');
      editing = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    }
  }

  async function cancelEdit() {
    editing = false;
    await load();
  }
</script>

<PageHeader title="Plan de cour" />

<div class="mb-4 flex flex-wrap items-center gap-3">
  <div class="max-w-xs flex-1">
    <Select bind:value={locationId} disabled={editing}>
      <option value="">— Sélectionner un site —</option>
      {#each locations as l (l.id)}
        <option value={l.id}>{l.code} — {l.name}</option>
      {/each}
    </Select>
  </div>
  <div class="ml-auto flex gap-2">
    {#if editing}
      <Button variant="secondary" onclick={cancelEdit}>Annuler</Button>
      <Button onclick={saveLayout}>Enregistrer la disposition</Button>
    {:else}
      <Button variant="secondary" onclick={enterEdit} disabled={!locationId || board.spots.length === 0}>
        Éditer la disposition
      </Button>
    {/if}
  </div>
</div>

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if !locationId}
  <Card><p class="text-sm text-ink-muted">Sélectionnez un site pour voir la cour.</p></Card>
{:else}
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

  {#if board.spots.length === 0}
    <Card><p class="text-sm text-ink-muted">Aucun spot pour ce site.</p></Card>
  {:else}
    {#if allUnplaced && !editing}
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-accent/50 bg-accent/5 px-4 py-3">
        <p class="text-sm text-ink">Place tes spots sur le plan pour démarrer le plan de cour visuel.</p>
        <Button onclick={enterEdit}>Éditer la disposition</Button>
      </div>
    {/if}

    {#if editing}
      <p class="mb-3 text-xs text-ink-muted">
        Glisse les spots sur la grille pour les positionner. Le « bac » liste les spots non placés.
      </p>
    {/if}

    <YardPlan
      spots={editing ? draftSpots : board.spots}
      unassigned={board.unassigned}
      {editing}
      onAssign={assign}
      onMove={move}
      onOpenSpot={openSpot}
      onLayoutChange={(p) => (layoutDraft = p)}
    />
  {/if}
{/if}

{#if drawerVisitId}
  <YardContextDrawer
    visitId={drawerVisitId}
    {freeSpots}
    onClose={() => (drawerVisitId = null)}
    onMoved={() => {
      drawerVisitId = null;
      void load();
    }}
    onCheckedOut={() => {
      drawerVisitId = null;
      void load();
    }}
  />
{/if}
