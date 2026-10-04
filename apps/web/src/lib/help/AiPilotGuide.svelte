<script lang="ts">
  import { ArrowUpRight, Check, Copy, ShieldCheck } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
  import type { AiPilot } from './ai-pilot';

  let {
    pilots,
    pilotKey = '',
    canManageConnection = false,
  }: {
    pilots: readonly AiPilot[];
    pilotKey?: string;
    canManageConnection?: boolean;
  } = $props();
  const selected = $derived(pilots.find((pilot) => pilot.key === pilotKey));
  let checked = $state<number[]>([]);
  let copyStatus = $state('');
  async function copyPrompt() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.promptTemplate);
      copyStatus = 'Consigne copiée. Remplacez les repères et relisez-la avant de la transmettre.';
    } catch {
      copyStatus = 'Copie indisponible. Sélectionnez et copiez le texte ci-dessous manuellement.';
    }
  }
</script>

<article
  class="min-w-0 rounded-lg border border-edge bg-surface p-5 sm:p-8"
  aria-label="Parcours pilote IA"
>
  <header class="border-b border-edge pb-5">
    <p class="mb-2 flex items-center gap-2 text-xs text-ink-muted">
      <ShieldCheck size={14} />Préparer une première mission · Mode proposition
    </p>
    <h2 class="text-2xl font-semibold tracking-tight">Mettre l’IA au travail</h2>
    <p class="mt-3 max-w-prose text-sm leading-6 text-ink-muted">
      Choisissez un cas réel, limitez les outils du worker et contrôlez les preuves avant toute
      décision. Cette page prépare votre essai; elle ne lance aucun agent.
    </p>
    <p
      class="mt-4 rounded-md bg-surface-muted p-3 text-xs leading-5 text-ink-muted"
      data-testid="pilot-boundary"
    >
      Checklist manuelle, non enregistrée. Elle ne vérifie ni votre connexion, ni le runtime, ni les
      permissions effectives de l’agent. Aucun appel au modèle ni action métier n’est effectué ici.
      Une mission exécutée ensuite peut consommer des crédits selon le fournisseur.
    </p>
  </header>

  <nav aria-label="Parcours IA disponibles" class="my-5 flex flex-wrap gap-2">
    <a
      href="/documentation?view=ai-pilot"
      class="rounded-md border border-edge px-3 py-2 text-xs text-ink-muted hover:bg-surface-muted"
      >Choisir un parcours</a
    >
    {#each pilots as pilot}<a
        href={`/documentation?view=ai-pilot&pilot=${pilot.key}`}
        aria-current={selected?.key === pilot.key ? 'page' : undefined}
        class={`max-w-full rounded-md border px-3 py-2 text-xs ${selected?.key === pilot.key ? 'border-accent bg-accent-soft text-accent' : 'border-edge text-ink-muted hover:bg-surface-muted'}`}
        >{pilot.title}</a
      >{/each}
  </nav>

  {#if pilotKey && !selected}
    <h3 class="font-semibold">Parcours non accessible</h3>
    <p class="mt-2 text-sm text-ink-muted">
      Ce parcours n’existe pas ou ses applications et droits de consultation ne sont pas disponibles
      pour votre compte.
    </p>
  {:else if selected}
    <h3 class="text-xl font-semibold">{selected.title}</h3>
    <p class="mt-2 text-sm leading-6 text-ink-muted">{selected.summary}</p>
    <div class="mt-3 flex flex-wrap gap-2 text-xs text-ink-muted">
      <span class="rounded bg-surface-muted px-2 py-1">Preset : {selected.presetId}</span><span
        class="rounded bg-surface-muted px-2 py-1"
        >{selected.context === 'ASSIGNED_TASK'
          ? 'Worker sur tâche affectée'
          : 'Conversation supervisée'}</span
      >
    </div>

    <section class="mt-6" aria-label="Préparation manuelle">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold">Préparer la mission</h4>
        <span class="text-xs text-ink-muted" role="status"
          >{checked.length}/{selected.steps.length} étapes cochées manuellement</span
        >
      </div>
      <ol class="mt-3 divide-y divide-edge rounded-md border border-edge">
        {#each selected.steps as step, index}<li class="p-4">
            <label class="flex cursor-pointer items-start gap-3"
              ><input
                type="checkbox"
                bind:group={checked}
                value={index}
                class="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              /><span class="min-w-0"
                ><span class="block text-sm font-semibold">{index + 1}. {step.title}</span><span
                  class="mt-1 block text-sm leading-6 text-ink-muted">{step.body}</span
                ></span
              ></label
            >
          </li>{/each}
      </ol>
      <p class="mt-2 text-xs leading-5 text-ink-muted">
        Les coches sont effacées en quittant ce parcours. Elles ne valent pas autorisation
        d’exécution.
      </p>
    </section>

    <section class="mt-6 rounded-md bg-surface-muted p-4" aria-label="Conditions d’arrêt du pilote">
      <h4 class="font-semibold">Ne pas lancer si…</h4>
      <ul class="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-ink-muted">
        {#each selected.blockers as blocker}<li>{blocker}</li>{/each}
      </ul>
    </section>

    <section class="mt-6" aria-label="Consigne à relire">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h4 class="font-semibold">Consigne de départ à adapter</h4>
        <Button variant="secondary" onclick={copyPrompt}
          ><Copy size={14} />Copier la consigne</Button
        >
      </div>
      {#if selected.context === 'ASSIGNED_TASK'}<p class="mt-3 text-sm leading-6 text-ink-muted">
          À utiliser dans le parcours de tâche affectée décrit ci-dessus. Coller ce texte dans un
          chat ne crée pas le contexte signé du worker.
        </p>{/if}
      <textarea
        aria-label="Consigne du pilote"
        readonly
        value={selected.promptTemplate}
        rows={12}
        class="mt-3 w-full resize-y rounded-md border border-edge bg-surface-muted p-4 font-mono text-xs leading-6 text-ink"
        spellcheck="false"
      ></textarea>
      <p class="mt-2 text-xs leading-5 text-ink-muted" role="status">
        {copyStatus ||
          'Remplacez les identifiants d’exemple. Ne collez aucun secret ni donnée inutile à la mission.'}
      </p>
    </section>

    <section class="mt-6" aria-label="Preuves attendues">
      <h4 class="font-semibold">Ce qu’une mission utile doit produire</h4>
      <ul class="mt-3 space-y-3">
        {#each selected.expectedEvidence as evidence}<li
            class="flex items-start gap-2 text-sm leading-6"
          >
            <Check size={16} class="mt-1 shrink-0 text-ink-muted" /><span>{evidence}</span>
          </li>{/each}
      </ul>
      <p class="mt-3 text-xs leading-5 text-ink-muted">
        Ce sont des critères à contrôler dans les résultats réels, pas des validations obtenues par
        cette page.
      </p>
    </section>

    <details class="mt-6 rounded-md border border-edge p-4">
      <summary class="cursor-pointer text-sm font-semibold"
        >Outils et droits à configurer sur l’agent</summary
      >
      <p class="mt-3 text-xs leading-5 text-ink-muted">
        Les droits de votre compte et ceux du worker sont distincts. Un administrateur configure
        l’agent; un approbateur habilité confirme les propositions. Les modules, la liste d’outils
        autorisés, les policies et les plafonds restent appliqués côté serveur.
      </p>
      <ul class="mt-3 space-y-3">
        {#each selected.tools as tool}<li
            class="min-w-0 rounded bg-surface-muted p-3 text-xs leading-5"
          >
            <code class="break-all font-semibold">{tool.name}</code><span
              class="ml-2 text-ink-muted"
              >{tool.tier === 'READ' ? 'Lecture' : 'Proposition de modification'}</span
            >
            <p class="mt-1 break-words text-ink-muted">
              Droits : {[tool.permission, ...(tool.additionalPermissions ?? [])].join(
                ', ',
              )}{#if tool.module}
                · Application : {tool.module}{/if}{#if tool.additionalModules?.length}
                + {tool.additionalModules.join(', ')}{/if}
            </p>
          </li>{/each}
      </ul>
    </details>
    <div class="mt-6 flex flex-wrap gap-3">
      <Button variant="secondary" href={selected.nextAction.href}
        >{selected.nextAction.label}<ArrowUpRight size={14} /></Button
      >{#if canManageConnection}<Button variant="ghost" href="/settings/agent-runtime"
          >Vérifier la connexion IA</Button
        >{/if}
    </div>
    <nav
      aria-label="Suivre le pilote dans Pulsar"
      class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm"
    >
      {#if selected.operatorPermissions.includes('core.agents.read')}<a
          class="text-accent underline underline-offset-4"
          href="/agents">Voir les agents</a
        >{/if}
      {#if selected.operatorPermissions.includes('core.agents.actions.read')}<a
          class="text-accent underline underline-offset-4"
          href="/agent-actions">Voir les propositions</a
        >{/if}
      {#if selected.context === 'ASSIGNED_TASK' && selected.operatorPermissions.includes('core.operating.tasks.read')}<a
          class="text-accent underline underline-offset-4"
          href="/workbench">Voir les tâches affectées</a
        >{/if}
    </nav>
    <details class="mt-6 border-t border-edge pt-4">
      <summary class="cursor-pointer text-xs text-ink-muted">Références de l’implémentation</summary
      >
      <ul class="mt-3 space-y-2 text-xs text-ink-muted">
        {#each selected.sources as source}<li><code class="break-all">{source}</code></li>{/each}
      </ul>
    </details>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each pilots as pilot}<a
          href={`/documentation?view=ai-pilot&pilot=${pilot.key}`}
          class="min-w-0 rounded-md border border-edge p-5 transition-colors hover:bg-surface-muted"
          ><h3 class="font-semibold">{pilot.title}</h3>
          <p class="mt-2 text-sm leading-6 text-ink-muted">{pilot.summary}</p>
          <span class="mt-4 inline-flex items-center gap-1 text-sm text-accent"
            >Préparer ce parcours<ArrowUpRight size={14} /></span
          ></a
        >{/each}
    </div>
    {#if !pilots.length}<p class="rounded-md bg-surface-muted p-4 text-sm leading-6 text-ink-muted">
        Aucun parcours pilote ne correspond à vos applications et droits de consultation actuels.
        Votre administrateur peut vérifier vos accès. Les guides généraux restent disponibles dans
        la documentation.
      </p>{/if}
  {/if}
</article>
