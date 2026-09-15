<script lang="ts">
  import type { ManufacturingMaterialSnapshot } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Badge, Button, Card, Drawer, Field, Select } from '$lib/components/ui';
  type Revision = {
    id: string;
    revision: number;
    outputSku: string;
    outputUnit: string;
    lines?: { id: string; sku: string; unit: string; quantityPerUnit: string }[];
  };
  let {
    order,
    onchange,
  }: {
    order: {
      id: string;
      status: string;
      updatedAt: string;
      productRef: string;
      bomId?: string | null;
      bomRevisionId?: string | null;
      locationId?: string | null;
      location?: { name: string } | null;
      bomRevision?: Revision | null;
      materialSnapshot?: ManufacturingMaterialSnapshot | null;
    };
    onchange: () => Promise<void>;
  } = $props();
  let open = $state(false),
    busy = $state(false),
    error = $state('');
  let locationId = $state(''),
    revisionId = $state(''),
    expected = $state('');
  let options = $state<{
    locations: { id: string; code: string; name: string }[];
    boms: { id: string; code: string; revisions?: Revision[] }[];
  }>({ locations: [], boms: [] });
  const canManage = $derived(
    Boolean(
      $auth?.user.permissions.includes('manufacturing.manage') &&
      $auth?.user.permissions.includes('wms.read'),
    ),
  );
  const snapshot = $derived(order.materialSnapshot);
  const choices = $derived(
    options.boms.flatMap((b) =>
      (b.revisions ?? [])
        .filter((r) => r.outputSku === order.productRef)
        .map((r) => ({ ...r, code: b.code })),
    ),
  );
  async function configure() {
    open = true;
    busy = true;
    error = '';
    locationId = order.locationId ?? '';
    revisionId = order.bomRevisionId ?? '';
    expected = order.updatedAt;
    try {
      options = await api<typeof options>('/manufacturing/mrp/options');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Catalogue indisponible';
    } finally {
      busy = false;
    }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await api(`/manufacturing/orders/${order.id}/material-context`, {
        method: 'POST',
        body: { locationId, bomRevisionId: revisionId, expectedUpdatedAt: expected },
      });
      open = false;
      await onchange();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Enregistrement impossible';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mt-4">
  <Card>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-semibold text-ink">Matières & site de fabrication</h2>
        <p class="mt-1 text-xs text-ink-muted">
          Une définition traçable, distincte du stock et de l’exécution atelier.
        </p>
      </div>
      {#if canManage && order.status === 'DRAFT' && !snapshot}<Button
          variant="secondary"
          onclick={configure}>Configurer les matières</Button
        >{/if}
    </div>
    {#if snapshot}
      <div class="my-4 flex flex-wrap gap-2">
        <Badge tone="ok">Matières figées · v{snapshot.revision}</Badge><Badge tone="neutral"
          >{order.location?.name ?? snapshot.locationId}</Badge
        ><span class="text-sm text-ink-muted"
          >{snapshot.product.quantity} {snapshot.product.unit} · {snapshot.product.sku}</span
        >
      </div>
      <div class="divide-y divide-edge">
        {#each snapshot.components as line, i (`${line.itemId}-${i}`)}<div
            class="flex justify-between gap-3 py-2 text-sm"
          >
            <span><span class="font-mono">{line.sku}</span> · {line.name}</span><span
              class="font-mono">{line.requiredQuantity} {line.unit}</span
            >
          </div>{/each}
      </div>
      <p class="mt-3 text-xs text-ink-muted">
        Figé le {new Date(snapshot.capturedAt).toLocaleString('fr-CA')}. Ces besoins ne constituent
        ni une réservation ni une consommation de stock.
      </p>
    {:else if order.bomRevision}
      <div class="my-4 flex gap-2">
        <Badge tone="info">v{order.bomRevision.revision} sélectionnée</Badge><Badge tone="neutral"
          >{order.location?.name ?? 'Site non défini'}</Badge
        >
      </div>
      <p class="text-xs text-ink-muted">
        Par 1 {order.bomRevision.outputUnit} du produit. Les besoins totaux seront figés à la libération.
      </p>
      {#each order.bomRevision.lines ?? [] as line (line.id)}<div
          class="flex justify-between py-2 text-sm"
        >
          <span>{line.sku}</span><span class="font-mono">{line.quantityPerUnit} {line.unit}</span>
        </div>{/each}
    {:else}<p class="mt-4 rounded-md bg-surface-muted p-3 text-sm text-ink-muted">
        {order.status === 'DRAFT'
          ? 'Aucune version sélectionnée. Choisissez un site et une nomenclature publiée pour planifier les matières.'
          : 'Aucun instantané matières disponible pour cet OF. L’historique n’est pas reconstruit à partir de la nomenclature actuelle.'}
      </p>{/if}
  </Card>
</div>

<Drawer bind:open title="Contexte matières de l’OF" width="lg" dismissible={!busy}>
  <form onsubmit={save} class="space-y-4">
    <p class="text-sm text-ink-muted">
      Produit : {order.productRef || 'non renseigné'}. Les unités viennent des versions publiées,
      sans conversion implicite.
    </p>
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>
      <Button
        variant="ghost"
        disabled={busy}
        onclick={async () => {
          open = false;
          await onchange();
        }}>Fermer et recharger l’OF</Button
      >{/if}
    <Field label="Site de fabrication"
      ><Select bind:value={locationId} required disabled={busy}
        ><option value="">Choisir un entrepôt</option
        >{#each options.locations as location (location.id)}<option value={location.id}
            >{location.code} · {location.name}</option
          >{/each}</Select
      ></Field
    >
    <Field label="Nomenclature publiée"
      ><Select bind:value={revisionId} required disabled={busy}
        ><option value="">Choisir une version</option
        >{#each choices as revision (revision.id)}<option value={revision.id}
            >{revision.code} · v{revision.revision} · {revision.outputUnit}</option
          >{/each}</Select
      ></Field
    >
    {#if !busy && !choices.length}<p class="text-sm text-ink-muted">
        Aucune version pour ce SKU. <a
          href="/manufacturing/boms"
          class="text-accent hover:underline">Publier une nomenclature</a
        > avant de continuer.
      </p>{/if}
    <Button
      type="submit"
      loading={busy}
      disabled={!locationId || !revisionId || !choices.some((r) => r.id === revisionId)}
      >Enregistrer le contexte</Button
    >
  </form>
</Drawer>
