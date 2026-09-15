<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    FLEET_ASSET_LABELS,
    FLEET_ORDER_LABELS,
    fleetDateKey,
    PERMISSIONS,
    type FleetAssetRow,
    type FleetOrderRow,
  } from '@pulsar/shared';
  import { Badge, Button, Drawer, ErrorNotice, Skeleton } from '$lib/components/ui';
  let {
    asset,
    onclose,
    onorder,
  }: {
    asset: FleetAssetRow;
    onclose: () => void;
    onorder: (id: string, asset: FleetAssetRow) => void;
  } = $props();
  interface Detail {
    asset: FleetAssetRow;
    orders: { items: FleetOrderRow[]; total: number; truncated: boolean };
    documents: {
      items: {
        id: string;
        docType: string;
        reference: string | null;
        expiresAt: string;
        status: string;
      }[];
      total: number;
      truncated: boolean;
    };
    transport: {
      items: { id: string; loadNumber: string; status: string }[];
      truncated: boolean;
    } | null;
  }
  let open = $state(true),
    data = $state<Detail | null>(null),
    loading = $state(true),
    error = $state('');
  const manage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.FLEET.MANAGE));
  const masterRead = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ) &&
      !!$auth?.tenant.enabledModules.includes('transportation'),
  );
  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<Detail>(`/fleet/workspace/assets/${asset.kind}/${asset.id}`);
    } catch (e) {
      data = null;
      error = e instanceof Error ? e.message : 'Actif indisponible.';
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void load();
  });
  beforeNavigate(({ cancel }) => {
    if (open) cancel();
  });
  function close() {
    open = false;
    onclose();
  }
  function inspect(id: string) {
    open = false;
    onorder(id, asset);
  }
</script>

<Drawer
  bind:open
  title={`${asset.kind === 'vehicle' ? 'Véhicule' : 'Remorque'} ${asset.unitNumber}`}
  width="lg"
  {onclose}
>
  <ErrorNotice message={error} onretry={load} />
  {#if loading}<Skeleton rows={6} />{:else if data}
    <div class="mb-5 border-b border-edge pb-5">
      <Badge>{FLEET_ASSET_LABELS[data.asset.status] ?? data.asset.status}</Badge>
      <p class="mt-3 font-mono text-sm">
        {data.asset.plate || 'Plaque non renseignée'} · {data.asset.internal
          ? 'Parc interne'
          : 'Transporteur externe'}
      </p>
      <p class="mt-3 text-xs text-ink-muted">
        L’état flotte ne garantit pas l’absence de chargement affecté. Vérifiez le contexte
        transport avant de l’immobiliser.
      </p>
    </div>
    <section aria-label="Interventions de l’actif">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-semibold">Interventions · {data.orders.total}</h3>
        {#if manage && data.asset.status !== 'RETIRED'}<Button onclick={() => inspect('')}
            >Ouvrir une intervention</Button
          >{/if}
      </div>
      <div class="mt-4 space-y-2">
        {#each data.orders.items as wo (wo.id)}<button
            class="w-full rounded-lg border border-edge p-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
            onclick={() => inspect(wo.id)}
            ><div class="flex flex-wrap justify-between gap-2">
              <span class="text-xs text-ink-muted">{FLEET_ORDER_LABELS[wo.status]}</span><span
                class="font-mono text-xs"
                >{wo.dueDate ? fleetDateKey(wo.dueDate) : 'Sans échéance'}</span
              >
            </div>
            <span class="mt-2 block break-words text-sm font-medium">{wo.description}</span></button
          >{:else}<p class="py-4 text-sm text-ink-muted">Aucune intervention enregistrée.</p>{/each}
      </div>
      {#if data.orders.truncated}<p class="mt-2 text-xs text-warn">
          30 dossiers affichés sur {data.orders.total}. Fermez ce panneau puis utilisez l’échéancier
          et la recherche par unité pour consulter les autres files et l’historique.
        </p>{/if}
    </section>
    <section class="mt-6 border-t border-edge pt-5" aria-label="Documents de l’actif">
      <h3 class="font-semibold">Documents · {data.documents.total}</h3>
      <p class="mt-2 text-xs text-ink-muted">
        Échéances des documents enregistrés, pas une certification de conformité complète.
      </p>
      <div class="mt-3 divide-y divide-edge">
        {#each data.documents.items as doc (doc.id)}<div
            class="flex flex-wrap justify-between gap-2 py-3 text-sm"
          >
            <div>
              <p>{doc.docType}</p>
              <p class="text-xs text-ink-muted">{doc.reference || 'Sans référence'}</p>
            </div>
            <div class="text-right">
              <p class="font-mono">{fleetDateKey(doc.expiresAt)}</p>
              <Badge
                tone={doc.status === 'EXPIRED'
                  ? 'danger'
                  : doc.status === 'EXPIRING'
                    ? 'warn'
                    : 'neutral'}
                >{doc.status === 'EXPIRED'
                  ? 'Expiré'
                  : doc.status === 'EXPIRING'
                    ? 'À renouveler'
                    : 'Valide'}</Badge
              >
            </div>
          </div>{:else}<p class="py-3 text-sm text-ink-muted">
            Aucun document enregistré — conformité non évaluée.
          </p>{/each}
      </div>
      {#if data.documents.truncated}<p class="text-xs text-warn">
          30 documents affichés sur {data.documents.total}.
        </p>{/if}
    </section>
    {#if data.transport}<section class="mt-6 border-t border-edge pt-5">
        <h3 class="font-semibold">Chargements TMS non terminés</h3>
        <div class="mt-3 space-y-2">
          {#each data.transport.items as load (load.id)}<a
              class="flex justify-between gap-3 rounded-md bg-surface-muted p-3 text-sm text-accent"
              href={`/loads/${load.id}`}
              onclick={close}
              ><span class="font-mono">{load.loadNumber}</span><span>{load.status} ↗</span></a
            >{:else}<p class="text-sm text-ink-muted">
              Aucun chargement non terminé lié au moment de la lecture.
            </p>{/each}
        </div>
        {#if data.transport.truncated}<p class="mt-2 text-xs text-warn">
            10 chargements affichés; consultez le TMS pour la suite.
          </p>{/if}
      </section>{/if}
    {#if masterRead}<a
        class="mt-6 inline-block text-sm text-accent hover:underline"
        href={`/fleet/${asset.kind === 'vehicle' ? 'vehicles' : 'trailers'}/${asset.id}`}
        onclick={close}>Fiche complète et documents ↗</a
      >{/if}
  {/if}
  {#snippet footer()}<Button variant="secondary" onclick={close}>Fermer</Button>{/snippet}
</Drawer>
