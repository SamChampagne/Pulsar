<script lang="ts">
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { PERMISSIONS, type WmsGuidedDocument, type WmsDocumentLine } from '@pulsar/shared';
  import {
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Input,
    PageHeader,
    RelatedEntities,
    Skeleton,
    StatusTimeline,
  } from '$lib/components/ui';
  import type { RelatedGroup, TimelineEntry, Tone } from '$lib/components/ui';
  import YardRelatedDossiers from '$lib/components/yard/YardRelatedDossiers.svelte';
  import WarehouseLineEditor from './WarehouseLineEditor.svelte';
  let { kind, id }: { kind: 'receipt' | 'pick-order'; id: string } = $props();
  let data = $state<WmsGuidedDocument | null>(null),
    loading = $state(true),
    error = $state('');
  let actionError = $state(''),
    busy = $state(false),
    uncertain = $state(false);
  let editorOpen = $state(false),
    selectedLine = $state<WmsDocumentLine | null>(null),
    query = $state('');
  let generation = 0;
  const receiving = $derived(kind === 'receipt');
  const endpoint = $derived(receiving ? 'receipts' : 'pick-orders');
  const list = $derived(receiving ? '/wms/receiving' : '/wms/picking');
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.WMS.MANAGE));
  const editable = $derived(canManage && data?.status === (receiving ? 'DRAFT' : 'OPEN'));
  const actionable = $derived(
    canManage &&
      !!data &&
      (receiving ? data.status === 'DRAFT' : ['OPEN', 'PICKED'].includes(data.status)),
  );
  const done = $derived(data?.status === (receiving ? 'POSTED' : 'COMPLETED'));
  const checks = $derived(new Map(data?.readiness?.lines.map((c) => [c.lineId, c]) ?? []));
  const visibleLines = $derived(
    data?.lines.filter((l) =>
      `${l.item.sku} ${l.item.name} ${(l.toBin ?? l.fromBin)?.code ?? ''}`
        .toLocaleLowerCase('fr')
        .includes(query.toLocaleLowerCase('fr').trim()),
    ) ?? [],
  );
  const labels: Record<string, string> = {
    DRAFT: 'Brouillon',
    POSTED: 'Validée',
    OPEN: 'Ouverte',
    PICKED: 'Prélevée',
    COMPLETED: 'Finalisée',
    CANCELLED: 'Annulée',
  };
  function statusTone(status: string): Tone {
    return ['POSTED', 'COMPLETED'].includes(status)
      ? 'ok'
      : status === 'CANCELLED'
        ? 'neutral'
        : 'info';
  }
  const groups = $derived<RelatedGroup[]>(
    data
      ? [
          {
            label: 'Entrepôt',
            items: [
              {
                label: data.location
                  ? `${data.location.code} — ${data.location.name}`
                  : data.locationId,
                href: `/wms?site=${encodeURIComponent(data.locationId)}`,
              },
            ],
          },
          ...(data.shipment
            ? [
                {
                  label: 'Expédition liée',
                  items: [
                    {
                      label: data.shipment.shipmentNumber,
                      sublabel: 'Lien de contexte — aucun statut transport modifié ici',
                    },
                  ],
                },
              ]
            : []),
        ]
      : [],
  );
  const timeline = $derived<TimelineEntry[]>(
    data
      ? [
          { label: 'Document créé', timestamp: data.createdAt, tone: 'neutral' },
          ...(data.postedAt || data.completedAt
            ? [
                {
                  label: receiving ? 'Mise en stock' : 'Sortie de stock',
                  timestamp: (data.postedAt || data.completedAt)!,
                  tone: 'ok' as const,
                },
              ]
            : []),
          {
            label: labels[data.status] ?? data.status,
            description: 'Statut actuel',
            tone: statusTone(data.status),
          },
        ]
      : [],
  );
  async function load() {
    const request = ++generation,
      path = endpoint,
      docId = id;
    loading = true;
    error = '';
    try {
      const doc = await api<WmsGuidedDocument>(`/wms/${path}/${encodeURIComponent(docId)}`);
      if (request !== generation) return;
      data = doc;
      uncertain = false;
      actionError = '';
    } catch (e) {
      if (request === generation) {
        data = null;
        error = e instanceof Error ? e.message : 'Document indisponible.';
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    id;
    kind;
    untrack(() => {
      data = null;
      actionError = '';
      query = '';
      void load();
    });
    return () => {
      generation++;
    };
  });
  beforeNavigate(({ cancel }) => {
    if (busy || editorOpen) cancel();
  });
  function edit(line: WmsDocumentLine | null) {
    if (!editable || busy || loading || uncertain) return;
    selectedLine = line;
    editorOpen = true;
  }
  async function mutate(action: 'execute' | 'cancel' | 'remove', line?: WmsDocumentLine) {
    if (!data || !actionable || busy || loading || editorOpen || uncertain) return;
    if (action === 'remove' && !editable) return;
    if (action === 'execute' && !data.readiness?.canExecute) return;
    const doc = data;
    busy = true;
    actionError = '';
    try {
      const message =
        action === 'execute'
          ? `${receiving ? 'Mettre en stock' : 'Sortir du stock'} les ${doc.lines.length} ligne(s) de ${doc.number} ? Les quantités et emplacements seront revérifiés par le serveur. Cette action porte sur tout le document, pas seulement les lignes affichées.`
          : action === 'remove'
            ? `Retirer la ligne ${line!.item.sku} de ${doc.number} ? Aucun stock ne sera déplacé.`
            : `Annuler ${doc.number} ? Ce document ne pourra plus être validé. Aucun stock ne sera déplacé.`;
      if (
        !(await confirmAction(message, {
          title:
            action === 'execute'
              ? 'Confirmer le stock'
              : action === 'remove'
                ? 'Retirer la ligne'
                : 'Annuler le document',
          confirmLabel:
            action === 'execute'
              ? 'Confirmer'
              : action === 'remove'
                ? 'Retirer'
                : 'Annuler le document',
          dangerous: action !== 'execute',
        }))
      )
        return;
      const url = `/wms/${endpoint}/${doc.id}`;
      if (action === 'remove')
        await api(`${url}/lines/${line!.id}`, {
          method: 'DELETE',
          query: { expectedUpdatedAt: doc.updatedAt },
        });
      else
        await api(`${url}/${action === 'cancel' ? 'cancel' : receiving ? 'post' : 'complete'}`, {
          method: 'POST',
          body: { expectedUpdatedAt: doc.updatedAt },
        });
      await load();
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode))
        actionError = e.message;
      else {
        uncertain = true;
        actionError =
          'Résultat non confirmé. L’opération a peut-être réussi. Actualisez le dossier pour vérifier son état avant toute nouvelle action.';
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if loading && !data}<Skeleton rows={8} />{:else if error}<ErrorNotice
    message={error}
    onretry={load}
  />{:else if data}
  <PageHeader
    title={`${receiving ? 'Réception' : 'Préparation'} ${data.number}`}
    subtitle={data.location?.name ?? 'Entrepôt'}
  >
    {#snippet actions()}<Badge tone={statusTone(data!.status)}
        >{labels[data!.status] ?? data!.status}</Badge
      ><Button variant="secondary" disabled={busy || editorOpen || loading} onclick={load}
        >Actualiser le dossier</Button
      >{/snippet}
  </PageHeader>
  <nav aria-label="Retour aux opérations" class="mb-5 flex flex-wrap gap-4 text-sm text-accent">
    <a href={`${list}?locationId=${encodeURIComponent(data.locationId)}`} class="hover:underline"
      >← {receiving ? 'Réceptions' : 'Préparations'}</a
    >
    <a href={`/wms?site=${encodeURIComponent(data.locationId)}`} class="hover:underline"
      >Vue de l’entrepôt ↗</a
    >
    <a
      href={`/wms/movements?refType=${receiving ? 'receipt' : 'pick-order'}&refId=${encodeURIComponent(data.id)}&locationId=${encodeURIComponent(data.locationId)}`}
      class="hover:underline">Mouvements du document ↗</a
    >
  </nav>
  <ErrorNotice message={actionError} />
  {#if loading}<p role="status" class="mb-3 text-xs text-ink-muted">
      Actualisation des lignes et du stock…
    </p>{/if}
  <ol
    aria-label="Étapes du document"
    class="mb-7 grid gap-3 border-y border-edge py-4 sm:grid-cols-3"
  >
    <li class="flex items-start gap-3">
      <span class="step-number">01</span>
      <div>
        <p class="text-sm font-semibold">Articles et emplacements</p>
        <p class="mt-1 text-xs text-ink-muted">{data.lines.length} ligne(s) au dossier</p>
      </div>
    </li>
    <li class="flex items-start gap-3">
      <span class="step-number">02</span>
      <div>
        <p class="text-sm font-semibold">Vérification</p>
        <p class="mt-1 text-xs text-ink-muted">
          {done
            ? 'Document validé'
            : data.status === 'CANCELLED'
              ? 'Document annulé'
              : !data.readiness
                ? 'Contrôle indisponible'
                : !data.lines.length
                  ? 'Ajoutez les articles'
                  : data.readiness.blockedLines
                    ? `${data.readiness.blockedLines} ligne(s) à corriger`
                    : 'Aucun blocage détecté'}
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3">
      <span class="step-number">03</span>
      <div>
        <p class="text-sm font-semibold">{receiving ? 'Mise en stock' : 'Sortie de stock'}</p>
        <p class="mt-1 text-xs text-ink-muted">
          {done
            ? 'Enregistrée dans le journal'
            : data.status === 'CANCELLED'
              ? 'Non exécutée'
              : 'Confirmation obligatoire'}
        </p>
      </div>
    </li>
  </ol>
  <div class="grid min-w-0 items-start gap-7 xl:grid-cols-[minmax(0,1fr)_19rem]">
    <section class="min-w-0" aria-label="Lignes du document">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-base font-semibold">
          {done || data.status === 'CANCELLED'
            ? 'Articles du document'
            : receiving
              ? 'Articles à recevoir'
              : 'Articles à préparer'}
        </h2>
        {#if editable}<Button
            disabled={busy || editorOpen || loading || uncertain}
            onclick={() => edit(null)}>Ajouter une ligne</Button
          >{/if}
      </div>
      <Input
        bind:value={query}
        aria-label="Filtrer les lignes du document"
        placeholder="SKU, article ou emplacement…"
        disabled={busy || editorOpen}
      />
      {#if query}<p class="mt-2 text-xs text-ink-muted">
          {visibleLines.length} sur {data.lines.length} ligne(s). La validation concerne toujours tout
          le dossier.
        </p>{/if}
      <div class="mt-4 space-y-3">
        {#each visibleLines as line (line.id)}
          {@const bin = line.toBin ?? line.fromBin}
          {@const check = checks.get(line.id)}
          <article
            class="line-card"
            class:blocked={!!check?.issues.length}
            aria-label={`Ligne ${line.item.sku}`}
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="font-mono text-sm font-semibold">{line.item.sku}</h3>
                <p class="mt-1 break-words text-sm text-ink-muted">{line.item.name}</p>
              </div>
              <div class="text-right">
                <p class="text-xs text-ink-muted">
                  {done
                    ? 'Quantité validée'
                    : data.status === 'CANCELLED'
                      ? 'Quantité prévue'
                      : receiving
                        ? 'À recevoir'
                        : 'À prélever'}
                </p>
                <p class="mt-1 font-mono text-lg font-semibold">
                  {line.qty}
                  <span class="text-sm font-normal text-ink-muted">{line.item.unit}</span>
                </p>
              </div>
            </div>
            <div
              class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3"
            >
              <div>
                <p class="text-xs text-ink-muted">{receiving ? 'Destination' : 'Source'}</p>
                {#if bin}<a
                    class="mt-1 inline-block font-mono text-sm font-medium text-accent hover:underline"
                    href={`/wms?site=${encodeURIComponent(data.locationId)}&bin=${encodeURIComponent(bin.id)}`}
                    >{bin.code} ↗</a
                  >{#if bin.zone}<span class="ml-2 text-xs text-ink-muted">{bin.zone}</span
                    >{/if}{/if}
              </div>
              {#if editable}<div class="flex gap-1">
                  <Button
                    variant="ghost"
                    disabled={busy || editorOpen || loading || uncertain}
                    aria-label={`Modifier ${line.item.sku}`}
                    onclick={() => edit(line)}>Modifier</Button
                  ><Button
                    variant="ghost"
                    disabled={busy || editorOpen || loading || uncertain}
                    aria-label={`Retirer ${line.item.sku}`}
                    onclick={() => mutate('remove', line)}>Retirer</Button
                  >
                </div>{/if}
            </div>
            {#if check?.stockOnHand !== null && check?.stockOnHand !== undefined}
              <div class="mt-4 rounded-md bg-surface-muted p-3">
                <div class="flex flex-wrap justify-between gap-2 text-xs">
                  <span
                    >Stock physique : <b class="font-mono">{check.stockOnHand} {line.item.unit}</b
                    ></span
                  ><span
                    >Besoin du dossier ici : <b class="font-mono"
                      >{check.requiredFromBin} {line.item.unit}</b
                    ></span
                  >
                </div>
                <progress
                  class="mt-2 h-1.5 w-full"
                  aria-label={`Couverture physique de ${line.item.sku}`}
                  max={Math.max(0.001, Number(check.requiredFromBin))}
                  value={Math.max(
                    0,
                    Math.min(Number(check.stockOnHand), Number(check.requiredFromBin)),
                  )}
                ></progress>
                {#if Number(check.shortage) > 0}<p class="mt-2 text-xs font-medium text-danger">
                    Manque {check.shortage}
                    {line.item.unit} pour ce dossier à cet emplacement.
                  </p>{/if}
              </div>
            {/if}
            {#if check?.issues.length}<ul
                class="mt-3 space-y-1 text-xs text-danger"
                aria-label={`Blocages ${line.item.sku}`}
              >
                {#each check.issues as issue}<li>{issue}</li>{/each}
              </ul>
            {:else if check && data.readiness?.applicable}<p class="mt-3 text-xs text-ok">
                Références vérifiées{!receiving
                  ? ' · stock physique suffisant pour ce dossier'
                  : ''}
              </p>{/if}
          </article>
        {:else}<EmptyState
            title={query ? 'Aucune ligne correspondante' : 'Préparez votre document'}
            message={query
              ? 'Essayez un autre SKU ou emplacement.'
              : 'Ajoutez les articles, leurs quantités et les emplacements. Aucun stock ne change pendant la préparation.'}
          />{/each}
      </div>
    </section>
    <aside class="min-w-0 space-y-6" aria-label="Vérification et contexte">
      <section class="rounded-lg bg-surface-muted p-4">
        <h2 class="text-sm font-semibold">
          {done
            ? 'Opération enregistrée'
            : data.status === 'CANCELLED'
              ? 'Document annulé'
              : 'Avant de confirmer'}
        </h2>
        <p class="mt-2 text-xs leading-relaxed text-ink-muted">
          {receiving
            ? 'La validation ajoute toutes les quantités aux emplacements choisis.'
            : 'La finalisation déduit toutes les quantités des emplacements sources. Une ligne ajoutée ne réserve aucun stock.'}
        </p>
        {#if !receiving && !done && data.status !== 'CANCELLED'}<p
            class="mt-2 text-xs leading-relaxed text-ink-muted"
          >
            Les lignes du même article et emplacement sont regroupées dans le besoin. Les autres
            préparations ne sont pas réservées; le serveur revérifie le stock au dernier moment.
          </p>{/if}
        {#if actionable}<div class="mt-4 space-y-3">
            {#if !data.readiness}<p role="alert" class="text-xs text-danger">
                Contrôle indisponible. Actualisez avant de valider.
              </p>
            {:else if !data.lines.length}<p class="text-xs text-ink-muted">
                Ajoutez au moins une ligne.
              </p>
            {:else if !data.readiness.canExecute}<p class="text-xs text-danger">
                Corrigez les lignes signalées avant de valider.
              </p>{/if}
            <Button
              disabled={busy || editorOpen || loading || uncertain || !data.readiness?.canExecute}
              loading={busy}
              onclick={() => mutate('execute')}
              >{receiving ? 'Valider la réception' : 'Finaliser la préparation'}</Button
            >
            <Button
              variant="ghost"
              disabled={busy || editorOpen || loading || uncertain}
              onclick={() => mutate('cancel')}>Annuler le document</Button
            >
          </div>{/if}
        {#if data.readiness}<p class="mt-3 text-[11px] text-ink-faint">
            Contrôle à {new Date(data.readiness.generatedAt).toLocaleTimeString('fr-CA', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>{/if}
      </section>
      {#if data.reference || data.note}<section class="space-y-2 text-sm">
          <h2 class="text-sm font-semibold">Consignes du dossier</h2>
          {#if data.reference}<p class="break-words text-ink-muted">
              {data.reference}
            </p>{/if}{#if data.note}<p class="whitespace-pre-wrap break-words text-ink-muted">
              {data.note}
            </p>{/if}
        </section>{/if}
      <section>
        <RelatedEntities {groups} /><YardRelatedDossiers {kind} targetId={data.id} />
      </section>
      <section class="border-t border-edge pt-4">
        <h2 class="mb-3 text-sm font-semibold">Historique</h2>
        <StatusTimeline entries={timeline} />
      </section>
    </aside>
  </div>
{/if}
{#if editorOpen && data}<WarehouseLineEditor
    {kind}
    document={data}
    line={selectedLine}
    onclose={() => {
      editorOpen = false;
    }}
    onsaved={async () => {
      editorOpen = false;
      await load();
    }}
  />{/if}

<style>
  .step-number {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-ink-faint);
    padding-top: 0.15rem;
  }
  .line-card {
    border: 1px solid var(--color-edge);
    border-radius: 0.5rem;
    padding: 1rem;
    background: var(--color-surface);
  }
  .line-card.blocked {
    border-left: 3px solid var(--color-danger);
  }
  progress {
    appearance: none;
    border: 0;
    border-radius: 0.2rem;
    overflow: hidden;
    background: var(--color-edge);
  }
  progress::-webkit-progress-bar {
    background: var(--color-edge);
  }
  progress::-webkit-progress-value {
    background: var(--color-accent);
  }
  progress::-moz-progress-bar {
    background: var(--color-accent);
  }
</style>
