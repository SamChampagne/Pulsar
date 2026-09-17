<script lang="ts">
  import { untrack } from 'svelte';
  import { convertMrpCommercialQuantity } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { Button, Drawer, Field, Input, Select } from '$lib/components/ui';
  type Source = {
    id: string;
    productId?: string | null;
    name: string;
    quantity: string;
    updatedAt: string;
    salesOrder: { id: string; number: string; status: string; updatedAt: string };
    mrpDemands?: { id: string; locationId: string }[];
  };
  export type SalesDemandEntry = {
    id: string;
    itemId: string;
    quantity: string;
    reference: string;
    dueDate: string;
    forecastId?: string | null;
    isActive: boolean;
    updatedAt: string;
    sourceSalesOrderLineId?: string | null;
    sourceSnapshot?: { quantity?: string; mapping?: Mapping | null } | null;
    sourceSalesOrderLine?: {
      id: string;
      updatedAt: string;
      salesOrder: Source['salesOrder'];
    } | null;
  };
  type Mapping = {
    id: string;
    itemId?: string;
    numerator: string;
    denominator: string;
    commercialUnit: string;
    unitSnapshot?: string;
    unit?: string;
    updatedAt: string;
    isActive?: boolean;
  };
  let mapping = $state<Mapping | null>(null),
    offeredMapping = $state<Mapping | null>(null),
    mappingLoading = $state(false);
  let mappingRequest = 0;
  let {
    open = $bindable(false),
    locationId,
    items,
    forecasts,
    entry = null,
    salesOrderId = '',
    onchange,
  }: {
    open?: boolean;
    locationId: string;
    items: { id: string; sku: string; name: string; unit: string }[];
    forecasts: {
      id: string;
      itemId: string;
      reference: string;
      forecastStart?: string | null;
      dueDate: string;
      isActive: boolean;
    }[];
    entry?: SalesDemandEntry | null;
    salesOrderId?: string;
    onchange: () => Promise<void>;
  } = $props();
  let sources = $state<Source[]>([]),
    sourceId = $state(''),
    itemId = $state(''),
    dueDate = $state(''),
    forecastId = $state('');
  let search = $state(''),
    sourcePage = $state(1),
    total = $state(0),
    busy = $state(false),
    error = $state(''),
    acknowledged = $state(false),
    isActive = $state(true),
    uncertain = $state(false);
  const selected = $derived(
    entry?.sourceSalesOrderLine
      ? {
          ...entry.sourceSalesOrderLine,
          quantity: entry.sourceSnapshot?.quantity ?? entry.quantity,
          name: entry.reference,
          productId: null,
        }
      : sources.find((s) => s.id === sourceId),
  );
  const item = $derived(items.find((i) => i.id === itemId));
  const conversion = $derived.by(() => {
    if (!selected) return { quantity: '', error: '' };
    try {
      return {
        quantity: mapping
          ? convertMrpCommercialQuantity(selected.quantity, mapping.numerator, mapping.denominator)
          : selected.quantity,
        error: '',
      };
    } catch {
      return {
        quantity: '',
        error:
          'Ce ratio ne donne pas une quantité exacte à 3 décimales. Corrigez la correspondance avant de relier la commande.',
      };
    }
  });
  async function sourceChanged() {
    const request = ++mappingRequest;
    mapping = null;
    offeredMapping = null;
    acknowledged = false;
    forecastId = '';
    const productId = sources.find((s) => s.id === sourceId)?.productId;
    if (!productId) {
      mappingLoading = false;
      return;
    }
    mappingLoading = true;
    try {
      const result = await api<{ items: Mapping[] }>('/manufacturing/mrp/product-mappings', {
        query: { productId, pageSize: 20 },
      });
      if (request === mappingRequest) offeredMapping = result.items.find((m) => m.isActive) ?? null;
    } catch (e) {
      if (request === mappingRequest)
        error = e instanceof Error ? e.message : 'Correspondance indisponible';
    } finally {
      if (request === mappingRequest) mappingLoading = false;
    }
  }
  async function loadSources() {
    busy = true;
    error = '';
    try {
      const result = await api<{ items: Source[]; total: number }>(
        '/manufacturing/mrp/sales-sources',
        {
          query: {
            page: sourcePage,
            pageSize: 20,
            search: search || undefined,
            salesOrderId: salesOrderId || undefined,
          },
        },
      );
      sources = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Commandes indisponibles';
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    if (open) {
      const current = entry;
      untrack(() => {
        sourceId = current?.sourceSalesOrderLineId ?? '';
        itemId = current?.itemId ?? '';
        dueDate = current?.dueDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
        forecastId = current?.forecastId ?? '';
        isActive = current?.isActive ?? true;
        acknowledged = false;
        error = '';
        uncertain = false;
        mappingRequest++;
        mappingLoading = false;
        mapping = current?.sourceSnapshot?.mapping ?? null;
        offeredMapping = null;
        search = '';
        sourcePage = 1;
        if (!current) void loadSources();
      });
    }
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!selected || !acknowledged || uncertain || mappingLoading || conversion.error) return;
    busy = true;
    error = '';
    try {
      await api(`/manufacturing/mrp/sales-demands${entry ? `/${entry.id}` : ''}`, {
        method: entry ? 'PUT' : 'POST',
        body: {
          locationId,
          itemId,
          sourceSalesOrderLineId: selected.id,
          dueDate,
          ...(forecastId ? { forecastId } : {}),
          isActive,
          acknowledgeUnits: true,
          expectedSourceUpdatedAt: selected.updatedAt,
          expectedOrderUpdatedAt: selected.salesOrder.updatedAt,
          ...(entry ? { expectedUpdatedAt: entry.updatedAt } : {}),
          ...(!entry && mapping
            ? { mappingId: mapping.id, expectedMappingUpdatedAt: mapping.updatedAt }
            : {}),
        },
      });
      open = false;
      await onchange();
    } catch (e) {
      uncertain = true;
      error = `${e instanceof Error ? e.message : 'Enregistrement impossible'}. Fermez et actualisez le poste avant de reprendre; aucun nouvel envoi automatique.`;
    } finally {
      busy = false;
    }
  }
