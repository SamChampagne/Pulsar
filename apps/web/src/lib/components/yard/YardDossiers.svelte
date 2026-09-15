<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS } from '@pulsar/shared';
  import { Button, ErrorNotice, Field, Input, Select, Skeleton } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    YARD_DOSSIER_LABELS,
    yardDossierStatus,
    type YardDossierContext,
    type YardDossierItem,
    type YardDossierKind,
    type YardDossierSource,
  } from '@pulsar/shared';
  let {
    sourceType,
    sourceId,
    disabled = false,
    working = $bindable(false),
    onNavigate = () => {},
  }: {
    sourceType: YardDossierSource;
    sourceId: string;
    disabled?: boolean;
    working?: boolean;
    onNavigate?: () => void;
  } = $props();
  let context = $state<YardDossierContext | null>(null),
    loading = $state(true),
    error = $state(''),
    actionError = $state('');
  let adding = $state(false),
    kind = $state<YardDossierKind>('load'),
    query = $state(''),
    selected = $state('');
  let candidates = $state<YardDossierItem[]>([]),
    searching = $state(false),
    searchError = $state(''),
    truncated = $state(false);
  let generation = 0;
  const path = $derived(`/yard/dossiers/${sourceType}/${encodeURIComponent(sourceId)}`);
  const canEdit = $derived(
    !!context?.editable &&
      !!$auth?.user.permissions.includes(PERMISSIONS.YARD.MANAGE) &&
      !disabled &&
      !error,
  );
  const choices = $derived(
    candidates.filter(
      (c) => !context?.groups.find((g) => g.kind === kind)?.items.some((i) => i.id === c.id),
    ),
  );
  async function load() {
    const request = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<YardDossierContext>(path);
      if (request === generation) context = result;
    } catch (e) {
      if (request === generation)
        error = `Dossiers non actualisés. ${e instanceof Error ? e.message : 'Réessayez.'}`;
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    sourceId;
    sourceType;
    adding = false;
    selected = '';
    context = null;
    void load();
    return () => {
      generation++;
    };
  });
  $effect(() => {
    const p = path,
      k = kind,
      q = query,
      active = adding;
    let disposed = false;
    selected = '';
    candidates = [];
    searchError = '';
    searching = active;
    if (!active) return;
    const timer = setTimeout(() => {
      api<{ items: YardDossierItem[]; truncated: boolean }>(`${p}/candidates`, {
        query: { kind: k, q },
      })
        .then((r) => {
          if (!disposed) {
            candidates = r.items;
            truncated = r.truncated;
          }
        })
        .catch((e) => {
          if (!disposed) searchError = e.message;
        })
        .finally(() => {
          if (!disposed) searching = false;
        });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  });
  function openEditor() {
    const first = context?.groups.find((g) => g.available);
    if (!first || !canEdit) return;
    kind = first.kind;
    query = '';
    selected = '';
    actionError = '';
    adding = true;
  }
  async function add() {
    const item = choices.find((c) => c.id === selected);
    if (!item || !canEdit || working) return;
    working = true;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          `Relier ${item.number} à ${context!.source.number} ? Cela ne modifie ni le stock, ni le transport, ni leurs statuts.`,
          { title: 'Relier le dossier', confirmLabel: 'Relier' },
        ))
      )
        return;
      await api(`${path}/links`, { method: 'POST', body: { kind, targetId: item.id } });
      adding = false;
      selected = '';
      await load();
    } catch (e) {
      actionError =
        e instanceof ApiError
          ? e.message
          : 'Réponse non confirmée. Vous pouvez réessayer : le même lien ne sera pas créé deux fois.';
    } finally {
      working = false;
    }
  }
  async function remove(item: YardDossierItem) {
    if (!item.linkId || !canEdit || working) return;
    working = true;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          `Retirer l’association avec ${item.number} ? Le dossier est conservé; aucun statut ni stock ne change.`,
          { title: 'Retirer l’association', confirmLabel: 'Retirer', dangerous: true },
        ))
      )
        return;
      await api(`${path}/links/${item.linkId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Retrait non confirmé. Réessayez.';
    } finally {
      working = false;
    }
  }
</script>

<section class="mt-6 border-t border-edge pt-5" aria-label="Dossiers opérationnels liés">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h3 class="text-sm font-semibold">Dossiers opérationnels</h3>
    {#if canEdit && !adding && context?.groups.some((g) => g.available)}<Button
        variant="secondary"
        disabled={working}
        onclick={openEditor}>Relier un dossier</Button
      >{/if}
  </div>
  <p class="mb-4 text-xs leading-relaxed text-ink-muted">
    Associations explicites · aucune transition automatique.
  </p>
  {#if loading}<Skeleton rows={3} />{:else}
    <ErrorNotice message={error} onretry={load} />
    {#if context}
      {#if context.source.sharedWithAppointment}<p
          class="mb-3 rounded-md bg-surface-muted p-3 text-xs text-ink-muted"
        >
          Liste partagée avec le rendez-vous {context.source.number} et son arrivée liée.
        </p>{/if}
      {#if !context.editable}<p class="mb-3 text-xs text-ink-muted">
          Consultation seule : droits insuffisants ou passage terminé.
        </p>{/if}
      <div class="space-y-4">
        {#each context.groups as group (group.kind)}
          <div>
            <h4 class="mb-1 text-xs font-medium text-ink-muted">
              {YARD_DOSSIER_LABELS[group.kind]}
            </h4>
            {#if !group.available}<p class="text-xs text-ink-faint">
                Module ou droit de lecture indisponible.
              </p>
            {:else}
              {#each group.items as item (item.id)}
                <div class="flex items-start justify-between gap-2 rounded-md py-2">
                  <div class="min-w-0">
                    <a
                      href={item.href}
                      class="text-sm font-medium text-accent underline-offset-4 hover:underline"
                      onclick={(e) => {
                        if (working) e.preventDefault();
                        else onNavigate();
                      }}>{item.number} ↗</a
                    >
                    <p class="text-xs text-ink-muted">{yardDossierStatus(item.status)}</p>
                    {#if item.warning}<p class="mt-1 text-xs text-warn">{item.warning}</p>{/if}
                  </div>
                  {#if canEdit}<Button
                      variant="ghost"
                      disabled={working}
                      aria-label={`Retirer le lien ${item.number}`}
                      onclick={() => remove(item)}>Retirer</Button
                    >{/if}
                </div>
              {:else}<p class="text-xs text-ink-faint">Aucun dossier lié.</p>{/each}
              {#if group.truncated}<p class="text-xs text-warn">
                  Affichage limité à 100 liens.
                </p>{/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
  {#if adding && canEdit}<fieldset
      disabled={working}
      class="mt-4 space-y-3 rounded-lg border border-edge bg-surface-muted p-3"
    >
      <Field label="Type de dossier"
        ><Select bind:value={kind}
          >{#each context?.groups.filter((g) => g.available) ?? [] as g (g.kind)}<option
              value={g.kind}>{YARD_DOSSIER_LABELS[g.kind]}</option
            >{/each}</Select
        ></Field
      >
      <Field label="Rechercher un dossier"
        ><Input bind:value={query} maxlength={80} placeholder="Numéro ou référence…" /></Field
      >
      <p class="text-xs text-ink-muted">
        Même site, sens compatible, dossiers non annulés. Aucun rapprochement par simple texte
        libre.
      </p>
      {#if searching}<p class="text-xs text-ink-muted" role="status">
          Recherche…
        </p>{:else if searchError}<ErrorNotice message={searchError} />{:else}
        <Field label="Dossier à relier"
          ><Select bind:value={selected}
            ><option value="">Choisir explicitement un dossier</option
            >{#each choices as c (c.id)}<option value={c.id}
                >{c.number} · {yardDossierStatus(c.status)}</option
              >{/each}</Select
          ></Field
        >
        {#if !choices.length}<p class="text-xs text-ink-muted">
            Aucun dossier compatible non lié dans ces résultats.
          </p>{/if}
        {#if truncated}<p class="text-xs text-warn">
            20 résultats affichés. Précisez le numéro pour trouver un autre dossier.
          </p>{/if}
      {/if}
      <div class="flex gap-2">
        <Button disabled={!selected || searching || !!searchError || working} onclick={add}
          >Relier le dossier</Button
        ><Button
          variant="ghost"
          disabled={working}
          onclick={() => {
            adding = false;
            actionError = '';
          }}>Fermer la recherche</Button
        >
      </div>
    </fieldset>{/if}
  <ErrorNotice message={actionError} />
</section>
