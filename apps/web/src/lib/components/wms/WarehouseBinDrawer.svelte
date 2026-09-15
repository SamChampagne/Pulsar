<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { PERMISSIONS, WMS_BIN_LABELS, type WmsBinDetail } from '@pulsar/shared';
  import {
    Badge,
    Button,
    Drawer,
    ErrorNotice,
    Field,
    Input,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
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
  let moving = $state<Level | null>(null),
    qty = $state<number | null>(null),
    note = $state(''),
    destination = $state(''),
    destinationQuery = $state('');
  let destinations = $state<
      { id: string; code: string; kind: string; locationId: string; isActive: boolean }[]
    >([]),
    searching = $state(false),
    searchError = $state(''),
    uncertain = $state(false);
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
  $effect(() => {
    const active = !!moving,
      q = destinationQuery,
      site = siteId,
      source = binId;
    let disposed = false;
    destination = '';
    destinations = [];
    searchError = '';
    searching = active;
    if (!active) return;
    const timer = setTimeout(() => {
      api<typeof destinations>('/wms/bins', { query: { locationId: site, search: q } })
        .then((rows) => {
          if (!disposed)
            destinations = rows.filter(
              (b) => b.id !== source && b.locationId === site && b.isActive,
            );
        })
        .catch((e) => {
          if (!disposed) searchError = e.message;
        })
        .finally(() => {
          if (!disposed) searching = false;
        });
    }, 200);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  });
  onDestroy(() => generation++);
  async function close() {
    if (busy) return;
    if (
      !uncertain &&
      (moving || editingZone) &&
      !(await confirmAction('Fermer ce panneau et abandonner la saisie non enregistrée ?', {
        title: 'Fermer l’emplacement',
        confirmLabel: 'Abandonner',
      }))
    )
      return;
    open = false;
    if (uncertain) await onsaved();
    else onclose();
  }
  function startMove(level: Level) {
    moving = level;
    qty = null;
    note = '';
    destinationQuery = '';
    destination = '';
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
  async function move() {
    if (!moving || !data || !canManage || busy || uncertain) return;
    const target = destinations.find((b) => b.id === destination);
    if (!target || !qty || qty <= 0 || qty > Number(moving.qtyOnHand) || !Number.isFinite(qty)) {
      actionError =
        'Sélectionnez une destination et une quantité positive, au plus égale au stock affiché.';
      return;
    }
    busy = true;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          `Déplacer ${qty} ${moving.unit} de ${moving.sku}, de ${data.bin.code} vers ${target.code} ? Un mouvement de stock sera enregistré. Aucun dossier de réception ou transport ne sera terminé.`,
          { title: 'Confirmer le déplacement', confirmLabel: 'Déplacer le stock' },
        ))
      )
        return;
      await api('/wms/inventory/move', {
        method: 'POST',
        body: {
          itemId: moving.itemId,
          fromBinId: binId,
          toBinId: target.id,
          locationId: siteId,
          qty,
          note: note.trim() || undefined,
        },
      });
      moving = null;
      await onsaved();
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode))
        actionError = e.message;
      else {
        uncertain = true;
        actionError =
          'Résultat non confirmé. Le stock a peut-être été déplacé. Fermez et actualisez pour vérifier avant toute nouvelle opération.';
      }
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
          disabled={busy || loading || uncertain}
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
        <h3 class="mb-2 text-sm font-semibold">Stock sur place</h3>
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
                  disabled={busy || loading || !!moving || editingZone || uncertain}
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
    {#if moving}<fieldset
        disabled={busy || uncertain}
        class="mt-5 space-y-3 rounded-lg border border-edge bg-surface-muted p-4"
      >
        <h3 class="text-sm font-semibold">Déplacer {moving.sku}</h3>
        <p class="text-xs text-ink-muted">
          Source {data.bin.code} · {moving.qtyOnHand}
          {moving.unit} sur place
        </p>
        <Field label="Rechercher la destination"
          ><Input bind:value={destinationQuery} maxlength={80} placeholder="Code ou zone…" /></Field
        ><ErrorNotice message={searchError} />{#if searching}<p role="status" class="text-xs">
            Recherche…
          </p>{:else}<Field label="Emplacement de destination"
            ><Select bind:value={destination}
              ><option value="">Choisir un emplacement actif du site</option
              >{#each destinations as bin (bin.id)}<option value={bin.id}
                  >{bin.code} · {WMS_BIN_LABELS[bin.kind]}</option
                >{/each}</Select
            ></Field
          >{#if destinations.length >= 199}<p class="text-xs text-warn">
              Liste limitée à 200 résultats. Précisez le code.
            </p>{/if}{/if}<Field label={`Quantité (${moving.unit})`}
          ><Input
            type="number"
            bind:value={qty}
            min={0.001}
            step={0.001}
            max={Number(moving.qtyOnHand)}
          /></Field
        ><Field label="Note du mouvement"><Textarea bind:value={note} rows={2} /></Field>
        <div class="flex flex-wrap gap-2">
          <Button disabled={busy || uncertain || searching || !destination} onclick={move}
            >Vérifier le déplacement</Button
          ><Button
            variant="ghost"
            disabled={busy || uncertain}
            onclick={() => {
              moving = null;
              actionError = '';
            }}>Annuler la saisie</Button
          >
        </div>
      </fieldset>{/if}
  {/if}
  <div class="mt-4"><ErrorNotice message={actionError} /></div>
  {#snippet footer()}<Button variant="secondary" disabled={busy} onclick={close}
      >{uncertain ? 'Fermer et actualiser' : 'Fermer'}</Button
    >{/snippet}
</Drawer>
