<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    HR_AVAILABILITY_LABELS,
    type HrAvailabilityInput,
    type HrAvailabilityResult,
  } from '@pulsar/shared';
  import { Button } from '$lib/components/ui';
  let {
    entries,
    summary = false,
    results = $bindable({}),
  }: {
    entries: (HrAvailabilityInput & { key: string })[];
    summary?: boolean;
    results?: Record<string, HrAvailabilityResult['items'][number]>;
  } = $props();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const permitted = $derived($auth?.user.permissions.includes('hr.availability.read'));
  const enabled = $derived($auth?.tenant.enabledModules.includes('hr'));
  let refresh = $state(0),
    loading = $state(false),
    error = $state(''),
    checkedAt = $state('');
  let generation = 0;
  const absent = $derived(Object.values(results).filter((r) => r.state === 'ABSENT').length);
  const unknown = $derived(
    Object.values(results).filter((r) => !['ABSENT', 'NO_APPROVED_ABSENCE'].includes(r.state))
      .length,
  );
  $effect(() => {
    const items = entries.map(({ key, userId, scheduledAt }) => ({ key, userId, scheduledAt }));
    const canRead = permitted && enabled;
    // Discard results across session, role, module or draft changes, including in-flight responses.
    void $auth?.user.id;
    void $auth?.tenant.id;
    void refresh;
    const g = ++generation;
    results = {};
    checkedAt = '';
    error = '';
    loading = !!canRead && !!items.length;
    const timer =
      canRead && items.length
        ? setTimeout(async () => {
            try {
              const data = await api<HrAvailabilityResult>('/services/availability/check', {
                method: 'POST',
                body: {
                  timeZone,
                  items: items.map(({ userId, scheduledAt }) => ({ userId, scheduledAt })),
                },
              });
              if (g !== generation) return;
              results = Object.fromEntries(items.map((item, i) => [item.key, data.items[i]]));
              checkedAt = data.checkedAt;
            } catch {
              if (g === generation)
                error = 'Non vérifié : contrôle RH indisponible. Vérifiez les accès et actualisez.';
            } finally {
              if (g === generation) loading = false;
            }
          }, 250)
        : undefined;
    return () => {
      clearTimeout(timer);
      ++generation;
    };
  });
</script>

<svelte:window
  onfocus={() => {
    refresh++;
  }}
/>
<section
  class="rounded-lg border border-edge bg-surface-muted p-3"
  aria-label={summary ? 'Contrôle RH des interventions' : 'Contrôle RH de l’affectation'}
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="text-xs font-semibold text-ink">Absences RH · jour du début</h3>
    {#if enabled && permitted && entries.length}
      <Button
        variant="ghost"
        disabled={loading}
        onclick={() => {
          refresh++;
        }}>Actualiser les absences</Button
      >
    {/if}
  </div>
  <div class="mt-1 text-sm" role="status" aria-live="polite" aria-busy={loading}>
    {#if !enabled}<p class="text-ink-muted">Non vérifié · module RH désactivé.</p>
    {:else if !permitted}<p class="text-ink-muted">
        Non vérifié · droit hr.availability.read requis. Aucun accès aux motifs RH n’est nécessaire.
      </p>
    {:else if !entries.length}<p class="text-ink-muted">
        {summary
          ? 'Aucune intervention ouverte avec personne et horaire sur cette page.'
          : 'Choisissez une personne et une date/heure valides pour vérifier.'}
      </p>
    {:else if loading}<p class="text-ink-muted">Vérification des absences…</p>
    {:else if error}<p class="text-warn">{error}</p>
    {:else if summary}<p class:text-warn={absent > 0 || unknown > 0}>
        {entries.length} intervention(s) vérifiée(s) sur cette page · {absent} en conflit d’absence ·
        {unknown} non vérifiée(s).
      </p>
    {:else}{#each Object.values(results) as result}<p
          class:text-warn={result.state !== 'NO_APPROVED_ABSENCE'}
        >
          {HR_AVAILABILITY_LABELS[result.state]} · <span class="tabular-nums">{result.date}</span>
        </p>{/each}{/if}
  </div>
  <p class="mt-2 text-xs leading-5 text-ink-muted">
    Fuseau : {timeZone}. {#if checkedAt}Vérifié à {new Date(checkedAt).toLocaleTimeString('fr-CA')}.
    {/if}
    Indication à la lecture, pas une réservation. Les horaires restent modifiables; les autres occupations
    ne sont pas contrôlées.
  </p>
</section>
