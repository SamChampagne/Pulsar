<script lang="ts">
  import { goto } from '$app/navigation';
  import { ArrowUpRight, ChevronDown, ListFilter, ShieldCheck } from 'lucide-svelte';
  import {
    matchesField,
    matchesFieldGuide,
    visibleToolExamples,
    type FieldGuide,
    type FieldAccess,
  } from './field-reference';

  let {
    guides,
    access,
    search = '',
    topic = '',
    domain = '',
    domainLabels = [],
  }: {
    guides: FieldGuide[];
    access: FieldAccess;
    search?: string;
    topic?: string;
    domain?: string;
    domainLabels?: { key: string; label: string }[];
  } = $props();
  const selected = $derived(topic ? guides.find((guide) => guide.key === topic) : undefined);
  const activeDomain = $derived(selected?.domain || domain || '');
  const availableDomains = $derived(
    domainLabels.filter((entry) => guides.some((guide) => guide.domain === entry.key)),
  );
  const matching = $derived(
    guides.filter(
      (guide) =>
        (!activeDomain || guide.domain === activeDomain) && matchesFieldGuide(guide, search),
    ),
  );
  const fields = $derived(
    selected
      ? selected.fields.filter(
          (field) =>
            matchesField(field, search) ||
            (search.trim() !== '' && matchesFieldGuide({ ...selected, fields: [] }, search)),
        )
      : [],
  );
  const examples = $derived(selected ? visibleToolExamples(selected, access) : []);
  const count = $derived(guides.reduce((total, guide) => total + guide.fields.length, 0));
</script>

<article
  class="min-w-0 rounded-lg border border-edge bg-surface p-5 sm:p-8"
  aria-label="Dictionnaire des champs"
