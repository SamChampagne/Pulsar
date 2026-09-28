<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Modal, EntityPicker, Skeleton } from '$lib/components/ui';
  import type { CatalogItem } from './types';
  let {
    item,
    onchanged = () => {},
    context = 'catalog',
  }: {
    item: CatalogItem;
    onchanged?: () => void;
    context?: 'catalog' | 'services' | 'purchasing';
  } = $props();
  const can = $derived(($auth?.user.permissions ?? []) as string[]);
  const visible = $derived(
    $auth?.tenant.enabledModules.includes('wms') && can.includes('wms.read'),
  );
  let open = $state(false),
    loading = $state(false),
    saving = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let selected = $state(''),
    label = $state(''),
    version = $state('');
  async function show() {
    open = true;
    loading = true;
    error = '';
    uncertain = false;
    version = '';
    try {
      const data = await api<{
        updatedAt: string;
        stockLink: { wmsItem: { id: string; sku: string; name: string; unit: string } } | null;
      }>(`/${context}/items/${item.id}/stock-link`);
      version = data.updatedAt;
      selected = data.stockLink?.wmsItem.id ?? '';
      label = data.stockLink
        ? `${data.stockLink.wmsItem.sku} · ${data.stockLink.wmsItem.name} (${data.stockLink.wmsItem.unit})`
        : '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Connexion indisponible.';
    } finally {
      loading = false;
    }
  }
  async function save() {
    if (!version || saving || uncertain) return;
    saving = true;
    error = '';
    try {
      await api(`/${context}/items/${item.id}/stock-link`, {
        method: 'PATCH',
        body: { wmsItemId: selected || null, expectedUpdatedAt: version },
      });
      open = false;
      onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Enregistrement impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      saving = false;
    }
  }
</script>

{#if visible && item.kind === 'GOODS'}
  <Button variant="ghost" onclick={show} aria-label={`Stock WMS de ${item.name}`}>Stock WMS</Button>
{/if}
<Modal bind:open title="Correspondance Catalogue ↔ WMS" dismissible={!saving}>
  <p class="mb-4 text-sm leading-6">
    {item.code} · {item.name} · unité <strong>{item.unit}</strong>. Sélectionnez le même produit
    physique dans WMS, avec exactement cette unité.
  </p>
  {#if loading}<Skeleton rows={2} />{:else if version}
    <EntityPicker
      endpoint="/wms/items"
      label="Article WMS"
      detailKey="sku"
      bind:value={selected}
      selectedLabel={label}
      disabled={saving || uncertain || !can.includes(`${context}.manage`)}
    />
    <p class="mt-3 text-sm leading-6 text-ink-muted">
      Cette correspondance ne crée ni ne déplace de stock. Un article WMS ne peut être lié qu’à un
      produit du Catalogue. Retirer ou changer le lien ne modifie pas les consommations passées.
    </p>
  {/if}
  {#if error}<p role="alert" class="mt-3 text-sm text-danger">{error}</p>{/if}
  {#if uncertain}<p class="mt-3 text-sm text-warn">
      Réponse incertaine. Fermez et rouvrez pour vérifier le lien avant une nouvelle action.
    </p>{/if}
  <div class="mt-5 flex justify-end gap-2">
    <Button
      variant="secondary"
      disabled={saving}
      onclick={() => {
        open = false;
        onchanged();
      }}>Fermer</Button
    >
    {#if can.includes(`${context}.manage`)}<Button
        disabled={loading || !version || uncertain}
        loading={saving}
        onclick={save}>Enregistrer la correspondance</Button
      >{/if}
  </div>
</Modal>
