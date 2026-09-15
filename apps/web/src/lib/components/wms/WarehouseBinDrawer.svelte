<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { PERMISSIONS, WMS_BIN_LABELS, type WmsBinDetail } from '@pulsar/shared';
  import { Badge, Button, Drawer, ErrorNotice, Field, Input, Skeleton } from '$lib/components/ui';
  import StockMoveForm from './StockMoveForm.svelte';
  import { pendingMove } from '$lib/wms/move-intent';
  let {
    binId,
    siteId,
    onclose,
    onsaved,
  }: { binId: string; siteId: string; onclose: () => void; onsaved: () => void | Promise<void> } =
    $props();
  let open = $state(true),
    data = $state<WmsBinDetail | null>(null),
    loading = $state(true),
    error = $state(''),
    actionError = $state(''),
    busy = $state(false);
  let page = $state(1),
    query = $state(''),
    editingZone = $state(false),
    zone = $state('');
  type Level = WmsBinDetail['levels']['items'][number];
  let moving = $state<Level | null>(null);
  let generation = 0;
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.WMS.MANAGE));
  async function load() {
    const request = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<WmsBinDetail>(`/wms/workspace/bins/${encodeURIComponent(binId)}`, {
        query: { page, q: query },
      });
      if (result.bin.locationId !== siteId)
        throw new Error('Cet emplacement appartient à un autre site.');
      if (request === generation) data = result;
    } catch (e) {
      if (request === generation) {
        data = null;
        error = e instanceof Error ? e.message : 'Stock indisponible.';
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    query;
    untrack(() => {
      page = 1;
    });
  });
  $effect(() => {
    binId;
    page;
    query;
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      generation++;
    };
  });
  onDestroy(() => generation++);
  async function close() {
    if (busy) return;
    if (
      !$pendingMove &&
      (moving || editingZone) &&
      !(await confirmAction('Fermer ce panneau et abandonner la saisie non enregistrée ?', {
        title: 'Fermer l’emplacement',
        confirmLabel: 'Abandonner',
      }))
    )
      return;
    open = false;
    onclose();
  }
  function startMove(level: Level) {
    moving = level;
    actionError = '';
  }
  async function saveZone() {
    if (!data || !canManage || busy) return;
    busy = true;
    actionError = '';
    try {
      await api(`/wms/bins/${binId}`, {
        method: 'PATCH',
        body: { zone: zone.trim() || null, expectedUpdatedAt: data.bin.updatedAt },
      });
      editingZone = false;
      await onsaved();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Zone non enregistrée.';
    } finally {
      busy = false;
    }
  }
</script>

<Drawer
  bind:open
  title={data ? `Emplacement ${data.bin.code}` : 'Emplacement'}
  width="lg"
  dismissible={!busy}
  onbeforeclose={() => {
    void close();
    return false;
  }}