>
  <div class="border-b border-edge pb-5">
    <p class="mb-2 flex items-center gap-2 text-xs text-ink-muted">
      <ListFilter size={14} />Référence pratique · {guides.length} sujets · {count} champs et contrôles
    </p>
    <h2 class="text-2xl font-semibold tracking-tight">Dictionnaire des champs</h2>
    <p class="mt-3 max-w-prose text-sm leading-6 text-ink-muted">
      À quoi sert une donnée, comment la saisir et ce qu’elle change réellement. Recherchez un
      libellé, une unité, un effet métier ou une clé technique dans la recherche de documentation.
    </p>
    <div
      class="mt-4 rounded-md bg-surface-muted p-3 text-xs leading-5 text-ink-muted"
      data-testid="field-coverage"
    >
      Couverture détaillée actuelle : livraison Transport, Entrepôt, Fabrication et connexion/agents
      IA, selon vos accès et les sujets documentés. Les autres modules conservent leurs guides; leur
      dictionnaire au champ près reste à enrichir. Les valeurs par défaut ne sont indiquées que
      lorsqu’elles sont établies dans le logiciel.
    </div>
  </div>

  {#if topic && !selected}
    <div class="py-8" role="status">
      <h3 class="font-semibold">Sujet non accessible</h3>
      <p class="mt-2 text-sm text-ink-muted">
        Ce sujet n’existe pas ou ne correspond pas à vos accès actuels.
      </p>
      <a href="/documentation?view=fields" class="mt-3 inline-block text-sm text-accent underline"
        >Revenir aux sujets disponibles</a
      >
    </div>
  {:else}
    <label class="mt-5 block max-w-sm text-xs font-medium text-ink-muted">
      Application du dictionnaire
      <select
        aria-label="Application du dictionnaire"
        value={activeDomain}
        onchange={(event) =>
          void goto(
            `/documentation?view=fields${event.currentTarget.value ? `&domain=${encodeURIComponent(event.currentTarget.value)}` : ''}`,
          )}
        class="mt-2 min-h-10 w-full rounded-md border border-edge bg-surface px-3 text-sm text-ink"
      >
        <option value="">Toutes mes applications documentées</option>
        {#each availableDomains as entry}<option value={entry.key}>{entry.label}</option>{/each}
      </select>
    </label>
    <nav aria-label="Sujets du dictionnaire" class="my-5 flex flex-wrap gap-2">
      <a
        href="/documentation?view=fields"
        aria-current={!topic ? 'page' : undefined}
        class={`rounded-md border px-3 py-2 text-xs transition-colors ${!topic ? 'border-accent bg-accent-soft text-accent' : 'border-edge text-ink-muted hover:bg-surface-muted'}`}
        >Tous les sujets</a
      >
      {#each matching.length <= 10 ? matching : [] as guide}
        <a
          href={`/documentation?view=fields&topic=${guide.key}`}
          aria-current={selected?.key === guide.key ? 'page' : undefined}
          class={`max-w-full rounded-md border px-3 py-2 text-xs transition-colors ${selected?.key === guide.key ? 'border-accent bg-accent-soft text-accent' : 'border-edge text-ink-muted hover:bg-surface-muted'}`}
          >{guide.title}</a
        >
      {/each}
    </nav>
    {#if matching.length > 10}<p class="mb-4 text-xs leading-5 text-ink-muted">
        {matching.length} sujets disponibles ci-dessous. Choisissez une application ou utilisez la recherche
        pour réduire la liste.
      </p>{/if}
    {#if selected}
      <header class="mb-5">
        <h3 class="text-xl font-semibold">{selected.title}</h3>
        <p class="mt-2 text-sm leading-6 text-ink-muted">{selected.summary}</p>
        <a
          href={selected.href}
          class="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >Ouvrir l’écran<ArrowUpRight size={14} /></a
        >
      </header>
      <details class="mb-5 rounded-md border border-edge bg-surface-muted p-4">
        <summary class="cursor-pointer text-sm font-semibold"
          >Règles et connexions métier · {selected.rules.length} repères</summary
        >
        <ul class="mt-3 list-disc space-y-2 pl-4 text-sm leading-6 text-ink-muted">
          {#each selected.rules as rule}<li>{rule}</li>{/each}
        </ul>
      </details>
      <p class="mb-3 text-xs text-ink-muted" role="status">
        {fields.length} champ{fields.length > 1 ? 's' : ''} et contrôle{fields.length > 1
          ? 's'
          : ''}{search.trim() ? ' correspondant à votre recherche' : ' documentés'}. Ouvrez une
        ligne pour ses conditions et exemples.
      </p>
      <div class="space-y-2">
        {#each fields as field (selected.key + field.key)}
          <details class="group rounded-md border border-edge" data-field={field.key}>
            <summary
              class="flex cursor-pointer list-none items-start justify-between gap-3 p-4 hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
            >
              <span class="min-w-0"
                ><span class="block text-sm font-semibold">{field.label}</span><span
                  class="mt-1 block text-xs leading-5 text-ink-muted"
                  >{field.type} · {field.purpose}</span
                ></span
              >
              <ChevronDown
                size={16}
                class="mt-1 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div class="border-t border-edge p-4">
              <code class="break-all text-xs text-ink-muted">{field.key}</code>
              <dl class="mt-3 grid gap-4 text-sm leading-6 sm:grid-cols-2">
                <div>
                  <dt class="font-semibold">Requis et conditions</dt>
                  <dd class="mt-1 text-ink-muted">{field.required}</dd>
                </div>
                <div>
                  <dt class="font-semibold">Validation</dt>
                  <dd class="mt-1 text-ink-muted">{field.validation}</dd>
                </div>
                {#if field.defaultValue !== undefined}<div>
                    <dt class="font-semibold">Valeur par défaut connue</dt>
                    <dd class="mt-1 text-ink-muted">{field.defaultValue}</dd>
                  </div>{/if}
                <div>
                  <dt class="font-semibold">Exemple</dt>
                  <dd class="mt-1 text-ink-muted">{field.example}</dd>
                </div>
                <div>
                  <dt class="font-semibold">Effet métier</dt>
                  <dd class="mt-1 text-ink-muted">{field.effect}</dd>
                </div>
                <div class="sm:col-span-2">
                  <dt class="font-semibold">Limites et précautions</dt>
                  <dd class="mt-1 text-ink-muted">{field.limits}</dd>
                </div>
              </dl>
            </div>
          </details>
        {/each}
      </div>
      {#if !fields.length}<p class="rounded-md bg-surface-muted p-4 text-sm text-ink-muted">
          Aucun champ de ce sujet ne correspond. Effacez la recherche ou choisissez un autre sujet.
        </p>{/if}
      {#if examples.length}
        <section class="mt-7 border-t border-edge pt-5" aria-label="Exemples d’utilité IA">
          <h4 class="text-base font-semibold">Mises au travail possibles</h4>
          <p class="mt-2 text-sm text-ink-muted">
            Exemples liés aux outils existants et à vos accès, sans exécuter d’action. L’agent
            choisi doit lui aussi posséder les permissions nécessaires.
          </p>
          <div class="mt-4 space-y-3">
            {#each examples as example}<div class="rounded-md border border-edge p-4">
                <h5 class="text-sm font-semibold">{example.title}</h5>
                <blockquote class="my-3 border-l-2 border-accent pl-3 text-sm leading-6">
                  {example.prompt}
                </blockquote>
                <p class="text-sm leading-6 text-ink-muted">{example.result}</p>
                <p class="mt-2 flex items-start gap-2 text-xs leading-5 text-ink-muted">
                  <ShieldCheck size={14} class="mt-0.5 shrink-0" />{example.guard}
                </p>
                <p class="mt-3 break-words font-mono text-xs text-ink-muted">
                  {example.tools.join(' · ')}
                </p>
              </div>{/each}
          </div>
        </section>
      {/if}
      <details class="mt-6 border-t border-edge pt-4">
        <summary class="cursor-pointer text-xs text-ink-muted"
          >Contrats du logiciel utilisés pour ce guide</summary
        >
        <ul class="mt-3 space-y-2">
          {#each selected.sources as source}<li
              class="break-all font-mono text-xs leading-5 text-ink-muted"
            >
              {source}
            </li>{/each}
        </ul>
        <p class="mt-3 text-xs leading-5 text-ink-muted">
          Référence éditoriale des contrats actuels, pas un formulaire de configuration. Les
          contrôles serveur restent la source d’autorité.
        </p>
      </details>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        {#each matching as guide}<a
            href={`/documentation?view=fields&topic=${guide.key}`}
            class="rounded-md border border-edge p-4 transition-colors hover:border-accent hover:bg-surface-muted"
            ><span class="flex items-start justify-between gap-2 text-sm font-semibold"
              >{guide.title}<ArrowUpRight size={15} class="shrink-0 text-ink-muted" /></span
            >
            <p class="mt-2 text-sm leading-6 text-ink-muted">{guide.summary}</p>
            <p class="mt-3 text-xs text-accent">
              {guide.fields.length} champs et contrôles · ouvrir le détail
            </p></a
          >{/each}
      </div>
      {#if !matching.length}<p class="py-5 text-sm text-ink-muted" role="status">
          Aucun sujet ne correspond à la recherche et à vos accès.
        </p>{/if}
    {/if}
  {/if}
</article>
