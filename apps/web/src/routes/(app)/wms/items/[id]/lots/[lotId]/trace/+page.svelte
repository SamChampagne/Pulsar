<script lang="ts">
  import { page } from '$app/stores';
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import { PageHeader, Button, Field, Select, Skeleton } from '$lib/components/ui';
  import type {
    LotTraceResult,
    LotTraceNode,
    LotTraceDossier,
    LotTraceDirection,
    Paginated,
  } from '@pulsar/shared';

  let direction = $state<LotTraceDirection>('downstream'),
    depth = $state('3');
  let view = $state<LotTraceResult | null>(null),
    loading = $state(true),
    error = $state('');
  let selected = $state<LotTraceNode | null>(null),
    kind = $state('picks'),
    current = $state(1);
  let dossiers = $state<(Paginated<LotTraceDossier> & { generatedAt: string }) | null>(null);
  let reading = $state(false),
    dossierError = $state('');
  let generation = 0,
    dossierGeneration = 0;
  const root = $derived(view?.nodes.find((n) => n.id === view?.rootId));
  const levels = $derived(
    [...new Set(view?.nodes.map((n) => n.depth) ?? [])].sort((a, b) => a - b),
  );
  const lotUrl = (n: LotTraceNode) => `/wms/items/${n.itemId}/lots?lotId=${n.id}`;
  $effect(() => {
    const { id, lotId } = $page.params;
    const d = direction,
      limit = Number(depth);
    untrack(() => {
      void load(id!, lotId!, d, limit);
    });
  });
  async function load(id: string, lotId: string, d: LotTraceDirection, limit: number) {
    const g = ++generation;
    dossierGeneration++;
    loading = true;
    error = '';
    view = null;
    selected = null;
    dossiers = null;
    try {
      const r = await api<LotTraceResult>(`/wms/items/${id}/lots/${lotId}/trace`, {
        query: { direction: d, depth: limit },
      });
      if (g !== generation) return;
      view = r;
      const n = r.nodes.find((n) => n.id === r.rootId);
      if (n) void readDossiers(n, 'picks', 1);
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  async function readDossiers(n: LotTraceNode, k: string, p: number) {
    const g = ++dossierGeneration;
    selected = n;
    kind = k;
    current = p;
    reading = true;
    dossierError = '';
    dossiers = null;
    try {
      const r = await api<NonNullable<typeof dossiers>>(
        `/wms/items/${n.itemId}/lots/${n.id}/trace-dossiers`,
        { query: { kind: k, page: p, pageSize: 10 } },
      );
      if (g === dossierGeneration) dossiers = r;
    } catch (e) {
      if (g === dossierGeneration) dossierError = (e as Error).message;
    } finally {
      if (g === dossierGeneration) reading = false;
    }
  }
  const labels: Record<string, string> = {
    OPEN: 'Ouvert',
    PICKED: 'Prélevé',
    COMPLETED: 'Terminé',
    POSTED: 'Validé au stock',
    CANCELLED: 'Annulé',
    DRAFT: 'Brouillon',
    PLANNED: 'Planifié',
    IN_PROGRESS: 'En cours',
  };
  const statusLabel = (s: string) => labels[s] ?? s;
</script>

<svelte:head><title>Traçabilité du lot | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-5">
  <PageHeader
    title="Traçabilité du lot"
    eyebrow="Entrepôt · Lecture seule"
    subtitle="Des matières aux produits, à partir des mouvements réellement enregistrés."
  >
    {#snippet actions()}<Button
        variant="secondary"
        href={`/wms/items/${$page.params.id}/lots?lotId=${$page.params.lotId}`}
        >Retour au lot</Button
      >{/snippet}
  </PageHeader>
  <div class="flex flex-wrap items-end gap-3 rounded-lg border border-edge bg-surface p-4">
    <div class="min-w-0 w-64">
      <Field label="Sens du parcours"
        ><Select bind:value={direction}
          ><option value="downstream">Aval · produits issus du lot</option><option value="upstream"
            >Amont · matières d’origine</option
          ></Select
        ></Field
      >
    </div>
    <div class="w-40">
      <Field label="Profondeur"
        ><Select bind:value={depth}
          >{#each [1, 2, 3, 4] as d}<option value={String(d)}>{d} niveau{d > 1 ? 'x' : ''}</option
            >{/each}</Select
        ></Field
      >
    </div>
    <Button
      variant="secondary"
      disabled={loading}
      onclick={() => load($page.params.id!, $page.params.lotId!, direction, Number(depth))}
      >Actualiser la lecture</Button
    >
  </div>
  {#if loading}<Skeleton rows={6} />{:else if error}<div
      role="alert"
      class="rounded-lg border border-edge p-4 text-danger"
    >
      {error}
      <p class="mt-2 text-sm text-ink-muted">
        Aucun résultat affiché. Vous pouvez actualiser la lecture.
      </p>
    </div>{:else if view && root}
    <section class="space-y-3" aria-label="Périmètre de la traçabilité">
      <div>
        <h2 class="text-lg font-semibold break-words">
          {root.code} <span class="font-normal text-ink-muted">· {root.name}</span>
        </h2>
        <p class="text-xs text-ink-muted">
          Lecture du {formatDateTime(view.generatedAt)} · {view.nodes.length} lots visibles · {view
            .edges.length} liens déclarés
        </p>
      </div>
      <p class="max-w-4xl text-sm text-ink-muted">
        Une relation relie les matières et le produit d’une même déclaration atelier. Les quantités
        sont celles de la déclaration entière, jamais une allocation par pièce. Cette vue ne
        certifie ni la qualité, ni une livraison, ni l’exhaustivité d’un rappel.
      </p>
      {#if !view.scopes.manufacturing}<p class="rounded-lg bg-surface-muted p-3 text-sm">
          Parcours atelier indisponible : Fabrication activé et droit de lecture requis. Les
          dossiers WMS restent accessibles.
        </p>{/if}
      {#if view.notices.length}<details open class="rounded-lg border border-edge p-3">
          <summary class="cursor-pointer text-sm font-semibold"
            >{view.bounded ? 'Parcours partiel' : 'Points à vérifier'} · {view.notices
              .length}</summary
          >
          <ul class="mt-2 space-y-2 text-sm text-ink-muted">
            {#each view.notices as n}<li>
                {n.message}
                {#if n.order}<a
                    class="text-accent underline"
                    href={`/manufacturing/orders/${n.order.id}`}>{n.order.number}</a
                  >{/if}
              </li>{/each}
          </ul>
        </details>{/if}
    </section>
    <section aria-label="Parcours des lots" class="space-y-4">
      {#each levels as level}<div class="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <h3 class="pt-3 text-xs font-semibold text-ink-muted">
            {level === 0 ? 'LOT DE DÉPART' : `NIVEAU ${level}`}
          </h3>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {#each view.nodes.filter((n) => n.depth === level) as n (n.id)}<button
                type="button"
                aria-pressed={selected?.id === n.id}
                onclick={() => readDossiers(n, kind, 1)}
                class={`min-w-0 rounded-lg border bg-surface p-4 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${selected?.id === n.id ? 'border-accent' : 'border-edge'}`}
                ><span class="block font-semibold break-words">{n.code}</span><span
                  class="mt-1 block text-sm break-words">{n.name}</span
                ><span class="mt-1 block text-xs text-ink-muted break-all">{n.sku}</span><span
                  class="mt-3 block text-xs text-ink-muted"
                  >{n.disposition === 'QUARANTINED'
                    ? 'En quarantaine actuellement'
                    : 'Sans blocage de lot actuellement'} · Voir les dossiers</span
                ></button
              >{/each}
          </div>
        </div>{/each}
      {#if !view.edges.length}<p class="rounded-lg bg-surface-muted p-4 text-sm text-ink-muted">
          Aucun lien atelier vérifiable dans ce périmètre. Cela ne prouve pas l’absence d’autres
          utilisations.
        </p>{:else}<details class="rounded-lg border border-edge p-4" open>
          <summary class="cursor-pointer text-sm font-semibold">Preuves des liens atelier</summary>
          <ul class="mt-3 divide-y divide-edge">
            {#each view.edges as e (e.id)}<li class="space-y-2 py-3 text-sm">
                <p class="font-medium break-words">
                  {view.nodes.find((n) => n.id === e.fromLotId)?.code} → {view.nodes.find(
                    (n) => n.id === e.toLotId,
                  )?.code}
                </p>
                <p class="text-ink-muted">
                  Matière : {e.input.quantity}
                  {e.input.unit} · {e.input.binCode} → Production totale : {e.output.quantity}
                  {e.output.unit} · {e.output.binCode}
                </p>
                <p class="text-xs text-ink-muted">
                  <a class="text-accent underline" href={`/manufacturing/orders/${e.order.id}`}
                    >{e.order.number}</a
                  >
                  · {formatDateTime(e.createdAt)} · quantités et unités capturées
                </p>
              </li>{/each}
          </ul>
        </details>{/if}
    </section>
    {#if selected}<section
        aria-label="Dossiers du lot sélectionné"
        class="space-y-4 rounded-lg border border-edge bg-surface p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold break-words">Dossiers · {selected.code}</h2>
            <p class="mt-1 max-w-3xl text-xs text-ink-muted">
              Liens directs de ce lot, toutes dates confondues. Un brouillon ou une préparation
              n’est pas une sortie physique; un shipment lié n’est pas une preuve de livraison. Les
              retours Services restent visibles.
            </p>
          </div>
          <Button variant="ghost" href={lotUrl(selected)}>Ouvrir le lot</Button
          >{#if selected.id !== root.id}<Button
              variant="secondary"
              href={`/wms/items/${selected.itemId}/lots/${selected.id}/trace`}
              >Repartir de ce lot</Button
            >{/if}
        </div>
        <div class="max-w-xs">
          <Field label="Type de dossiers"
            ><Select
              bind:value={kind}
              onchange={() => {
                if (selected) void readDossiers(selected, kind, 1);
              }}
              ><option value="picks">Préparations WMS</option><option value="receipts"
                >Réceptions WMS</option
              >{#if view.scopes.services}<option value="services"
                  >Pièces utilisées en Services</option
                >{/if}</Select
            ></Field
          >
        </div>
        <p class="text-xs text-ink-muted">
          {!view.scopes.services ? 'Dossiers Services hors périmètre de vos accès. ' : ''}{!view
            .scopes.transportation
            ? 'Liens Transport hors périmètre de vos accès.'
            : ''}
        </p>
        {#if reading}<p class="text-sm text-ink-muted" role="status">
            Lecture des dossiers…
          </p>{:else if dossierError}<p role="alert" class="text-sm text-danger">{dossierError}</p>
          <Button
            variant="secondary"
            onclick={() => {
              if (selected) void readDossiers(selected, kind, current);
            }}>Réessayer les dossiers</Button
          >{:else if dossiers}
          <p class="text-xs text-ink-muted">
            {dossiers.total} lignes · Lecture du {formatDateTime(dossiers.generatedAt)}
          </p>
          {#if !dossiers.items.length}<p class="text-sm text-ink-muted">
              Aucun dossier direct dans cette catégorie.
            </p>{/if}
          <ul class="divide-y divide-edge">
            {#each dossiers.items as d (d.id)}<li class="space-y-2 py-3 text-sm">
                <div class="flex flex-wrap justify-between gap-2">
                  <a class="font-medium text-accent underline" href={d.href}
                    >{d.number} · {d.title}</a
                  ><span class="text-xs text-ink-muted">{statusLabel(d.status)}</span>
                </div>
                <p>
                  {d.quantity}
                  {d.unit ?? 'unité non capturée'}{#if !d.unitCaptured}<span
                      class="text-xs text-ink-muted"
                    >
                      · unité actuelle de l’article</span
                    >{/if}{#if d.returnedQuantity !== undefined}
                    · Retourné : {d.returnedQuantity} · Net retenu : {d.retainedQuantity}{/if}
                </p>
                {#if d.context}<a class="text-accent underline" href={d.context.href}
                    >{d.context.label}</a
                  >{/if}{#if d.client}<p class="text-xs text-ink-muted">
                    Client actuel du projet : {d.client}
                  </p>{/if}
                <p class="text-xs text-ink-muted">{formatDateTime(d.createdAt)}</p>
              </li>{/each}
          </ul>
          {#if dossiers.total > 10}<div class="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={current === 1}
                onclick={() => {
                  if (selected) void readDossiers(selected, kind, current - 1);
                }}>Page précédente</Button
              ><span class="text-sm">Page {current}</span><Button
                variant="secondary"
                disabled={current * 10 >= dossiers.total}
                onclick={() => {
                  if (selected) void readDossiers(selected, kind, current + 1);
                }}>Page suivante</Button
              >
            </div>{/if}
        {/if}
      </section>{/if}
  {/if}
</div>