>
  <ErrorNotice message={error} onretry={load} />
  {#if loading && !data}<Skeleton rows={6} />{:else if data}
    <div class="mb-5">
      <div class="flex items-center gap-2">
        <Badge tone={data.bin.isActive ? 'info' : 'neutral'}>{WMS_BIN_LABELS[data.bin.kind]}</Badge
        >{#if !data.bin.isActive}<Badge>Inactif</Badge>{/if}
      </div>
      <h3 class="mt-3 font-mono text-2xl font-semibold">{data.bin.code}</h3>
      <p class="mt-1 text-sm text-ink-muted">
        {data.bin.zone || 'Sans zone'} · {data.bin.stockedItems} article(s) en stock
      </p>
    </div>
    {#if data.bin.negativeItems}<p class="mb-4 text-sm text-danger" role="alert">
        {data.bin.negativeItems} solde(s) négatif(s) à corriger dans l’inventaire.
      </p>{/if}
    {#if canManage && !moving}
      {#if editingZone}<fieldset
          disabled={busy}
          class="mb-5 space-y-3 rounded-md border border-edge p-3"
        >
          <Field label="Zone d’affichage"
            ><Input
              bind:value={zone}
              maxlength={80}
              placeholder="Ex. Allée A, réserve froide…"
            /></Field
          >
          <p class="text-xs text-ink-muted">
            Classement visuel uniquement : aucun stock ne change de place.
          </p>
          <div class="flex gap-2">
            <Button onclick={saveZone} disabled={busy}>Enregistrer la zone</Button><Button
              variant="ghost"
              onclick={() => {
                editingZone = false;
              }}>Annuler</Button
            >
          </div>
        </fieldset>
      {:else}<Button
          variant="secondary"
          disabled={busy || loading || !!$pendingMove}
          onclick={() => {
            zone = data!.bin.zone ?? '';
            editingZone = true;
            actionError = '';
          }}>Organiser la zone</Button
        >{/if}
    {/if}
    {#if !moving}<section
        class="mt-5 border-t border-edge pt-4"
        aria-label="Stock de l’emplacement"
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 class="text-sm font-semibold">Stock sur place</h3>
          {#if !editingZone && !busy}<a
              href={`/wms/movements?locationId=${encodeURIComponent(siteId)}&binId=${encodeURIComponent(binId)}`}
              class="text-xs text-accent hover:underline"
              onclick={() => {
                open = false;
                onclose();
              }}>Journal de l’emplacement ↗</a
            >{/if}
        </div>
        <p class="mb-3 text-xs text-ink-muted">
          Quantités physiques enregistrées, sans déduction des préparations ouvertes.
        </p>
        <Input
          aria-label="Rechercher un article dans l’emplacement"
          bind:value={query}
          maxlength={80}
          placeholder="SKU ou nom d’article…"
          disabled={busy || !!moving || editingZone}
        />
        {#if loading}<p role="status" class="mt-3 text-xs text-ink-muted">Actualisation…</p>{/if}
        <div class="mt-3 divide-y divide-edge">
          {#each data.levels.items as level (level.itemId)}<div
              class="flex flex-wrap items-center gap-3 py-3"
            >
              <div class="min-w-0 flex-1">
                <p class="font-mono text-sm font-medium">{level.sku}</p>
                <p class="text-xs text-ink-muted">
                  {level.name}{!level.isActive ? ' · article inactif' : ''}
                </p>
              </div>
              <span class="font-mono text-sm" class:text-danger={Number(level.qtyOnHand) < 0}
                >{level.qtyOnHand} {level.unit}</span
              >{#if canManage && data.bin.isActive && Number(level.qtyOnHand) > 0}<Button
                  variant="ghost"
                  disabled={busy || loading || !!moving || editingZone || !!$pendingMove}
                  aria-label={`Déplacer ${level.sku}`}
                  onclick={() => startMove(level)}>Déplacer</Button
                >{/if}
            </div>
          {:else}<p class="py-4 text-sm text-ink-muted">
              {query ? 'Aucun article correspondant.' : 'Aucun solde enregistré.'}
            </p>{/each}
        </div>
        {#if data.levels.total > data.levels.pageSize}<nav
            aria-label="Pages du stock"
            class="mt-3 flex items-center gap-3"
          >
            <Button
              variant="ghost"
              disabled={page <= 1 || busy || !!moving || editingZone || loading}
              onclick={() => {
                page--;
              }}>Précédente</Button
            ><span class="text-xs"
              >{page} / {Math.ceil(data.levels.total / data.levels.pageSize)}</span
            ><Button
              variant="ghost"
              disabled={page * data.levels.pageSize >= data.levels.total ||
                busy ||
                !!moving ||
                editingZone ||
                loading}
              onclick={() => {
                page++;
              }}>Suivante</Button
            >
          </nav>{/if}
      </section>{/if}
    {#if moving}<StockMoveForm
        source={{ ...moving, binId, binCode: data.bin.code, locationId: siteId }}
        onbusy={(b) => (busy = b)}
        oncancel={() => {
          moving = null;
        }}
        onsaved={async () => {
          moving = null;
          await onsaved();
        }}
      />{/if}
  {/if}
  <div class="mt-4"><ErrorNotice message={actionError} /></div>
  {#snippet footer()}<Button variant="secondary" disabled={busy} onclick={close}
      >{$pendingMove ? 'Fermer et vérifier' : 'Fermer'}</Button
    >{/snippet}
</Drawer>
