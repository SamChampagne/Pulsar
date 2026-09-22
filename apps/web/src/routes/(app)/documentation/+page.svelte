<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import { BookOpen, ArrowUpRight, Play, Search } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains, domainHome } from '$lib/modules/navigation';
  import { knowledgeArticles, matchesKnowledge, contextualGuides } from '$lib/help/knowledge';
  import { requestModuleTour } from '$lib/help/tours';
  import { PageHeader, Button } from '$lib/components/ui';
  import ModuleConnections from '$lib/components/help/ModuleConnections.svelte';
  import SectorRoadmap from '$lib/components/help/SectorRoadmap.svelte';
  let search = $state('');
  const domains = $derived(
    visibleDomains({
      enabledModules: $auth?.tenant.enabledModules ?? [],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    }),
  );
  const articles = $derived(knowledgeArticles(domains));
  const filtered = $derived(articles.filter((a) => matchesKnowledge(a, search)));
  const selectedKey = $derived(
    page.url.searchParams.has('view')
      ? ''
      : (page.url.searchParams.get('module') ?? 'documentation'),
  );
  const connectionsView = $derived(page.url.searchParams.get('view') === 'connections');
  const roadmapView = $derived(page.url.searchParams.get('view') === 'roadmap');
  const article = $derived(articles.find((a) => a.key === selectedKey));
  const details = $derived(article ? contextualGuides(article) : []);
  let launching = $state(false);
  async function tutorial() {
    const domain = domains.find((d) => d.key === article?.key);
    if (!domain || launching) return;
    launching = true;
    try {
      await goto(domainHome(domain));
      await tick();
      requestModuleTour();
    } finally {
      launching = false;
    }
  }
</script>

<svelte:head
  ><title>Documentation | Pulsar</title><meta
    name="description"
    content="Guides, règles métier et tutoriels des applications Pulsar."
  /></svelte:head
