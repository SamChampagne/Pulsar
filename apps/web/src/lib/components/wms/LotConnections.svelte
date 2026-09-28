<script lang="ts">
  import { api } from '$lib/api/client';
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { Button } from '$lib/components/ui';
  import {
    QUALITY_INSPECTION_LABELS,
    type QualityInspectionStatus,
    type Paginated,
  } from '@pulsar/shared';
  let {
    itemId,
    lotId,
    unit,
    revision,
  }: { itemId: string; lotId: string; unit: string; revision: number } = $props();
  type Control = {
    id: string;
    number: string;
    title: string;
    status: QualityInspectionStatus;
    outcome: string | null;
    eligibleForRelease: boolean;
  };
  type Pick = {
    id: string;
    number: string;
    status: string;
    location: { name: string };
    lines: { id: string; qty: string; fromBin: { code: string } }[];
  };
  const quality = $derived(
    $auth?.tenant.enabledModules.includes('quality') &&
      $auth.user.permissions.includes('quality.read'),
  );
  const manageQuality = $derived(quality && $auth?.user.permissions.includes('quality.manage'));
  let view = $state<'quality-inspections' | 'affected-preparations' | null>(null),
    controls = $state<Control[]>([]),
    picks = $state<Pick[]>([]),
    current = $state(1),
    total = $state(0),
    loading = $state(false),
    error = $state('');
  let generation = 0;
  $effect(() => {
    void revision;
    untrack(() => {
      if (view) void read(view, current);
    });
  });
  async function read(next: NonNullable<typeof view>, p = 1) {
    const g = ++generation;
    view = next;
    loading = true;
    error = '';
    controls = [];
    picks = [];
    current = p;
    try {
      const r = await api<Paginated<Control | Pick>>(`/wms/items/${itemId}/lots/${lotId}/${next}`, {
        query: { page: p, pageSize: 10 },
      });
      if (g !== generation) return;
      total = r.total;
      if (next === 'quality-inspections') controls = r.items as Control[];
      else picks = r.items as Pick[];
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
</script>

<section class="space-y-3 border-t border-edge pt-3" aria-label="Dossiers liés au lot">
  <div class="flex flex-wrap gap-2">
    <Button variant="ghost" href={`/wms/stock-exits?itemId=${itemId}&lotId=${lotId}`}>Sorties documentées</Button>
    <Button variant="secondary" href={`/wms/items/${itemId}/lots/${lotId}/trace`}
      >Traçabilité du lot</Button
    >
    <Button variant="ghost" onclick={() => void read('affected-preparations')}
      >Préparations à revoir</Button
    >
    {#if quality}<Button variant="ghost" onclick={() => void read('quality-inspections')}
        >Contrôles Qualité</Button
      >{/if}
    {#if manageQuality}<Button
        variant="secondary"
        href={`/quality?itemId=${encodeURIComponent(itemId)}&lotId=${encodeURIComponent(lotId)}`}
        >Préparer un contrôle</Button
      >{/if}
    {#if view}<Button
        variant="ghost"
        onclick={() => {
          generation++;
          view = null;
        }}>Masquer les dossiers</Button
      >{/if}
  </div>
  {#if view}
    <div class="space-y-3 rounded-lg bg-surface-muted p-3">
      <h3 class="text-sm font-semibold">
        {view === 'quality-inspections'
          ? 'Contrôles de ce lot'
          : 'Préparations ouvertes utilisant ce lot'}
      </h3>
      <p class="max-w-3xl text-xs text-ink-muted">
        {view === 'quality-inspections'
          ? 'Le lot est choisi avant le contrôle. Seul un résultat terminé et conforme, avec un contexte inchangé, peut être cité dans une libération humaine.'
          : 'Uniquement les lignes attribuées à ce lot dans les préparations ouvertes. Aucun dossier n’est annulé ou réaffecté automatiquement. La traçabilité du lot permet de parcourir les liens atelier et les dossiers passés accessibles; le journal reste la preuve des mouvements physiques.'}
      </p>
      {#if loading}<p class="text-sm text-ink-muted">Lecture des dossiers…</p>{:else if error}<p
          role="alert"
          class="text-sm text-danger"
        >
          {error}
        </p>
        <Button
          variant="ghost"
          onclick={() => {
            if (view) void read(view, current);
          }}>Réessayer la lecture</Button
        >{:else}
        {#if !total}<p class="text-sm text-ink-muted">Aucun dossier dans cette vue.</p>{/if}
        {#if view === 'quality-inspections' && quality}<ul class="space-y-3">
            {#each controls as c (c.id)}<li class="border-l-2 border-edge pl-3 text-sm space-y-1">
                <a class="text-accent underline break-words" href={`/quality/inspections/${c.id}`}
                  >{c.number} · {c.title}</a
                >
                <p class="text-xs text-ink-muted">
                  {QUALITY_INSPECTION_LABELS[c.status]} · {c.outcome === 'PASS'
                    ? 'Conforme'
                    : c.outcome === 'FAIL'
                      ? 'Non conforme'
                      : 'Résultat non final'} · {c.eligibleForRelease
                    ? 'Disponible pour une libération'
                    : 'Non disponible pour une libération actuelle'}
                </p>
              </li>{/each}
          </ul>{:else if view === 'affected-preparations'}<ul class="space-y-3">
            {#each picks as p (p.id)}<li class="border-l-2 border-edge pl-3 text-sm space-y-1">
                <a class="text-accent underline" href={`/wms/picking/${p.id}`}>{p.number}</a>
                <p class="text-xs text-ink-muted">
                  {p.location.name} · {p.status === 'OPEN' ? 'Ouverte' : 'Prélevée'}
                </p>
                {#each p.lines as l (l.id)}<p class="text-xs">
                    {l.qty}
                    {unit} · emplacement {l.fromBin.code}
                  </p>{/each}
              </li>{/each}
          </ul>{/if}
        {#if total > 10}<div class="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              disabled={current === 1}
              onclick={() => {
                if (view) void read(view, current - 1);
              }}>Dossiers précédents</Button
            ><span class="text-xs">Page {current} · {total} dossiers</span><Button
              variant="ghost"
              disabled={current * 10 >= total}
              onclick={() => {
                if (view) void read(view, current + 1);
              }}>Dossiers suivants</Button
            >
          </div>{/if}
      {/if}
    </div>
  {/if}
</section>