</script>

<Drawer
  bind:open
  title={entry ? 'Demande client liée' : 'Relier une commande client'}
  width="lg"
  dismissible={!busy}
>
  <form onsubmit={save} class="space-y-4">
    <p class="text-sm text-ink-muted">
      Une ligne confirmée, un article WMS et une date explicite. Aucun stock n’est réservé et aucun
      OF n’est créé.
    </p>
    {#if error}<p role="alert" class="rounded-md bg-danger/5 p-3 text-sm text-danger">
        {error}
      </p>{/if}
    {#if !entry}
      <div class="flex gap-2">
        <Input
          bind:value={search}
          aria-label="Rechercher une commande client"
          placeholder="Numéro ou ligne…"
          disabled={busy || uncertain}
        /><Button
          variant="secondary"
          disabled={busy || uncertain}
          onclick={async () => {
            sourcePage = 1;
            await loadSources();
          }}>Rechercher</Button
        >
      </div>
      <Field label="Ligne de commande confirmée"
        ><Select
          bind:value={sourceId}
          onchange={sourceChanged}
          required
          disabled={busy || uncertain}
          ><option value="">Choisir une ligne</option>{#each sources as source (source.id)}<option
              value={source.id}
              disabled={Boolean(source.mrpDemands?.length)}
              >{source.salesOrder.number} · {source.name} · {source.quantity}{source.mrpDemands
                ?.length
                ? ' · déjà liée'
                : ''}</option
            >{/each}</Select
        ></Field
      >
      <div class="flex items-center justify-between text-xs text-ink-muted">
        <span>{total} lignes · page {sourcePage}</span>
        <div class="flex gap-1">
          <Button
            variant="ghost"
            disabled={busy || sourcePage <= 1}
            onclick={async () => {
              sourcePage--;
              await loadSources();
            }}>Précédent</Button
          ><Button
            variant="ghost"
            disabled={busy || sourcePage * 20 >= total}
            onclick={async () => {
              sourcePage++;
              await loadSources();
            }}>Suivant</Button
          >
        </div>
      </div>
    {/if}
    {#if selected}<div class="rounded-md border border-edge p-3 text-sm">
        <a href={`/crm/sales-orders/${selected.salesOrder.id}`} class="text-accent hover:underline"
          >{selected.salesOrder.number}</a
        >
        <p class="mt-1">{selected.name} · {selected.quantity} unités commerciales</p>
        <p class="text-xs text-ink-muted">
          État CRM : {selected.salesOrder.status}. Quantité lue depuis la ligne, non saisissable
          ici.
        </p>
      </div>{/if}
    {#if !entry && offeredMapping && !mapping}
      <div class="rounded-md border border-edge p-3 text-sm">
        <p>
          Correspondance disponible : {offeredMapping.denominator}
          {offeredMapping.commercialUnit} = {offeredMapping.numerator}
          {offeredMapping.unitSnapshot}.
        </p>
        <Button
          variant="secondary"
          disabled={busy || uncertain}
          onclick={() => {
            mapping = offeredMapping;
            itemId = offeredMapping?.itemId ?? '';
            forecastId = '';
            acknowledged = false;
          }}>Utiliser cette correspondance</Button
        >
      </div>
    {/if}
    {#if mapping}<div class="rounded-md bg-surface-muted p-3 text-sm">
        <p>
          {mapping.denominator}
          {mapping.commercialUnit} = {mapping.numerator}
          {mapping.unitSnapshot ?? mapping.unit} · ratio figé sur cette demande
        </p>
        {#if conversion.error}<p role="alert" class="mt-2 text-danger">
            {conversion.error}
          </p>{:else}<p class="mt-2 font-mono font-medium">
            {selected?.quantity}
            {mapping.commercialUnit} → {conversion.quantity}
            {mapping.unitSnapshot ?? mapping.unit}
          </p>{/if}
        {#if !entry}<Button
            variant="ghost"
            disabled={busy || uncertain}
            onclick={() => {
              mapping = null;
              acknowledged = false;
            }}>Revenir au rattachement 1:1</Button
          >{/if}
      </div>{/if}
    <Field label="Article WMS à fournir"
      ><Select
        bind:value={itemId}
        onchange={() => {
          acknowledged = false;
          forecastId = '';
        }}
        disabled={busy || Boolean(entry) || Boolean(mapping) || uncertain}
        required
        ><option value="">Choisir l’article exact</option>{#each items as item (item.id)}<option
            value={item.id}>{item.sku} · {item.name} ({item.unit})</option
          >{/each}</Select
      ></Field
    >
    <Field label="Date du besoin (UTC)"
      ><Input type="date" bind:value={dueDate} required disabled={busy || uncertain} /></Field
    >
    <Field label="Prévision remplacée (facultatif)"
      ><Select bind:value={forecastId} disabled={busy || uncertain}
        ><option value="">Aucune — demande indépendante</option
        >{#each forecasts.filter((f) => f.itemId === itemId && f.isActive) as forecast (forecast.id)}<option
            value={forecast.id}
            >{forecast.reference} · {forecast.forecastStart?.slice(0, 10)} → {forecast.dueDate.slice(
              0,
              10,
            )}</option
          >{/each}</Select
      ></Field
    >
    <p class="text-xs text-ink-muted">
      Une commande exécutée reste déduite de sa prévision; une commande annulée la libère. Pas de
      suivi partiel par ligne dans ce lot. Une saisie manuelle existante pour cette même commande
      doit être désactivée.
    </p>
    <label class="flex items-start gap-2 text-sm"
      ><input
        type="checkbox"
        bind:checked={acknowledged}
        required
        disabled={busy || uncertain}
      /><span
        >{mapping
          ? `Je confirme le ratio ${mapping.denominator} ${mapping.commercialUnit} = ${mapping.numerator} ${mapping.unitSnapshot ?? mapping.unit} et la quantité convertie.`
          : `Je confirme que 1 unité commerciale correspond à 1 ${item?.unit ?? 'unité WMS'} de cet article.`}
        Aucune conversion n’est implicite.</span
      ></label
    >
    <label class="flex items-center gap-2 text-sm"
      ><input type="checkbox" bind:checked={isActive} disabled={busy || uncertain} />Inclure cette
      demande et sa consommation de prévision</label
    >
    <Button
      type="submit"
      loading={busy}
      disabled={uncertain ||
        mappingLoading ||
        Boolean(conversion.error) ||
        !selected ||
        !itemId ||
        !acknowledged}>Confirmer le rattachement</Button
    >
  </form>
</Drawer>