>
<div class="mx-auto max-w-7xl">
  <PageHeader
    title="Documentation"
    subtitle="Les parcours, les règles et les connexions de vos applications."
  />
  <div class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
    <aside
      class="rounded-lg border border-edge bg-surface p-3 lg:sticky lg:top-4 lg:max-h-[80dvh] lg:self-start lg:overflow-auto"
    >
      <a
        href="/documentation?view=connections"
        aria-current={connectionsView ? 'page' : undefined}
        class={`mb-3 block rounded-md px-3 py-2 text-sm font-medium ${connectionsView ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface-muted'}`}
        >Liens entre modules</a
      >
      <a
        href="/documentation?view=roadmap"
        aria-current={roadmapView ? 'page' : undefined}
        class={`mb-3 block rounded-md px-3 py-2 text-sm font-medium ${roadmapView ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface-muted'}`}
        >Modules spécialisés à venir</a
      >
      <label class="mb-3 flex items-center gap-2 rounded-md border border-edge px-3 py-2"
        ><Search size={16} class="shrink-0 text-ink-muted" /><input
          aria-label="Rechercher dans la documentation"
          class="min-w-0 w-full bg-transparent text-sm outline-none"
          bind:value={search}
          placeholder="Rechercher une règle…"
        /></label
      >
      <label class="block text-xs text-ink-muted lg:hidden"
        >Choisir un guide
        <select
          aria-label="Guide à consulter"
          value={selectedKey}
          onchange={(e) => void goto(`/documentation?module=${e.currentTarget.value}`)}
          class="mt-1 min-h-10 w-full rounded-md border border-edge bg-surface px-3 text-sm text-ink"
        >
          <option value="" disabled>Choisir un guide…</option>
          {#each filtered as item}<option value={item.key}>{item.title}</option>{/each}
        </select>
      </label>
      <nav aria-label="Guides des applications" class="hidden space-y-1 lg:block">
        {#each filtered as item}<a
            href={`/documentation?module=${item.key}`}
            aria-current={selectedKey === item.key ? 'page' : undefined}
            class={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${selectedKey === item.key ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}`}
            ><BookOpen size={15} />{item.title}</a
          >{/each}
      </nav>
      {#if !filtered.length}<p class="px-3 py-4 text-sm text-ink-muted">
          Aucun guide ne correspond. Essayez « stock », « projet » ou « facture ».
        </p>{/if}
      <p class="mt-4 px-3 text-xs leading-5 text-ink-muted">
        Les guides affichés correspondent à vos accès. Les autres applications s’ajoutent lorsque
        votre administrateur les active et vous autorise à les consulter.
      </p>
    </aside>
    {#if roadmapView}<SectorRoadmap {search} />{:else if connectionsView}<article
        class="min-w-0 rounded-lg border border-edge bg-surface p-5 sm:p-8"
        aria-label="Guide des liens entre modules"
      >
        <ModuleConnections {domains} {search} />
      </article>
    {:else if article}<article
        class="min-w-0 rounded-lg border border-edge bg-surface p-5 sm:p-8"
        aria-label={`Guide ${article.title}`}
      >
        <div class="mb-6 border-b border-edge pb-6">
          <p class="mb-2 text-xs text-ink-muted">Guide d’utilisation · Version du logiciel</p>
          <h2 class="text-2xl font-semibold tracking-tight">{article.title}</h2>
          <p class="mt-3 max-w-prose leading-7 text-ink-muted">{article.purpose}</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onclick={tutorial} loading={launching}
              ><Play size={15} />Lancer le tutoriel</Button
            >{#if article.key !== 'documentation'}<Button
                variant="ghost"
                href={domainHome(domains.find((d) => d.key === article.key)!)}
                >Ouvrir l’application<ArrowUpRight size={15} /></Button
              >{/if}
          </div>
        </div>
        <div class="max-w-prose space-y-7 text-sm leading-7">
          <nav
            aria-label="Sommaire du guide"
            class="flex flex-wrap gap-x-4 gap-y-2 border-b border-edge pb-4 text-sm"
          >
            <a href="#guide-start" class="text-accent underline">Démarrer</a><a
              href="#guide-rules"
              class="text-accent underline">Règles métier</a
            ><a href="#guide-links" class="text-accent underline">Connexions</a><a
              href="#guide-limits"
              class="text-accent underline">Limites</a
            >
          </nav>
          <section id="guide-start">
            <h3 class="mb-2 text-base font-semibold">Avant de commencer</h3>
            <p class="text-ink-muted">{article.prerequisites}</p>
          </section>
          <section>
            <h3 class="mb-2 text-base font-semibold">Parcours conseillé</h3>
            <ol class="list-decimal space-y-2 pl-5">
              {#each article.steps as step}<li>{step}</li>{/each}
            </ol>
          </section>
          <section>
            <h3 id="guide-rules" class="mb-2 text-base font-semibold">Règles métier</h3>
            <ul class="list-disc space-y-3 pl-5">
              {#each article.rules as rule}<li>{rule}</li>{/each}
            </ul>
          </section>
          <section class="rounded-md bg-surface-muted p-4">
            <h3 class="mb-2 font-semibold">Exemple de travail</h3>
            <p>{article.example}</p>
          </section>
          <section id="guide-links">
            <h3 class="mb-2 text-base font-semibold">Connexions avec les autres applications</h3>
            <p class="text-ink-muted">{article.connections}</p>
            <div class="mt-5"><ModuleConnections module={article.key} {domains} /></div>
          </section>
          {#each details as detail}<section>
              <h3 class="mb-2 text-base font-semibold">{detail.label}</h3>
              <p class="text-ink-muted">{detail.purpose}</p>
              <ol class="mt-2 list-decimal space-y-1 pl-5">
                {#each detail.steps as step}<li>{step}</li>{/each}
              </ol>
              {#if detail.caution}<p class="mt-2 text-ink-muted">{detail.caution}</p>{/if}
            </section>{/each}
          <section>
            <h3 id="guide-limits" class="mb-2 text-base font-semibold">Limites à connaître</h3>
            <ul class="list-disc space-y-2 pl-5 text-ink-muted">
              {#each article.limits as limit}<li>{limit}</li>{/each}
            </ul>
          </section>
          <section>
            <h3 class="mb-2 text-base font-semibold">Accéder aux écrans</h3>
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              {#each article.links as link}<a
                  class="text-accent underline underline-offset-4"
                  href={link.href}>{link.label}</a
                >{/each}
            </div>
          </section>
        </div>
      </article>{:else}<div class="rounded-lg border border-edge bg-surface p-8">
        <h2 class="font-semibold">Guide non accessible</h2>
        <p class="mt-2 text-sm text-ink-muted">
          Choisissez une application dans la liste. Ce guide n’existe pas ou votre compte n’a pas
          accès à son module.
        </p>
      </div>{/if}
  </div>
</div>
