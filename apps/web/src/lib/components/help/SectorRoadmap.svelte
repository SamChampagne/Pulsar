<script lang="ts">
  import { SECTOR_ROADMAP } from '$lib/help/sector-roadmap';
  import { normalizeKnowledgeSearch } from '$lib/help/knowledge';
  let { search = '' }: { search?: string } = $props();
  const rows = $derived(
    SECTOR_ROADMAP.filter((r) =>
      normalizeKnowledgeSearch(JSON.stringify(r)).includes(normalizeKnowledgeSearch(search)),
    ),
  );
</script>

<article
  aria-label="Programme des modules spécialisés"
  class="rounded-lg border border-edge bg-surface p-5 sm:p-8 space-y-6"
>
  <h2 class="text-xl font-semibold">Modules spécialisés : programme de livraison</h2>
  <p class="max-w-prose text-sm leading-6 text-ink-muted">
    SAV, Qualité et le premier socle RH sont disponibles avec leurs guides et visites interactives.
    Les quatre modules ci-dessous sont des projets documentés, pas des applications utilisables ni
    des tutoriels déjà exécutables. Chaque livraison devra inclure tables métier distinctes,
    contrôles d’accès, workflow complet, tests, documentation et tutoriel réel.
  </p>
  {#each rows as r}<section id={`sector-${r.key}`} class="border-t border-edge pt-5 space-y-4">
      <div>
        <p class="text-xs font-medium text-ink-muted">À développer</p>
        <h3 class="mt-1 text-lg font-semibold">{r.title}</h3>
        <p class="mt-2 text-sm">{r.purpose}</p>
      </div>
      <dl class="space-y-3 text-sm leading-6">
        <div>
          <dt class="font-semibold">Responsabilité des données</dt>
          <dd>{r.owner}</dd>
        </div>
        <div>
          <dt class="font-semibold">Liens entre modules</dt>
          <dd>{r.links}</dd>
        </div>
      </dl>
      <div>
        <h4 class="text-sm font-semibold">Premier parcours attendu</h4>
        <ol class="mt-2 list-decimal pl-5 text-sm leading-6">
          {#each r.flow as step}<li>{step}</li>{/each}
        </ol>
      </div>
      <div>
        <h4 class="text-sm font-semibold">Tutoriel à livrer avec le module</h4>
        <p class="mt-1 text-sm leading-6">{r.tutorial}</p>
      </div>
      <p class="rounded-md bg-surface-muted p-3 text-sm leading-6">{r.gate}</p>
    </section>{/each}
  {#if !rows.length}<p class="text-sm text-ink-muted">
      Aucun module prévu ne correspond à cette recherche.
    </p>{/if}
</article>
