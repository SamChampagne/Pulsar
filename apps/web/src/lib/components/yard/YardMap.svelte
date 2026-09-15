<script lang="ts">
  import {
    yardSpotLabel,
    type YardPlanShape,
    type YardWorkspaceSpot,
    type YardWorkspaceVisit,
  } from '@pulsar/shared';
  import { Button } from '$lib/components/ui';
  let {
    spots,
    visits,
    shapes,
    editing = false,
    canManage = false,
    selected = '',
    onselect,
    ondropvisit,
    onposition,
  }: {
    spots: YardWorkspaceSpot[];
    visits: YardWorkspaceVisit[];
    shapes: YardPlanShape[];
    editing?: boolean;
    canManage?: boolean;
    selected?: string;
    onselect: (kind: 'spot' | 'shape', id: string) => void;
    ondropvisit: (visitId: string, spotId: string) => void;
    onposition: (kind: 'spot' | 'shape', id: string, x: number, y: number) => void;
  } = $props();
  let zoom = $state(0.8);
  const cols = $derived(
    Math.min(
      64,
      Math.max(8, ...spots.map((s) => (s.posX ?? 0) + 2), ...shapes.map((s) => s.x + s.width + 1)),
    ),
  );
  const rows = $derived(
    Math.min(
      64,
      Math.max(5, ...spots.map((s) => (s.posY ?? 0) + 2), ...shapes.map((s) => s.y + s.height + 1)),
    ),
  );
  const placed = $derived(spots.filter((s) => s.posX != null && s.posY != null));
  const unplaced = $derived(spots.filter((s) => s.posX == null || s.posY == null));
  function occupants(id: string) {
    return visits.filter((v) => v.spotId === id);
  }
  function drag(e: DragEvent, kind: 'spot' | 'shape', id: string) {
    if (!e.dataTransfer) return;
    if (editing)
      e.dataTransfer.setData('application/pulsar-yard-layout', JSON.stringify({ kind, id }));
    else if (kind === 'spot' && canManage && occupants(id).length === 1)
      e.dataTransfer.setData('application/pulsar-yard-visit', occupants(id)[0].id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function dropLayout(e: DragEvent & { currentTarget: HTMLDivElement }) {
    if (!editing || !e.dataTransfer) return;
    e.preventDefault();
    try {
      const p = JSON.parse(e.dataTransfer.getData('application/pulsar-yard-layout'));
      const r = e.currentTarget.getBoundingClientRect();
      onposition(
        p.kind,
        p.id,
        Math.max(0, Math.min(63, Math.floor((e.clientX - r.left) / (120 * zoom)))),
        Math.max(0, Math.min(63, Math.floor((e.clientY - r.top) / (110 * zoom)))),
      );
    } catch {
      /* Ignore unrelated drags. */
    }
  }
</script>

<div class="overflow-hidden rounded-xl border border-edge bg-surface">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2">
    <p class="text-xs text-ink-muted">
      {editing
        ? 'Dessin du site · aucune affectation réelle'
        : 'Occupation actuelle · cliquer pour agir'}
    </p>
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        aria-label="Réduire le plan"
        disabled={zoom <= 0.4}
        onclick={() => {
          zoom = Math.max(0.4, +(zoom - 0.2).toFixed(1));
        }}>−</Button
      ><span class="w-12 text-center font-mono text-xs">{Math.round(zoom * 100)} %</span><Button
        variant="ghost"
        aria-label="Agrandir le plan"
        disabled={zoom >= 1.4}
        onclick={() => {
          zoom = Math.min(1.4, +(zoom + 0.2).toFixed(1));
        }}>+</Button
      >
    </div>
  </div>
  {#if !editing && placed.length === 0 && shapes.length === 0}
    <div class="flex min-h-80 items-center justify-center bg-surface-muted p-8 text-center">
      <div class="max-w-sm">
        <h3 class="text-base font-semibold">
          {spots.length ? 'Emplacements à disposer' : 'Le plan de ce site reste à préparer'}
        </h3>
        <p class="mt-2 text-sm leading-relaxed text-ink-muted">
          {spots.length
            ? 'Les emplacements restent accessibles ci-dessous. Leur disposition sur le dessin ne change pas les affectations.'
            : 'Aucun quai ou stationnement n’est configuré pour ce site. Le plan ne contient pas de données de démonstration.'}
        </p>
        {#if canManage}<p class="mt-3 text-sm text-ink-muted">
            {spots.length
              ? 'Utilisez « Configurer le plan » pour les placer.'
              : 'Commencez par « Gérer les quais et emplacements », puis configurez le plan.'}
          </p>{/if}
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must be able to scroll this bounded canvas) -->
    <div class="map-scroll" tabindex="0" role="region" aria-label="Plan interactif du site">
      <div style={`width:${cols * 120 * zoom}px;height:${rows * 110 * zoom}px;position:relative`}>
        <div
          class="site-canvas"
          style={`width:${cols * 120}px;height:${rows * 110}px;transform:scale(${zoom})`}
          role="group"
          aria-label="Emplacements du site"
          ondragover={(e) => {
            if (editing) e.preventDefault();
          }}
          ondrop={dropLayout}
        >
          {#each shapes as s (s.id)}<button
              class={`site-shape ${s.kind.toLowerCase()} ${selected === s.id ? 'selected' : ''}`}
              style={`left:${s.x * 120}px;top:${s.y * 110}px;width:${s.width * 120 - 8}px;height:${s.height * 110 - 8}px`}
              draggable={editing}
              ondragstart={(e) => drag(e, 'shape', s.id)}
              disabled={!editing}
              onclick={() => onselect('shape', s.id)}
              ><span class="shape-kind"
                >{s.kind === 'BUILDING' ? 'Bâtiment' : s.kind === 'GATE' ? 'Accès' : 'Zone'}</span
              ><span>{s.label}</span></button
            >{/each}
          {#each placed as spot (spot.id)}
            {@const active = occupants(spot.id)}{@const occupied = active.length > 0}
            <button
              class={`spot ${spot.type === 'DOCK_DOOR' ? 'dock' : 'parking'} ${occupied ? 'occupied' : 'free'} ${!spot.isActive ? 'inactive' : ''} ${active.length > 1 ? 'conflict' : ''} ${selected === spot.id ? 'selected' : ''}`}
              style={`left:${spot.posX! * 120}px;top:${spot.posY! * 110}px`}
              aria-label={`${yardSpotLabel(spot.type)} ${spot.code} — ${!spot.isActive ? 'inactif' : active.length > 1 ? `${active.length} visites, conflit` : occupied ? `occupé, ${active[0].trailer?.unitNumber ?? active[0].trailerRef ?? active[0].visitNumber}` : 'libre'}`}
              draggable={editing || (canManage && active.length === 1)}
              ondragstart={(e) => drag(e, 'spot', spot.id)}
              onclick={() => onselect('spot', spot.id)}
              ondragover={(e) => {
                if (!editing && canManage && spot.isActive && !occupied) e.preventDefault();
              }}
              ondrop={(e) => {
                if (editing) return;
                e.stopPropagation();
                e.preventDefault();
                const id = e.dataTransfer?.getData('application/pulsar-yard-visit');
                if (id && canManage && spot.isActive && !occupied) ondropvisit(id, spot.id);
              }}
            >
              <span class="spot-top"
                ><strong>{spot.code}</strong><span class="status-dot"></span></span
              >
              {#if occupied}<span class="trailer"
                  ><span
                    >{active[0].trailer?.unitNumber ??
                      active[0].trailerRef ??
                      active[0].visitNumber}</span
                  ></span
                >{:else}<span class="empty-bay">{spot.type === 'DOCK_DOOR' ? '▥' : 'P'}</span>{/if}
              <span class="spot-caption"
                >{!spot.isActive
                  ? 'Hors service'
                  : active.length > 1
                    ? 'Conflit à résoudre'
                    : occupied
                      ? 'Occupé'
                      : yardSpotLabel(spot.type)}</span
              >
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
  {#if unplaced.length}<div class="border-t border-edge p-3">
      <p class="mb-2 text-xs text-ink-muted">
        Emplacements non dessinés ({unplaced.length}) — {editing
          ? 'glisser sur le plan ou sélectionner puis saisir les coordonnées'
          : 'ils restent utilisables'}
      </p>
      <div class="flex flex-wrap gap-2">
        {#each unplaced as s (s.id)}<button
            class="rounded-md border border-edge px-3 py-2 text-sm hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent"
            draggable={editing}
            ondragstart={(e) => drag(e, 'spot', s.id)}
            onclick={() => onselect('spot', s.id)}
            >{s.code} · {!s.isActive
              ? 'inactif'
              : occupants(s.id).length > 1
                ? 'conflit'
                : occupants(s.id).length
                  ? 'occupé'
                  : 'libre'}</button
          >{/each}
      </div>
    </div>{/if}
  <div class="flex flex-wrap gap-4 border-t border-edge px-4 py-2 text-xs text-ink-muted">
    <span>○ Libre</span><span class="text-info">● Occupé</span><span class="text-danger"
      >● Conflit</span
    ><span>▧ Hors service</span><span class="ml-auto">Schéma indicatif · sans échelle physique</span
    >
  </div>
</div>

<style>
  .map-scroll {
    max-height: 64dvh;
    min-height: 22rem;
    overflow: auto;
    background: var(--color-surface-muted);
  }
  .site-canvas {
    position: relative;
    transform-origin: top left;
    background-image: radial-gradient(var(--color-edge) 1px, transparent 1px);
    background-size: 24px 22px;
  }
  .site-shape {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border: 2px solid var(--color-edge);
    border-radius: 0.4rem;
    color: var(--color-ink-muted);
    font-size: 0.95rem;
    background: var(--color-surface);
    overflow: hidden;
  }
  .site-shape.building {
    background: repeating-linear-gradient(
      135deg,
      var(--color-surface),
      var(--color-surface) 12px,
      var(--color-surface-muted) 12px,
      var(--color-surface-muted) 14px
    );
    box-shadow: 0 5px 0 var(--color-edge);
  }
  .site-shape.area {
    border-style: dashed;
    background: transparent;
  }
  .site-shape.gate {
    border-width: 0 6px;
    border-radius: 0;
    background: var(--color-surface);
  }
  .shape-kind {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .spot {
    position: absolute;
    width: 108px;
    height: 100px;
    padding: 7px 8px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    border: 1px solid var(--color-edge);
    border-radius: 7px;
    background: var(--color-surface);
    color: var(--color-ink);
    box-shadow: 0 2px 4px #00000008;
    transition:
      box-shadow 160ms,
      border-color 160ms;
  }
  .spot:hover {
    border-color: var(--color-ink-muted);
    box-shadow: 0 4px 12px #00000014;
  }
  .spot:focus-visible,
  .site-shape:focus-visible,
  .selected {
    outline: 3px solid var(--color-accent);
    outline-offset: 3px;
  }
  .spot.dock {
    border-top: 5px solid var(--color-ink-muted);
  }
  .spot.occupied {
    border-color: var(--color-info);
  }
  .spot.conflict {
    border-color: var(--color-danger);
  }
  .spot.inactive {
    opacity: 0.6;
    border-style: dashed;
  }
  .spot-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.78rem;
    gap: 0.25rem;
  }
  .spot-top strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border: 1px solid var(--color-ink-faint);
    border-radius: 50%;
  }
  .occupied .status-dot {
    background: var(--color-info);
    border: 0;
  }
  .conflict .status-dot {
    background: var(--color-danger);
  }
  .trailer {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    height: 37px;
    margin: 3px 6px;
    background: var(--color-info-soft);
    border: 1px solid var(--color-info);
    border-radius: 3px;
    font: 0.7rem monospace;
  }
  .trailer span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0 3px;
  }
  .trailer::before,
  .trailer::after {
    content: '';
    position: absolute;
    bottom: 4px;
    width: 3px;
    height: 11px;
    background: var(--color-ink-muted);
  }
  .trailer::before {
    left: -4px;
  }
  .trailer::after {
    right: -4px;
  }
  .empty-bay {
    font-size: 1.7rem;
    line-height: 1;
    color: var(--color-ink-faint);
  }
  .spot-caption {
    text-align: center;
    color: var(--color-ink-muted);
    font-size: 0.64rem;
  }
</style>
