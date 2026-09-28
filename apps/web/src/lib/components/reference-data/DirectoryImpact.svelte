<script lang="ts">
  import type {
    DirectoryImpactView,
    DirectoryImpactSource,
    DirectoryImpactScope,
  } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import { Button, Badge, ErrorNotice, Skeleton, EmptyState } from '$lib/components/ui';
  let { endpoint, onback }: { endpoint: string; onback: () => void } = $props();
  let view = $state<DirectoryImpactView | null>(null),
    source = $state<DirectoryImpactSource | ''>(''),
    scope = $state<DirectoryImpactScope>('DRAFT'),
    page = $state(1),
    revision = $state(0),
    loading = $state(true),
    error = $state('');
  const statuses: Record<string, string> = {
    DRAFT: 'Brouillon',
    ACCEPTED: 'Accepté',
    CONFIRMED: 'Confirmé',
    PLANNED: 'Planifié',
    IN_EXECUTION: 'En exécution',
    COMPLETED: 'Terminé',
    CLOSED: 'Clôturé',
    CANCELLED: 'Annulé',
    APPROVED: 'Approuvé',
    SENT: 'Envoyé',
    PAID: 'Payé',
    FULFILLED: 'Exécuté',
    INVOICED: 'Facturé',
  };
  $effect(() => {
    const path = endpoint,
      s = source,
      state = scope,
      p = page;
    void revision;
    let stale = false;
    loading = true;
    error = '';
    void api<DirectoryImpactView>(path, {
      query: { source: s || undefined, scope: state, page: p, pageSize: 10 },
    })
      .then((result) => {
        if (!stale) view = result;
      })
      .catch((e) => {
        if (!stale) {
          error = e.message;
          view = null;
        }
      })
      .finally(() => {
        if (!stale) loading = false;
      });
    return () => {
      stale = true;
    };
  });
</script>

<section aria-label="Documents utilisant cette entrée" class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <Button variant="ghost" onclick={onback}>Retour au carnet</Button>
    <Button
      variant="secondary"
      disabled={loading}
      onclick={() => {
        revision++;
      }}>Actualiser les usages</Button
    >
  </div>
  <div>
    <h2 class="text-lg font-semibold">Documents utilisant cette entrée</h2>
    {#if view}<p class="mt-1 break-words text-sm font-medium">
        {view.entry.label} · version actuelle {view.entry.version}
      </p>{/if}
    <p class="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
      Repérez les brouillons à revoir avant engagement. Les copies déjà engagées restent intactes,
      même si le carnet change. Aucune mise à jour automatique.
    </p>
    <p class="mt-2 text-xs text-ink-muted">
      Périmètre limité aux documents capturés et à vos modules et droits de lecture. Un résultat
      vide ne prouve pas une absence d’usage ailleurs.
    </p>
  </div>
  <ErrorNotice
    message={error}
    onretry={() => {
      revision++;
    }}
  />
  {#if view}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1 text-sm"
        >Type de document
        <select
          class="min-w-0 rounded-md border border-edge bg-surface px-3 py-2"
          disabled={loading || !view.sources.length}
          value={source || view.source || ''}
          onchange={(e) => {
            source = e.currentTarget.value as DirectoryImpactSource;
            page = 1;
          }}
        >
          {#if !view.sources.length}<option value="">Aucun type accessible</option>{/if}
          {#each view.sources as s}<option value={s.key}
              >{s.label} · {s.drafts} brouillons / {s.frozen} copies engagées</option
            >{/each}
        </select>
      </label>
      <label class="grid gap-1 text-sm"
        >Périmètre
        <select
          class="min-w-0 rounded-md border border-edge bg-surface px-3 py-2"
          disabled={loading}
          bind:value={scope}
          onchange={() => {
            page = 1;
          }}
        >
          <option value="DRAFT">Brouillons à vérifier</option><option value="FROZEN"
            >Copies engagées · historique</option
          >
        </select>
      </label>
    </div>
  {/if}
  {#if loading}<Skeleton rows={4} />{:else if view}
    <p class="text-xs text-ink-muted">
      Lu le {formatDateTime(view.observedAt)} · validité de l’entrée au {view.referenceDate} ({view.timeZone}).
      Cette lecture ne valide pas l’ensemble du dossier.
    </p>
    {#if !view.items.length}<EmptyState
        title={view.sources.length
          ? 'Aucun document dans ce périmètre'
          : 'Aucun type de document accessible'}
        message="Les dossiers sans copie du carnet, les autres identités et les modules sans droit de lecture ne sont pas inclus."
      />
    {:else}<ul class="divide-y divide-edge rounded-lg border border-edge">
        {#each view.items as item (`${view.source}:${item.id}`)}<li class="space-y-3 p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="font-mono text-sm font-semibold">{item.number}</p>
                <p class="text-xs text-ink-muted">{statuses[item.status] ?? item.status}</p>
              </div>
              <Badge
                tone={item.frozenAt ? 'neutral' : item.roles.some((r) => r.issue) ? 'warn' : 'ok'}
                >{item.frozenAt
                  ? 'Copie conservée'
                  : item.roles.some((r) => r.issue)
                    ? 'À revoir'
                    : 'Entrée à jour'}</Badge
              >
            </div>
            <ul class="space-y-2 text-sm">
              {#each item.roles as role}<li>
                  <p>{role.label} · version choisie {role.selectedVersion}</p>
                  {#if role.issue}<p class="mt-1 text-xs text-warn">{role.issue}</p>{/if}
                </li>{/each}
            </ul>
            {#if item.frozenAt}<p class="text-xs text-ink-muted">
                Figée le {formatDateTime(item.frozenAt)}. Le carnet actuel ne réécrit pas cet
                engagement.
              </p>{/if}
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-9 items-center text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >Ouvrir {item.number} dans un nouvel onglet</a
            >
          </li>{/each}
      </ul>{/if}
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span class="tabular-nums">{view.total} documents accessibles · page {view.page}</span>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onclick={() => {
            page--;
          }}>Précédent</Button
        ><Button
          variant="secondary"
          disabled={page * view.pageSize >= view.total}
          onclick={() => {
            page++;
          }}>Suivant</Button
        >
      </div>
    </div>
  {/if}
</section>
