<script lang="ts">
  import type { PartyWorkspaceSource, PartyWorkspaceView } from '@pulsar/shared';
  import { ArrowUpRight, RefreshCw } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import { Button, Badge, ErrorNotice, Skeleton, EmptyState } from '$lib/components/ui';
  import { labelFor, toneFor } from '$lib/components/ui/status';
  import { formatDateTime as fmtDateTime } from '$lib/format';
  let { endpoint, onopen }: { endpoint: string; onopen: () => void } = $props();
  let data = $state<PartyWorkspaceView | null>(null),
    source = $state<PartyWorkspaceSource | undefined>(),
    search = $state(''),
    page = $state(1),
    revision = $state(0),
    loading = $state(true),
    error = $state('');
  const current = $derived(data?.sections.find((s) => s.key === data?.source));
  $effect(() => {
    const path = endpoint,
      selected = source,
      text = search,
      number = page;
    void revision;
    let cancelled = false;
    loading = true;
    error = '';
    const timer = setTimeout(() => {
      api<PartyWorkspaceView>(`${path}/workspace`, {
        query: { source: selected, search: text, page: number, pageSize: 10 },
      })
        .then((r) => {
          if (!cancelled) data = r;
        })
        .catch((e) => {
          if (!cancelled) {
            error = (e as Error).message;
            data = null;
          }
        })
        .finally(() => {
          if (!cancelled) loading = false;
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<section aria-label="Dossiers connectés" class="min-w-0 space-y-5">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="max-w-prose space-y-1">
      <h3 class="font-semibold text-ink">Une fiche, les dossiers liés</h3>
      <p class="text-sm text-ink-muted">
        Lecture seule · Liens explicites actuels · Aucun rapprochement par nom
      </p>
    </div>
    <Button
      variant="ghost"
      disabled={loading}
      onclick={() => {
        revision++;
      }}><RefreshCw size={14} />Actualiser</Button
    >
  </div>
  <p class="text-xs leading-relaxed text-ink-muted">
    Seuls les dossiers de vos modules autorisés apparaissent. Les correspondances entre fiches
    restent celles de Rapprochement : aucun lien indirect, transfert ou fusion d’historique. Tous
    les statuts sont inclus; ces compteurs ne sont ni un solde financier ni une liste de tâches.
  </p>
  <ErrorNotice message={error} />
  {#if error}<Button
      variant="secondary"
      onclick={() => {
        revision++;
      }}>Réessayer</Button
    >{/if}
  {#if loading && !data}<Skeleton rows={5} />
  {:else if data && !data.sections.length}
    <EmptyState
      title="Aucune section accessible"
      message="Vous pouvez consulter la fiche, mais aucun module de dossiers n’est accessible avec vos droits actuels. Aucun compteur masqué n’est affiché."
    />
  {:else if data}
    <div class="grid min-w-0 gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <label class="grid gap-1 text-sm md:hidden"
        >Type de dossier
        <select
          aria-label="Type de dossier"
          class="w-full min-w-0 rounded-lg border border-edge bg-surface px-3 py-2"
          value={data.source ?? ''}
          onchange={(e) => {
            source = e.currentTarget.value as PartyWorkspaceSource;
            page = 1;
            search = '';
          }}
        >
          {#each data.sections as section}<option value={section.key}
              >{section.label} ({section.total})</option
            >{/each}
        </select>
      </label>
      <nav
        aria-label="Types de dossiers"
        class="hidden flex-col gap-1 md:flex md:border-r md:border-edge md:pr-4"
      >
        {#each data.sections as section}
          <button
            type="button"
            aria-pressed={data.source === section.key}
            class="flex min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent {data.source ===
            section.key
              ? 'bg-accent/10 font-medium text-accent'
              : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}"
            onclick={() => {
              source = section.key;
              page = 1;
              search = '';
            }}
          >
            <span>{section.label}</span><span class="tabular-nums text-xs">{section.total}</span>
          </button>
        {/each}
      </nav>
      <div class="min-w-0 space-y-4">
        <header class="space-y-1">
          <h4 class="font-semibold">{current?.label}</h4>
          <p class="text-xs text-ink-muted">{current?.relation}</p>
        </header>
        <label class="grid gap-1 text-xs text-ink-muted"
          >Rechercher dans cette section
          <input
            type="search"
            class="w-full min-w-0 rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink"
            maxlength={120}
            value={search}
            placeholder="Référence ou titre"
            oninput={(e) => {
              search = e.currentTarget.value;
              page = 1;
            }}
          />
        </label>
        <p class="text-xs tabular-nums text-ink-muted" role="status">
          {#if loading}Actualisation…{:else}{data.total} résultat{data.total > 1 ? 's' : ''}{search
              ? ' pour cette recherche'
              : ''} · Tous les statuts{/if}
        </p>
        {#if loading}<Skeleton rows={3} />{:else if !data.items.length}
          <EmptyState
            title="Aucun dossier dans cette sélection"
            message={search
              ? 'Essayez une autre référence ou un autre titre.'
              : 'Cette fiche et ses identités directement liées n’ont aucun dossier de ce type. Vérifiez Rapprochement si une connexion manque; aucun dossier n’est créé ici.'}
          />
        {:else}
          <ul class="divide-y divide-edge rounded-lg border border-edge">
            {#each data.items as row (row.id)}
              <li>
                <a
                  href={row.href}
                  onclick={onopen}
                  class="group flex min-w-0 items-start gap-3 p-3 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="break-all font-mono text-xs">{row.reference}</span><Badge
                        tone={toneFor(row.status)}>{labelFor(row.status)}</Badge
                      >
                    </div>
                    <p class="break-words text-sm font-medium">{row.title}</p>
                    <p class="text-xs text-ink-muted">Modifié {fmtDateTime(row.updatedAt)}</p>
                  </div>
                  <ArrowUpRight
                    size={16}
                    class="mt-1 shrink-0 text-ink-muted group-hover:text-accent"
                    aria-hidden="true"
                  />
                  <span class="sr-only">Ouvrir le dossier source</span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
        {#if !loading && (data.total > data.pageSize || page > 1)}<div
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <Button
              variant="secondary"
              disabled={page <= 1}
              onclick={() => {
                page--;
              }}>Précédent</Button
            >
            <span class="text-xs tabular-nums text-ink-muted"
              >Page {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}</span
            >
            <Button
              variant="secondary"
              disabled={page * data.pageSize >= data.total}
              onclick={() => {
                page++;
              }}>Suivant</Button
            >
          </div>{/if}
      </div>
    </div>
    <p class="text-xs text-ink-muted">
      Lu {fmtDateTime(data.observedAt)}. Ouvrez un dossier source pour connaître ses blocages et
      effectuer l’action métier.
    </p>
  {/if}
</section>
