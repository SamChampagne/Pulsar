<script lang="ts">
  import { api } from '$lib/api/client';
  import { Button, EntityPicker } from '$lib/components/ui';
  let {
    itemId = '',
    catalogItemId = '',
    stockLinkModule = 'purchasing',
    unit = $bindable(''),
    binId = '',
    allowCreate = false,
    value = $bindable(''),
    ready = $bindable(false),
    disabled = false,
    outgoing = false,
  }: {
    itemId?: string;
    catalogItemId?: string;
    stockLinkModule?: 'purchasing' | 'services';
    unit?: string;
    binId?: string;
    allowCreate?: boolean;
    value?: string;
    ready?: boolean;
    disabled?: boolean;
    outgoing?: boolean;
  } = $props();
  let resolved = $state(''),
    tracked = $state(false),
    loading = $state(false),
    error = $state(''),
    reload = $state(0);
  type LotDetail = {
    code: string;
    disposition: 'UNRESTRICTED' | 'QUARANTINED';
    dispositionReason: string | null;
    expiresOn: string | null;
    balances: { binId: string; qtyOnHand: string }[];
  };
  let selected = $state<LotDetail | null>(null),
    selectionError = $state('');
  let previousIdentity: string | undefined;
  $effect(() => {
    const id = itemId,
      catalog = catalogItemId;
    const identity = JSON.stringify([id, catalog, stockLinkModule]);
    // Preserve a saved line on mount, but never carry its lot to a different item.
    if (previousIdentity !== undefined && previousIdentity !== identity) value = '';
    previousIdentity = identity;
    void reload;
    let alive = true;
    ready = false;
    resolved = '';
    unit = '';
    tracked = false;
    loading = !!(id || catalog);
    error = '';
    void (async () => {
      try {
        let target = id;
        if (catalog) {
          const link = await api<{ stockLink: { wmsItem: { id: string } } | null }>(
            `/${stockLinkModule}/items/${catalog}/stock-link`,
          );
          target = link.stockLink?.wmsItem.id ?? '';
          if (!target && stockLinkModule === 'services')
            throw new Error(
              'Ce produit n’est plus relié au stock. Vérifiez sa correspondance dans Services → Données.',
            );
        }
        if (!target) {
          if (alive) ready = true;
          return;
        }
        const item = await api<{ lotTracked: boolean; unit: string }>(`/wms/items/${target}`);
        if (typeof item.lotTracked !== 'boolean')
          throw new Error('Suivi de cet article inconnu. Relisez sa fiche avant de continuer.');
        if (alive) {
          resolved = target;
          tracked = item.lotTracked;
          unit = item.unit ?? '';
        }
      } catch (e) {
        if (alive) error = e instanceof Error ? e.message : 'Lecture des lots impossible.';
      } finally {
        if (alive) loading = false;
      }
    })();
    return () => {
      alive = false;
    };
  });
  $effect(() => {
    const id = resolved,
      lot = value,
      isTracked = tracked,
      blockOutgoing = outgoing;
    void reload;
    let alive = true;
    selected = null;
    selectionError = '';
    if (!isTracked) {
      ready = !loading && !error;
      return;
    }
    ready = false;
    if (id && lot)
      void api<LotDetail>(`/wms/items/${id}/lots/${lot}`)
        .then((r) => {
          if (alive) {
            selected = r;
            ready = !(blockOutgoing && r.disposition === 'QUARANTINED');
          }
        })
        .catch((e) => {
          if (alive) selectionError = e.message;
        });
    return () => {
      alive = false;
    };
  });
</script>

{#if loading}<p class="text-xs text-ink-muted" role="status">Lecture du suivi par lot…</p>{/if}
{#if error || selectionError}<p role="alert" class="text-sm text-danger">
    {error || selectionError}
  </p>
  <Button
    variant="ghost"
    onclick={() => {
      reload++;
    }}>Relire les lots</Button
  >{/if}
{#if tracked && resolved}<section
    class="space-y-2 border-t border-edge pt-3"
    aria-label="Lot de stock"
  >
    <EntityPicker
      endpoint={`/wms/items/${resolved}/lots`}
      label="Lot de stock"
      filters={binId ? { binId } : {}}
      bind:value
      disabled={disabled || loading}
    />
    {#if selected}<p class="text-xs text-ink-muted">
        Lot {selected.code} · Péremption déclarée : {selected.expiresOn?.slice(0, 10) ??
          'non renseignée'}.
      </p>{/if}
    {#if selected?.disposition === 'QUARANTINED'}<p
        role="status"
        class="rounded-lg bg-surface-sunken p-3 text-sm text-warn"
      >
        En quarantaine · {selected.dispositionReason ?? 'Contrôle requis'}.
        {outgoing
          ? 'Choisissez un autre lot : sortie interdite.'
          : 'Entrées et déplacements conservent le blocage du lot.'}
      </p>{/if}
    {#if selected && binId}<p class="text-xs text-ink-muted">
        Stock de ce lot dans l’emplacement : <span class="font-mono"
          >{selected.balances.find((b) => b.binId === binId)?.qtyOnHand ?? '0'} {unit}</span
        > · non réservé, recontrôlé à la validation.
      </p>{/if}
    {#if allowCreate}<a
        class="text-xs text-accent underline"
        href={`/wms/items/${resolved}/lots`}
        target="_blank"
        rel="noopener">Créer ou consulter les lots dans un nouvel onglet ↗</a
      ><Button
        variant="ghost"
        {disabled}
        onclick={() => {
          reload++;
        }}>Actualiser les lots</Button
      >{/if}
    <p class="text-xs text-ink-muted">
      Choix explicite, sans FEFO ni réservation. Le contenu des cartons et le lot de fabrication
      sont deux informations distinctes.
    </p>
  </section>{/if}
