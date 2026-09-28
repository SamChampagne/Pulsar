<script lang="ts">
  import {
    derivePilotReadiness,
    PILOT_PROFILES,
    type PilotProfile,
    type PlatformOperations,
  } from '@pulsar/shared';
  import { Button } from '$lib/components/ui';
  let { data, stale = false }: { data: PlatformOperations; stale?: boolean } = $props();
  let profile = $state<PilotProfile>('SERVICES');
  let agents = $state(false);
  const report = $derived(derivePilotReadiness(data, profile, agents));
  const labels = { OBSERVED: 'Observé', BLOCKED: 'À corriger', TO_VERIFY: 'À vérifier' };
  const tones = { OBSERVED: 'text-ink-muted', BLOCKED: 'text-danger', TO_VERIFY: 'text-warn' };
  function download() {
    if (stale) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `pulsar-pilote-${profile.toLowerCase()}-${data.checkedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<section aria-labelledby="pilot-title" class="mb-8 rounded-lg border border-edge p-4 sm:p-5">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="max-w-2xl">
      <h2 id="pilot-title" class="text-lg font-semibold tracking-tight">Préparer le pilote</h2>
      <p class="mt-1 text-sm leading-6 text-ink-muted">
        Choisissez le parcours à tester. Les observations techniques et la recette réelle restent
        distinctes; ce choix ne modifie aucun module.
      </p>
    </div>
    <Button variant="secondary" onclick={download} disabled={stale}>Exporter le précontrôle</Button>
  </div>
  <div class="my-4 flex flex-wrap items-end gap-4">
    <label class="grid gap-1 text-sm font-medium"
      >Profil du pilote
      <select
        aria-label="Profil du pilote"
        bind:value={profile}
        class="rounded-md border border-edge bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        {#each PILOT_PROFILES as p}<option value={p.key}>{p.label}</option>{/each}
      </select>
    </label>
    <label class="flex items-center gap-2 py-2 text-sm"
      ><input type="checkbox" bind:checked={agents} />Inclure les agents IA</label
    >
  </div>
  {#if stale}<p role="status" class="mb-3 text-sm text-warn">
      Observation précédente : actualisez avec succès avant d’exporter. Aucun résultat ancien ne
      valide l’état actuel.
    </p>{/if}
  <div class="mb-4 border-y border-edge py-3" role="status" aria-label="Conclusion du précontrôle">
    <p class="font-medium">
      {report.counts.blocked
        ? 'Blocages détectés avant le pilote'
        : 'Recette terrain encore requise'}
    </p>
    <p class="mt-1 text-xs text-ink-muted">
      <span class="font-mono">{report.counts.blocked}</span> à corriger ·
      <span class="font-mono">{report.counts.observed}</span>
      observations techniques · <span class="font-mono">{report.counts.toVerify}</span> à vérifier
    </p>
  </div>
  <div class="grid gap-6 xl:grid-cols-2">
    {#each [{ key: 'TECHNICAL', title: 'Précontrôles techniques' }, { key: 'ACCEPTANCE', title: 'Recette à documenter' }] as group}
      <section aria-label={group.title} class="min-w-0">
        <h3 class="mb-2 text-sm font-semibold">{group.title}</h3>
        <div class="divide-y divide-edge">
          {#each report.checks.filter((c) => c.kind === group.key) as check (check.key)}
            <details class="group py-2" data-pilot-check={check.key}>
              <summary
                class="cursor-pointer rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span
                  class="inline-flex w-[calc(100%-1.25rem)] items-start justify-between gap-3 align-top"
                >
                  <span class="min-w-0">{check.label}</span><span
                    class="shrink-0 text-xs font-medium {tones[check.state]}"
                    >{labels[check.state]}</span
                  >
                </span>
              </summary>
              <div class="mt-2 space-y-2 pl-4 text-sm leading-6">
                <p class="text-ink-muted">{check.detail}</p>
                <p><span class="font-medium">À faire :</span> {check.nextAction}</p>
              </div>
            </details>
          {/each}
        </div>
      </section>
    {/each}
  </div>
  <p class="mt-4 max-w-3xl text-xs leading-5 text-ink-muted">
    {report.notice} Une exportation conserve cet instantané et sa date, pas le résultat de vos essais
    terrain.
  </p>
</section>
