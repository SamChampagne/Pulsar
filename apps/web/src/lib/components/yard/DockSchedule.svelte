<script lang="ts">
  import { yardAppointmentConflicts, yardStatusLabel, type YardWorkspace } from '@pulsar/shared';
  let { workspace, onopen }: { workspace: YardWorkspace; onopen: (id: string) => void } = $props();
  const conflicts = $derived(new Set(yardAppointmentConflicts(workspace.appointments)));
  const start = $derived(+new Date(workspace.start)),
    duration = $derived(+new Date(workspace.end) - start);
  const lanes = $derived([
    ...workspace.spots
      .filter(
        (s) => s.type === 'DOCK_DOOR' || workspace.appointments.some((a) => a.spotId === s.id),
      )
      .map((s) => ({ id: s.id, code: s.code })),
    { id: '', code: 'Sans quai' },
  ]);
  const ticks = $derived(
    Array.from({ length: Math.ceil(duration / 3600000) }, (_, i) => start + i * 3600000),
  );
  function clock(n: number) {
    return new Intl.DateTimeFormat('fr-CA', {
      timeZone: workspace.timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(n);
  }
  function left(s: string) {
    return Math.max(0, Math.min(100, ((+new Date(s) - start) / duration) * 100));
  }
</script>

<div class="overflow-hidden rounded-xl border border-edge bg-surface">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-edge p-4">
    <div>
      <h2 class="text-sm font-semibold">Planning des quais</h2>
      <p class="mt-1 text-xs text-ink-muted">
        {workspace.date} · {workspace.timeZone} · cliquer sur un rendez-vous
      </p>
    </div>
    {#if conflicts.size}<span class="text-sm text-danger"
        >{conflicts.size} rendez-vous en conflit</span
      >{/if}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must be able to scroll the hourly grid) -->
  <div class="overflow-x-auto" role="region" aria-label="Planning horaire des quais" tabindex="0">
    <div class="min-w-[960px]">
      <div class="flex border-b border-edge">
        <div class="sticky left-0 z-10 w-28 shrink-0 bg-surface px-3 py-3 text-xs text-ink-muted">
          Quai
        </div>
        <div class="relative mr-8 h-10 flex-1">
          {#each ticks as t, i (t)}{#if i % 2 === 0}<span
                class="absolute top-3 text-[10px] text-ink-muted"
                style={`left:${((t - start) / duration) * 100}%`}>{clock(t)}</span
              >{/if}{/each}
        </div>
      </div>
      {#each lanes as lane (lane.id)}
        {@const rows = workspace.appointments.filter(
          (a) => (workspace.spots.some((s) => s.id === a.spotId) ? a.spotId : '') === lane.id,
        )}
        <div class="flex border-b border-edge-soft last:border-0">
          <div class="sticky left-0 z-10 w-28 shrink-0 bg-surface px-3 py-4 text-sm font-medium">
            {lane.code}
          </div>
          <div
            class="relative mr-8 flex-1"
            style={`min-height:${Math.max(60, rows.length * 44 + 12)}px`}
          >
            {#each ticks as t (t)}<span
                class="pointer-events-none absolute inset-y-0 border-l border-edge-soft"
                style={`left:${((t - start) / duration) * 100}%`}
              ></span>{/each}
            {#if rows.length === 0}<span class="relative block px-2 py-5 text-xs text-ink-faint"
                >Aucun rendez-vous</span
              >{/if}
            {#each rows as a, i (a.id)}<button
                class={`absolute h-9 overflow-hidden rounded-md border px-2 text-left text-xs transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-accent ${conflicts.has(a.id) ? 'border-danger bg-danger-soft text-danger' : ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status) ? 'border-edge bg-surface-muted text-ink-muted' : 'border-info/40 bg-info-soft text-ink'}`}
                style={`left:${left(a.windowStart)}%;width:${Math.max(0.4, left(a.windowEnd) - left(a.windowStart))}%;top:${6 + i * 44}px`}
                title={`${a.appointmentNumber} · ${a.carrier?.name ?? a.reference ?? ''} · ${clock(+new Date(a.windowStart))}–${clock(+new Date(a.windowEnd))} · ${yardStatusLabel(a.status)}${conflicts.has(a.id) ? ' · Conflit horaire' : ''}`}
                aria-label={`Rendez-vous ${a.appointmentNumber}, ${lane.code}, ${yardStatusLabel(a.status)}${conflicts.has(a.id) ? ', conflit horaire' : ''}`}
                onclick={() => onopen(a.id)}
                ><span class="block truncate font-medium">{a.appointmentNumber}</span><span
                  class="block truncate text-[10px]"
                  >{a.carrier?.name ?? a.reference ?? yardStatusLabel(a.status)}</span
                ></button
              >{/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
  <p class="border-t border-edge px-4 py-2 text-xs text-ink-muted">
    Les chevauchements sont signalés, pas résolus automatiquement. Le planning ne déplace aucune
    visite.
  </p>
</div>
