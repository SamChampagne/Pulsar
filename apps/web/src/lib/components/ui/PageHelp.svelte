<script lang="ts">
  import { page } from '$app/state';
  import { CircleHelp } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains } from '$lib/modules/navigation';
  import { pageGuide, MODULE_GUIDES } from '$lib/help/catalog';
  import { requestModuleTour } from '$lib/help/tours';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  let { title = '' }: { title?: string } = $props();
  let open = $state(false);
  const domains = $derived(
    visibleDomains({
      enabledModules: $auth?.tenant.enabledModules ?? [],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    }),
  );
  const domain = $derived(
    domains
      .map((d) => ({
        d,
        match: Math.max(
          -1,
          ...d.prefixes
            .filter(
              (prefix) =>
                page.url.pathname === prefix || page.url.pathname.startsWith(`${prefix}/`),
            )
            .map((prefix) => prefix.length),
        ),
      }))
      .sort((a, b) => b.match - a.match)
      .find((x) => x.match >= 0)?.d,
  );
  const guide = $derived(pageGuide(page.url.pathname, domain?.key ?? ''));
  const tour = $derived(domain ? MODULE_GUIDES[domain.key] : undefined);
  const links = $derived(domain?.sections.flatMap((section) => section.links) ?? []);
  function startTour() {
    open = false;
    requestModuleTour();
  }
</script>

{#if guide}
  <button
    type="button"
    data-tour="page-help"
    aria-label="Aide sur cette page"
    title="Comprendre cette page"
    class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    onclick={() => (open = true)}><CircleHelp size={17} /></button
  >
  <Modal bind:open title={`Aide — ${title || domain?.label}`} size="lg">
    <div class="space-y-5 text-sm leading-6">
      <section>
        <h3 class="mb-1 font-semibold">À quoi sert cette page ?</h3>
        <p class="text-ink-muted">{guide.purpose}</p>
      </section>
      <section>
        <h3 class="mb-1 font-semibold">Parcours conseillé</h3>
        <ol class="list-decimal space-y-1 pl-5">
          {#each guide.steps as instruction}<li>{instruction}</li>{/each}
        </ol>
      </section>
      <section>
        <h3 class="mb-1 font-semibold">Connexions</h3>
        <p class="text-ink-muted">{guide.connections}</p>
      </section>
      {#if guide.caution}<p class="rounded-md bg-surface-muted p-3 text-ink-muted">
          {guide.caution}
        </p>{/if}
      {#if links.length}<nav aria-label="Écrans du module" class="flex flex-wrap gap-x-4 gap-y-2">
          {#each links as link}<a
              class="text-accent underline underline-offset-4"
              href={link.href}
              onclick={() => {
                open = false;
              }}>{link.label}</a
            >{/each}
        </nav>{/if}
      {#if tour}<Button variant="secondary" onclick={startTour}>Relancer le guide du module</Button
        >{/if}
      {#if domain && domain.key !== 'documentation'}<Button
          variant="ghost"
          href={`/documentation?module=${domain.key}`}
          onclick={() => {
            open = false;
          }}>Documentation complète</Button
        >{/if}
    </div>
  </Modal>
{/if}
