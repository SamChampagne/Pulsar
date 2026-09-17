<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import {
    PERMISSIONS,
    computeDwell,
    yardDirectionLabel,
    yardSpotLabel,
    yardStatusLabel,
    yardAppointmentConflicts,
    type YardWorkspace,
    type YardWorkspaceSpot,
    type YardPlanShape,
    type YardWorkspaceAppointment,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    Badge,
    Button,
    Drawer,
    ErrorNotice,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
    Tabs,
  } from '$lib/components/ui';
  import YardMap from '$lib/components/yard/YardMap.svelte';
  import DockSchedule from '$lib/components/yard/DockSchedule.svelte';
  import YardContextDrawer from '$lib/components/yard/YardContextDrawer.svelte';
  import YardArrival from '$lib/components/yard/YardArrival.svelte';
  import YardDossiers from '$lib/components/yard/YardDossiers.svelte';
  import LocationFormModal from '$lib/components/locations/LocationFormModal.svelte';
  import type { LocationRecord } from '$lib/components/locations/types';

  let showCreateSite = $state(false);
  let sites = $state<YardWorkspace['site'][]>([]),
    siteId = $state(''),
    date = $state(''),
    workspace = $state<YardWorkspace | null>(null);
  let loading = $state(true),
    error = $state(''),
    refreshError = $state(''),
    actionError = $state(''),
    busy = $state(false),
    sitesTruncated = $state(false);
  let view = $state('plan'),
    search = $state(''),
    visitFilter = $state('all'),
    visitId = $state(''),
    arrival = $state(false),
    arrivalAppointment = $state<YardWorkspaceAppointment | null>(null);
  let appointmentId = $state(''),
    appointmentOpen = $state(false),
    assignSpotId = $state(''),
    assignOpen = $state(false),
    assignVisitId = $state('');
  let editing = $state(false),
    draftSpots = $state<YardWorkspaceSpot[]>([]),
    shapes = $state<YardPlanShape[]>([]),
    selection = $state(''),
    selectionKind = $state<'shape' | 'spot'>('spot');
  let generation = 0,
    now = $state(Date.now());
  let pendingFocus: { site: string; visit: string | null; appointment: string | null } | null =
    null;
  let focusedAppointment = $state<YardWorkspaceAppointment | null>(null);
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.YARD.MANAGE));
  const canManageLocations = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CORE.LOCATIONS_MANAGE),
  );
  async function onSiteCreated(loc: LocationRecord) {
    showCreateSite = false;
    await init();
    siteId = loc.id;
  }
  const occupied = $derived(new Set(workspace?.visits.map((v) => v.spotId).filter(Boolean) ?? []));
  const freeSpots = $derived(
    workspace?.spots.filter((s) => s.isActive && !occupied.has(s.id)) ?? [],
  );
  const doors = $derived(
    workspace?.spots.filter((s) => s.type === 'DOCK_DOOR' && s.isActive) ?? [],
  );
  const unassigned = $derived(workspace?.visits.filter((v) => !v.spotId) ?? []);
  const detention = $derived(
    workspace?.visits.filter(
      (v) => computeDwell({ checkInAt: v.checkInAt }, new Date(now)).status === 'DETENTION',
    ) ?? [],
  );
  const filtered = $derived(
    (workspace?.visits ?? []).filter(
      (v) =>
        (visitFilter !== 'waiting' || !v.spotId) &&
        (visitFilter !== 'delay' || detention.some((d) => d.id === v.id)) &&
        `${v.visitNumber} ${v.trailerRef ?? ''} ${v.trailer?.unitNumber ?? ''} ${v.carrier?.name ?? ''}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ),
  );
  const selectedShape = $derived(shapes.find((s) => s.id === selection));
  const selectedSpot = $derived(draftSpots.find((s) => s.id === selection));
  const appointment = $derived(
    workspace?.appointments.find((a) => a.id === appointmentId) ??
      (focusedAppointment?.id === appointmentId ? focusedAppointment : null),
  );
  const incomplete = $derived(!!workspace && Object.values(workspace.truncated).some(Boolean));
  const disabled = $derived(busy || loading || !!refreshError || incomplete);
  const clock = (s: string) =>
    new Intl.DateTimeFormat('fr-CA', {
      timeZone: workspace?.timeZone ?? 'UTC',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(s));
  async function init() {
    loading = true;
    error = '';
    try {
      const result = await api<{ items: YardWorkspace['site'][]; truncated: boolean }>(
        '/yard/sites',
      );
      sites = result.items;
      sitesTruncated = result.truncated;
      const params = new URL(window.location.href).searchParams;
      const requested = params.get('site');
      if (requested && !sites.some((s) => s.id === requested))
        throw new Error('Ce site est indisponible dans la liste accessible.');
      const selectedSite = sites.find((s) => s.id === requested)?.id ?? sites[0]?.id ?? '';
      pendingFocus = {
        site: selectedSite,
        visit: params.get('visit'),
        appointment: params.get('appointment'),
      };
      date = params.get('date') ?? '';
      siteId = selectedSite;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Sites indisponibles.';
    } finally {
      if (!siteId) loading = false;
    }
  }
  async function load(background = false) {
    if (!siteId) return;
    const request = ++generation,
      id = siteId,
      day = date;
    if (!background) {
      loading = true;
      workspace = null;
      error = '';
    }
    refreshError = '';
    try {
      const data = await api<YardWorkspace>('/yard/workspace', {
        query: { locationId: id, date: day || undefined },
      });
      if (request === generation) {
        workspace = data;
        if (pendingFocus?.site === id) {
          const focus = pendingFocus;
          pendingFocus = null;
          if (focus.visit) visitId = focus.visit;
          else if (focus.appointment) {
            try {
              const found = data.appointments.find((a) => a.id === focus.appointment);
              const detail =
                found ??
                (await api<YardWorkspaceAppointment & { locationId: string }>(
                  `/yard/appointments/${encodeURIComponent(focus.appointment)}`,
                ));
              if (!found && (detail as { locationId?: string }).locationId !== id)
                throw new Error('Le rendez-vous ne correspond pas au site.');
              if (request === generation) {
                focusedAppointment = detail;
                appointmentId = detail.id;
                appointmentOpen = true;
              }
            } catch (e) {
              if (request === generation)
                actionError = e instanceof Error ? e.message : 'Rendez-vous indisponible.';
            }
          }
        }
      }
    } catch (e) {
      if (request === generation) {
        const message = e instanceof Error ? e.message : 'Site indisponible.';
        if (background) refreshError = `Données non actualisées. ${message}`;
        else error = message;
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    const id = siteId,
      day = date;
    untrack(() => {
      if (id) {
        visitId = '';
        appointmentOpen = false;
        void load();
      }
    });
  });
  onMount(() => {
    void init();
    const t = setInterval(() => {
      now = Date.now();
      if (
        !document.hidden &&
        !editing &&
        !busy &&
        !arrival &&
        !visitId &&
        !assignOpen &&
        !appointmentOpen &&
        !loading
      )
        void load(true);
    }, 30000);
    return () => {
      generation++;
      clearInterval(t);
    };
  });
  beforeNavigate(({ cancel }) => {
    if (editing || busy || arrival || visitId || assignOpen || appointmentOpen) {
      cancel();
      actionError = 'Fermez le panneau ou terminez la modification avant de quitter le site.';
    }
  });
  function startEdit() {
    if (!workspace || disabled || !canManage) return;
    draftSpots = structuredClone($state.snapshot(workspace.spots));
    shapes = structuredClone($state.snapshot(workspace.shapes));
    selection = '';
    editing = true;
    view = 'plan';
    actionError = '';
  }
  async function cancelEdit() {
    if (busy) return;
    if (
      !(await confirmAction(
        'Abandonner les changements du dessin ? Les visites et les affectations ne sont pas modifiées.',
        { title: 'Quitter l’édition du plan', confirmLabel: 'Abandonner' },
      ))
    )
      return;
    editing = false;
    selection = '';
    actionError = '';
    await load(true);
  }
  function position(kind: 'spot' | 'shape', id: string, x: number, y: number) {
    if (
      !editing ||
      busy ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x > 63 ||
      y > 63
    )
      return;
    actionError = '';
    if (kind === 'spot') {
      if (draftSpots.some((s) => s.id !== id && s.posX === x && s.posY === y)) {
        actionError = 'Cette cellule contient déjà un emplacement du dessin.';
        return;
      }
      draftSpots = draftSpots.map((s) => (s.id === id ? { ...s, posX: x, posY: y } : s));
    } else
      shapes = shapes.map((s) =>
        s.id === id ? { ...s, x: Math.min(x, 64 - s.width), y: Math.min(y, 64 - s.height) } : s,
      );
  }
  function addShape(kind: YardPlanShape['kind']) {
    if (shapes.length >= 40) return;
    const s: YardPlanShape = {
      id: crypto.randomUUID(),
      kind,
      label: kind === 'BUILDING' ? 'Bâtiment' : kind === 'GATE' ? 'Entrée' : 'Zone de préparation',
      x: 1,
      y: 0,
      width: kind === 'BUILDING' ? 5 : 2,
      height: kind === 'BUILDING' ? 2 : 1,
    };
    shapes = [...shapes, s];
    selectionKind = 'shape';
    selection = s.id;
  }
  async function suggestLayout() {
    if (
      !(await confirmAction(
        'Remplacer le dessin en préparation par une disposition simple ? Aucun emplacement ni bâtiment réel n’est créé.',
        { title: 'Proposer une disposition', confirmLabel: 'Préparer le dessin', dangerous: false },
      ))
    )
      return;
    draftSpots = draftSpots.map((s, i) => ({ ...s, posX: i % 10, posY: 2 + Math.floor(i / 10) }));
    shapes = [
      {
        id: crypto.randomUUID(),
        kind: 'BUILDING',
        label: workspace?.site.name ?? 'Bâtiment',
        x: 0,
        y: 0,
        width: 10,
        height: 2,
      },
    ];
    selection = '';
  }
  async function savePlan() {
    if (!workspace || busy) return;
    if (
      shapes.some(
        (s) =>
          !s.label.trim() ||
          ![s.x, s.y, s.width, s.height].every(Number.isInteger) ||
          s.x < 0 ||
          s.y < 0 ||
          s.width < 1 ||
          s.height < 1 ||
          s.x + s.width > 64 ||
          s.y + s.height > 64,
      )
    ) {
      actionError =
        'Chaque élément doit avoir un nom et des dimensions entières dans la grille de 64 × 64 cellules.';
      return;
    }
    busy = true;
    actionError = '';
    try {
      await api(`/yard/sites/${siteId}/plan`, {
        method: 'PUT',
        body: {
          expectedVersion: workspace.planVersion,
          shapes,
          positions: draftSpots.map(({ id, posX, posY }) => ({ id, posX, posY })),
        },
      });
      editing = false;
      selection = '';
      await load(true);
    } catch (e) {
      actionError =
        e instanceof Error ? e.message : 'Enregistrement impossible. Le dessin est conservé.';
    } finally {
      busy = false;
    }
  }
  function select(kind: 'spot' | 'shape', id: string) {
    if (editing) {
      selectionKind = kind;
      selection = id;
      return;
    }
    if (disabled || kind !== 'spot') return;
    const visits = workspace?.visits.filter((v) => v.spotId === id) ?? [];
    if (visits.length === 1) visitId = visits[0].id;
    else {
      assignSpotId = id;
      assignVisitId = '';
      assignOpen = true;
    }
  }
  async function assign(id: string, spotId: string) {
    const v = workspace?.visits.find((v) => v.id === id),
      s = freeSpots.find((s) => s.id === spotId);
    if (!v || !s || disabled || !canManage) return;
    busy = true;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          `${v.trailer?.unitNumber ?? v.trailerRef ?? v.visitNumber} → ${s.code}. La disponibilité sera revérifiée.`,
          { title: 'Confirmer l’affectation', confirmLabel: 'Affecter', dangerous: false },
        ))
      )
        return;
      await api(`/yard/visits/${id}/${v.spotId ? 'move' : 'assign'}`, {
        method: 'POST',
        body: { spotId },
      });
      assignOpen = false;
      await load(true);
    } catch (e) {
      actionError =
        e instanceof ApiError ? e.message : 'Réponse non confirmée. Actualisez avant de réessayer.';
    } finally {
      busy = false;
    }
  }
  function startArrival(a: YardWorkspaceAppointment | null = null) {
    arrivalAppointment = a;
    appointmentOpen = false;
    arrival = true;
  }
  async function appointmentAction(verb: 'complete' | 'cancel' | 'no-show') {
    if (!appointment || busy || !canManage) return;
    busy = true;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          `${appointment.appointmentNumber} : ${verb === 'complete' ? 'terminer le rendez-vous uniquement, sans enregistrer de départ' : verb === 'cancel' ? 'annuler le rendez-vous' : 'signaler l’absence'} ?`,
          { title: 'Modifier le rendez-vous', confirmLabel: 'Confirmer' },
        ))
      )
        return;
      await api(`/yard/appointments/${appointment.id}/${verb}`, { method: 'POST', body: {} });
      appointmentOpen = false;
      await load(true);
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Action impossible.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Cour & quais · Pulsar</title></svelte:head>
<PageHeader
  title="Cour & quais"
  subtitle="Voir les arrivées, placer les remorques et préparer les quais."
>
  {#snippet actions()}<Button variant="secondary" href="/yard/appointments" disabled={editing}
      >Rendez-vous</Button
    >{#if canManage}<Button
        disabled={disabled || !workspace || editing}
        onclick={() => startArrival()}>Enregistrer une arrivée</Button
      >{/if}{/snippet}
</PageHeader>
<div class="mb-4 flex flex-wrap items-end gap-3">
  <div class="w-full min-w-0 sm:max-w-sm sm:flex-1">
    <Field label="Site de travail"
      ><Select
        bind:value={siteId}
        disabled={editing || busy || arrival || !!visitId || assignOpen || appointmentOpen}
        ><option value="">Sélectionner un site</option>{#each sites as s (s.id)}<option value={s.id}
            >{s.name} · {s.code}</option
          >{/each}</Select
      ></Field
    >
  </div>
  <Button
    variant="secondary"
    disabled={loading || editing || busy}
    onclick={() => (workspace ? load(true) : siteId ? load() : init())}>Actualiser</Button
  >{#if canManageLocations}<Button
      variant="secondary"
      disabled={editing || busy}
      onclick={() => {
        showCreateSite = true;
      }}>+ Site</Button
    >{/if}{#if workspace}<p class="pb-2 text-xs text-ink-muted">
      Mise à jour {clock(workspace.generatedAt)} · {workspace.timeZone}
    </p>{/if}
</div>
<ErrorNotice message={error} onretry={() => (siteId ? load() : init())} /><ErrorNotice
  message={refreshError}
  onretry={() => load(true)}
/>
{#if !arrival && !assignOpen && !appointmentOpen}<ErrorNotice message={actionError} />{/if}
{#if loading}<Skeleton rows={8} />{:else if workspace}
  {#if incomplete || sitesTruncated}<p
      class="mb-4 rounded-md border border-warn/30 p-3 text-sm text-warn"
    >
      Vue limitée à 500 éléments par catégorie. {incomplete
        ? 'Les actions sont désactivées pour éviter de travailler sur une occupation incomplète.'
        : 'Certains sites ne sont pas affichés.'}
    </p>{/if}
  {#if workspace.timezoneFallback}<p class="mb-3 text-xs text-warn">
      Fuseau du site absent ou invalide : planning affiché en UTC.
    </p>{/if}
  <div
    class="mb-5 flex flex-wrap gap-x-8 gap-y-3 border-y border-edge py-3"
    aria-label="Occupation du site sélectionné"
  >
    <div>
      <span class="font-mono text-2xl font-semibold">{workspace.visits.length}</span><span
        class="ml-2 text-xs text-ink-muted">en cour</span
      >
    </div>
    <div>
      <span class="font-mono text-2xl font-semibold"
        >{doors.filter((s) => occupied.has(s.id)).length}<span class="text-sm text-ink-faint"
          >/{doors.length}</span
        ></span
      ><span class="ml-2 text-xs text-ink-muted">quais occupés</span>
    </div>
    <div>
      <span class="font-mono text-2xl font-semibold">{unassigned.length}</span><span
        class="ml-2 text-xs text-ink-muted">à affecter</span
      >
    </div>
    <div>
      <span class={`font-mono text-2xl font-semibold ${detention.length ? 'text-danger' : ''}`}
        >{detention.length}</span
      ><span class="ml-2 text-xs text-ink-muted">attentes prolongées</span>
    </div>
  </div>
  {#if editing}<div
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3"
    >
      <div>
        <h2 class="text-sm font-semibold">Édition du dessin</h2>
        <p class="text-xs text-ink-muted">
          Les coordonnées ne modifient ni les visites ni leur occupation.
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="secondary" disabled={busy} onclick={cancelEdit}>Abandonner</Button><Button
          loading={busy}
          onclick={savePlan}>Enregistrer le plan</Button
        >
      </div>
    </div>{/if}<Tabs
    bind:active={view}
    label="Vues de la cour"
    tabs={editing
      ? [{ id: 'plan', label: 'Dessin du site' }]
      : [
          { id: 'plan', label: 'Plan du site' },
          { id: 'schedule', label: 'Planning des quais' },
        ]}
  >
    {#if view === 'plan'}
      <div class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div class="min-w-0">
          <YardMap
            spots={editing ? draftSpots : workspace.spots}
            visits={workspace.visits}
            shapes={editing ? shapes : workspace.shapes}
            {editing}
            canManage={canManage && !disabled}
            selected={selection}
            onselect={select}
            ondropvisit={assign}
            onposition={position}
          />{#if !editing && canManage}<div class="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" {disabled} onclick={startEdit}>Configurer le plan</Button
              ><Button variant="ghost" href="/yard/spots">Gérer les quais et emplacements</Button>
            </div>{/if}
        </div>
        {#if editing}<aside
            class="space-y-4 rounded-xl border border-edge bg-surface p-4"
            aria-label="Propriétés du dessin"
          >
            <h2 class="text-sm font-semibold">Dessiner le site</h2>
            <div class="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy || shapes.length >= 40}
                onclick={() => addShape('BUILDING')}>+ Bâtiment</Button
              ><Button
                variant="secondary"
                disabled={busy || shapes.length >= 40}
                onclick={() => addShape('AREA')}>+ Zone</Button
              ><Button
                variant="secondary"
                disabled={busy || shapes.length >= 40}
                onclick={() => addShape('GATE')}>+ Accès</Button
              >
            </div>
            <Button variant="ghost" disabled={busy} onclick={suggestLayout}
              >Proposer une disposition</Button
            >
            <Field label="Élément à modifier"
              ><Select
                disabled={busy}
                value={selection ? `${selectionKind}:${selection}` : ''}
                onchange={(e: Event) => {
                  const [kind, ...id] = (e.target as HTMLSelectElement).value.split(':');
                  selectionKind = kind as 'spot' | 'shape';
                  selection = id.join(':');
                }}
                ><option value="">Choisir sur le plan ou ici</option
                >{#each shapes as s (s.id)}<option value={`shape:${s.id}`}>{s.label}</option
                  >{/each}{#each draftSpots as s (s.id)}<option value={`spot:${s.id}`}
                    >{s.code}</option
                  >{/each}</Select
              ></Field
            >
            {#if selectionKind === 'shape' && selectedShape}<fieldset
                disabled={busy}
                class="space-y-3"
              >
                <Field label="Nom"><Input bind:value={selectedShape.label} maxlength={80} /></Field>
                <div class="grid grid-cols-2 gap-2">
                  <Field label="Colonne"
                    ><Input type="number" min={0} max={63} bind:value={selectedShape.x} /></Field
                  ><Field label="Rangée"
                    ><Input type="number" min={0} max={63} bind:value={selectedShape.y} /></Field
                  ><Field label="Largeur"
                    ><Input
                      type="number"
                      min={1}
                      max={64}
                      bind:value={selectedShape.width}
                    /></Field
                  ><Field label="Hauteur"
                    ><Input
                      type="number"
                      min={1}
                      max={64}
                      bind:value={selectedShape.height}
                    /></Field
                  >
                </div>
                <Button
                  variant="ghost"
                  onclick={() => {
                    shapes = shapes.filter((s) => s.id !== selection);
                    selection = '';
                  }}>Retirer du dessin</Button
                >
              </fieldset>
            {:else if selectedSpot}<fieldset disabled={busy} class="space-y-3">
                <p class="text-sm font-medium">
                  {selectedSpot.code} · {yardSpotLabel(selectedSpot.type)}
                </p>
                <div class="grid grid-cols-2 gap-2">
                  <Field label="Colonne"
                    ><Input
                      type="number"
                      value={selectedSpot.posX ?? 0}
                      min={0}
                      max={63}
                      oninput={(e) =>
                        position(
                          'spot',
                          selection,
                          Number(e.currentTarget.value),
                          selectedSpot!.posY ?? 0,
                        )}
                    /></Field
                  ><Field label="Rangée"
                    ><Input
                      type="number"
                      value={selectedSpot.posY ?? 0}
                      min={0}
                      max={63}
                      oninput={(e) =>
                        position(
                          'spot',
                          selection,
                          selectedSpot!.posX ?? 0,
                          Number(e.currentTarget.value),
                        )}
                    /></Field
                  >
                </div>
                <Button
                  variant="ghost"
                  onclick={() => {
                    draftSpots = draftSpots.map((s) =>
                      s.id === selection ? { ...s, posX: null, posY: null } : s,
                    );
                  }}>Retirer du dessin</Button
                >
              </fieldset>{:else}<p class="text-xs leading-relaxed text-ink-muted">
                Sélectionnez un élément pour ajuster sa position. Les champs sont utilisables au
                clavier et sur tablette, sans glisser-déposer.
              </p>{/if}
          </aside>{:else}<aside
            class="min-w-0 overflow-hidden rounded-xl border border-edge bg-surface"
            aria-label="Visites du site"
          >
            <div class="space-y-3 border-b border-edge p-4">
              <h2 class="text-sm font-semibold">Visites en cours</h2>
              <Input
                bind:value={search}
                aria-label="Rechercher une visite"
                placeholder="Remorque, transporteur…"
              /><Select bind:value={visitFilter} aria-label="Filtrer les visites"
                ><option value="all">Toutes les visites</option><option value="waiting"
                  >À affecter</option
                ><option value="delay">Attente prolongée</option></Select
              >
            </div>
            <div class="max-h-[32rem] overflow-y-auto">
              {#each filtered as v (v.id)}<button
                  class="block w-full border-b border-edge-soft p-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                  {disabled}
                  draggable={canManage && !disabled}
                  ondragstart={(e) =>
                    e.dataTransfer?.setData('application/pulsar-yard-visit', v.id)}
                  onclick={() => (visitId = v.id)}
                  ><div class="flex justify-between gap-2">
                    <strong class="truncate text-sm"
                      >{v.trailer?.unitNumber ?? v.trailerRef ?? v.visitNumber}</strong
                    ><span class="shrink-0 font-mono text-xs text-ink-muted"
                      >{computeDwell({ checkInAt: v.checkInAt }, new Date(now)).minutes} min</span
                    >
                  </div>
                  <p class="mt-1 truncate text-xs text-ink-muted">
                    {v.carrier?.name ?? v.visitNumber}
                  </p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <Badge tone={v.spotId ? 'info' : 'warn'}
                      >{workspace.spots.find((s) => s.id === v.spotId)?.code ?? 'À affecter'}</Badge
                    ><span class="text-xs text-ink-muted">{yardDirectionLabel(v.direction)}</span>
                  </div></button
                >{:else}<p class="p-5 text-sm text-ink-muted">
                  Aucune visite pour ce filtre.
                </p>{/each}
            </div>
          </aside>{/if}
      </div>
    {:else}<div class="mb-4 max-w-xs">
        <Field label="Journée du planning"
          ><Input
            type="date"
            value={date || workspace.date}
            oninput={(e) => (date = e.currentTarget.value)}
          /></Field
        >
      </div>
      <DockSchedule
        {workspace}
        onopen={(id) => {
          appointmentId = id;
          actionError = '';
          appointmentOpen = true;
        }}
      />{/if}</Tabs
  >
{:else if !error}<div class="rounded-lg border border-edge p-6 text-sm text-ink-muted">
    <p>Aucun site actif. Créez un site dans les données de l’entreprise pour préparer la cour.</p>
    {#if canManageLocations}<div class="mt-3">
        <Button
          onclick={() => {
            showCreateSite = true;
          }}>Créer un site</Button
        >
      </div>{/if}
  </div>{/if}

{#if workspace && visitId}<YardContextDrawer
    {visitId}
    {freeSpots}
    siteId={workspace.site.id}
    timeZone={workspace.timeZone}
    actionsDisabled={disabled}
    onClose={() => {
      visitId = '';
      actionError = '';
    }}
    onMoved={() => load(true)}
    onCheckedOut={() => load(true)}
  />{/if}
{#if workspace && arrival}<YardArrival
    {workspace}
    appointment={arrivalAppointment}
    onclose={() => {
      arrival = false;
      actionError = '';
    }}
    onsaved={async (id) => {
      await load(true);
      visitId = id;
    }}
  />{/if}
<Drawer
  bind:open={assignOpen}
  title={`Emplacement ${workspace?.spots.find((s) => s.id === assignSpotId)?.code ?? ''}`}
  dismissible={!busy}
  onclose={() => (actionError = '')}
>
  {#if workspace?.visits.some((v) => v.spotId === assignSpotId)}<p class="mb-4 text-sm text-danger">
      Plusieurs visites occupent cet emplacement. Ouvrez un dossier pour corriger les affectations.
    </p>
    {#each workspace.visits.filter((v) => v.spotId === assignSpotId) as v (v.id)}<Button
        variant="secondary"
        onclick={() => {
          assignOpen = false;
          visitId = v.id;
        }}>{v.trailerRef ?? v.visitNumber}</Button
      >{/each}
  {:else}<p class="mb-4 text-sm text-ink-muted">Choisissez une visite du site à affecter ici.</p>
    <Field label="Visite à affecter"
      ><Select bind:value={assignVisitId} disabled={busy || !canManage}
        ><option value="">Sélectionner une visite</option
        >{#each workspace?.visits ?? [] as v (v.id)}<option value={v.id}
            >{v.trailer?.unitNumber ?? v.trailerRef ?? v.visitNumber} · {v.spotId
              ? 'déjà affectée'
              : 'en attente'}</option
          >{/each}</Select
      ></Field
    >{/if}
  <div class="mt-4"><ErrorNotice message={actionError} /></div>
  {#snippet footer()}<Button
      disabled={disabled ||
        !canManage ||
        !assignVisitId ||
        !freeSpots.some((s) => s.id === assignSpotId)}
      onclick={() => assign(assignVisitId, assignSpotId)}>Affecter à cet emplacement</Button
    >{/snippet}
</Drawer>
<Drawer
  bind:open={appointmentOpen}
  title={appointment ? `Rendez-vous ${appointment.appointmentNumber}` : 'Rendez-vous'}
  dismissible={!busy}
  onclose={() => (actionError = '')}
>
  {#if appointment}<Badge
      tone={yardAppointmentConflicts(workspace?.appointments ?? []).includes(appointment.id)
        ? 'danger'
        : 'info'}>{yardStatusLabel(appointment.status)}</Badge
    >
    <h3 class="mt-4 text-xl font-semibold">
      {appointment.carrier?.name ?? appointment.reference ?? 'Transporteur non renseigné'}
    </h3>
    <p class="mt-2 text-sm">
      {clock(appointment.windowStart)} → {clock(appointment.windowEnd)} · {workspace?.timeZone}
    </p>
    <p class="mt-2 text-sm text-ink-muted">
      {workspace?.spots.find((s) => s.id === appointment.spotId)?.code ?? 'Quai non affecté'} · {yardDirectionLabel(
        appointment.direction,
      )}
    </p>
    {#if yardAppointmentConflicts(workspace?.appointments ?? []).includes(appointment.id)}<p
        class="mt-4 text-sm text-danger"
      >
        Ce créneau chevauche un autre rendez-vous sur le même quai.
      </p>{/if}{#if appointment.notes}<p class="mt-4 whitespace-pre-wrap text-sm">
        {appointment.notes}
      </p>{/if}
    {#each workspace?.visits.filter((v) => v.appointmentId === appointment.id) ?? [] as v (v.id)}<div
        class="mt-4"
      >
        <Button
          variant="secondary"
          onclick={() => {
            appointmentOpen = false;
            visitId = v.id;
          }}>Ouvrir la visite {v.visitNumber}</Button
        >
      </div>{/each}
    <YardDossiers
      sourceType="appointment"
      sourceId={appointment.id}
      disabled={loading || !!refreshError || incomplete}
      bind:working={busy}
      onNavigate={() => {
        appointmentOpen = false;
      }}
    />
  {/if}
  <div class="mt-4"><ErrorNotice message={actionError} /></div>
  {#snippet footer()}{#if canManage && appointment}{#if appointment.status === 'SCHEDULED'}<Button
          {disabled}
          onclick={() => startArrival(appointment)}>Enregistrer l’arrivée</Button
        ><Button variant="ghost" disabled={busy} onclick={() => appointmentAction('no-show')}
          >Absent</Button
        ><Button variant="ghost" disabled={busy} onclick={() => appointmentAction('cancel')}
          >Annuler</Button
        >{:else if appointment.status === 'ARRIVED'}<Button
          disabled={busy}
          onclick={() => appointmentAction('complete')}>Terminer le rendez-vous</Button
        >{/if}{/if}{/snippet}
</Drawer>
<LocationFormModal
  bind:open={showCreateSite}
  location={null}
  lockedType={null}
  defaultType="OTHER"
  oncreated={onSiteCreated}
/>
