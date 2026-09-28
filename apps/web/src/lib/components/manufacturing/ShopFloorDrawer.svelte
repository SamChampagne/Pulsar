<script lang="ts">
  import { untrack } from 'svelte';
  import type { ManufacturingMaterialSnapshot } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Drawer, Field, Input, Select } from '$lib/components/ui';
  import LotChoice from '$lib/components/wms/LotChoice.svelte';
  import ConsumptionLot from './ConsumptionLot.svelte';
  import DeclarationCorrections from './DeclarationCorrections.svelte';
  import { formatDateTime } from '$lib/format';
  import {
    readProductionIntent,
    rememberProductionIntent,
    type ProductionIntent as Intent,
  } from './production-intent';
  type TraceMovement = {
    id: string;
    itemId: string;
    name: string;
    sku: string;
    binCode: string;
    type: string;
    quantity: string;
    unit: string;
    lot: {
      id: string;
      code: string;
      supplierLot: string | null;
      manufacturedOn: string | null;
      expiresOn: string | null;
    } | null;
  };
  let { orderId, onchange }: { orderId: string; onchange: () => Promise<void> } = $props();
  type View = {
    id: string;
    number: string;
    status: string;
    updatedAt: string;
    locationId: string;
    siteName: string;
    quantity: number;
    good: number;
    scrap: number;
    remaining: number;
    materialSnapshot: ManufacturingMaterialSnapshot;
    declarations: {
      id: string;
      goodQuantity: number;
      scrapQuantity: number;
      note: string;
      createdAt: string;
      reversal?: { id: string; reason: string; createdAt: string } | null;
      evidence: { version?: number; movements: TraceMovement[] };
    }[];
  };
  type Line = {
    key: string;
    itemId: string;
    fromBinId: string;
    quantity: string;
    lotId: string;
    ready: boolean;
  };
  const editableLine = (c: Intent['consumptions'][number]): Line => ({
    ...c,
    key: crypto.randomUUID(),
    lotId: c.lotId ?? '',
    ready: false,
  });
  let open = $state(false),
    data = $state<View | null>(null),
    busy = $state(false),
    error = $state(''),
    notice = $state(''),
    needsRefresh = $state(false);
  let bins = $state<{ id: string; code: string }[]>([]),
    binTotal = $state(0),
    search = $state(''),
    good = $state(''),
    scrap = $state('0'),
    toBinId = $state(''),
    note = $state(''),
    confirmed = $state(false),
    dirty = $state(false);
  let outputLotId = $state(''),
    outputReady = $state(false);
  let lines = $state<Line[]>([]),
    pending = $state<Intent | null>(null);
  let correctionActive = $state(false),
    correctionBusy = $state(false);
  const canRead = $derived(
    !!$auth?.user.permissions.includes('wms.read') &&
      !!$auth?.tenant.enabledModules.includes('wms'),
  );
  const canWrite = $derived(
    canRead &&
      !!$auth?.user.permissions.includes('wms.manage') &&
      !!$auth?.user.permissions.includes('manufacturing.manage'),
  );
  const key = $derived(`pulsar:production:${$auth?.tenant.id}:${$auth?.user.id}:${orderId}`);
  const locked = $derived(busy || !!pending || needsRefresh || correctionActive);
  const path = $derived(`/manufacturing/shop-floor/orders/${orderId}`);
  async function choices() {
    if (!data) return;
    const result = await api<{ items: typeof bins; total: number }>(
      `/wms/sites/${data.locationId}/bins`,
      { query: { pageSize: 100, search } },
    );
    bins = result.items;
    binTotal = result.total;
  }
  async function searchBins() {
    busy = true;
    error = '';
    try {
      await choices();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Emplacements indisponibles.';
    } finally {
      busy = false;
    }
  }
  async function load() {
    busy = true;
    error = '';
    needsRefresh = true;
    confirmed = false;
    try {
      pending = readProductionIntent(key);
      data = await api<View>(path);
      if (!pending && !dirty) {
        good = '';
        scrap = '0';
        toBinId = '';
        outputLotId = '';
        note = '';
        lines =
          data.materialSnapshot?.components.map((c) =>
            editableLine({
              itemId: c.itemId,
              quantity: '',
              fromBinId: '',
            }),
          ) ?? [];
      }
      if (pending) {
        good = String(pending.goodQuantity);
        scrap = String(pending.scrapQuantity);
        toBinId = pending.toBinId;
        outputLotId = pending.outputLotId ?? '';
        note = pending.note;
        lines = pending.consumptions.map(editableLine);
      }
      if (data.locationId && canWrite) await choices();
      needsRefresh = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Atelier indisponible.';
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    if (open && orderId)
      untrack(() => {
        data = null;
        dirty = false;
        notice = '';
        void load();
      });
  });
  $effect(() => {
    if (Number(good) === 0 && !pending) outputLotId = '';
  });
  $effect(() => {
    void outputLotId;
    void JSON.stringify(
      lines.map(({ itemId, fromBinId, quantity, lotId }) => ({
        itemId,
        fromBinId,
        quantity,
        lotId,
      })),
    );
    confirmed = false;
  });
  const lotsReady = $derived(
    (Number(good) === 0 || outputReady) &&
      lines.every(
        (l) =>
          /^\d{1,9}(\.\d{1,3})?$/.test(l.quantity) &&
          !!l.fromBinId &&
          (Number(l.quantity) === 0 || l.ready),
      ),
  );
  async function submit() {
    if (
      busy ||
      correctionActive ||
      needsRefresh ||
      !canWrite ||
      !data ||
      (!pending && (!confirmed || !lotsReady))
    )
      return;
    const recovery = !!pending;
    const requestKey = key,
      requestPath = path;
    busy = true;
    error = '';
    notice = '';
    try {
      const request = pending ?? {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: data.updatedAt,
        goodQuantity: Number(good),
        scrapQuantity: Number(scrap),
        toBinId,
        ...(outputLotId ? { outputLotId } : {}),
        note,
        consumptions: lines.map(({ itemId, fromBinId, quantity, lotId }) => ({
          itemId,
          fromBinId,
          quantity,
          ...(lotId ? { lotId } : {}),
        })),
      };
      rememberProductionIntent(requestKey, request);
      pending = request;
      dirty = false;
      await api(`${requestPath}/declarations`, { method: 'POST', body: request });
      localStorage.removeItem(requestKey);
      if (key !== requestKey) return;
      pending = null;
      notice = 'Production, consommations et mouvements de stock enregistrés ensemble.';
      await onchange();
      await load();
    } catch (e) {
      if (key !== requestKey) return;
      if (!recovery && e instanceof ApiError && [400, 403, 404, 409].includes(e.statusCode)) {
        localStorage.removeItem(requestKey);
        pending = null;
        dirty = true;
        needsRefresh = true;
      }
      error =
        e instanceof Error
          ? e.message
          : 'Réponse incertaine : inspectez puis reprenez la même déclaration.';
    } finally {
      busy = false;
    }
  }
</script>

{#if canRead}<Button
    variant="secondary"
    onclick={() => {
      open = true;
    }}>Atelier et stock réel</Button
  >{/if}
<Drawer
  bind:open
  title={data ? `${data.number} · Atelier` : 'Atelier'}
  width="lg"
  dismissible={!busy && !correctionBusy}
  onbeforeclose={() =>
    !dirty || !!pending || window.confirm('Fermer et abandonner la saisie non enregistrée ?')}
>
  {#snippet children()}<div class="space-y-5">
      {#if error}<p role="alert" class="rounded-md border border-danger/20 p-3 text-sm text-danger">
          {error}
        </p>{/if}{#if notice}<p role="status" class="text-sm text-accent">{notice}</p>{/if}
      {#if busy && !data}<p role="status">Lecture de l’atelier…</p>{/if}
      {#if data}<section class="rounded-md bg-surface-muted p-4">
          <p class="text-sm text-ink-muted">
            {data.siteName} · quantité OF : {data.quantity}
            {data.materialSnapshot?.product.unit ?? ''}
          </p>
          <dl class="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt class="text-xs text-ink-muted">Bons produits</dt>
              <dd class="text-xl font-mono">{data.good}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Rebuts</dt>
              <dd class="text-xl font-mono">{data.scrap}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">À déclarer</dt>
              <dd class="text-xl font-mono">{data.remaining}</dd>
            </div>
          </dl>
        </section>
        {#if canWrite && data.status === 'IN_PROGRESS' && data.remaining > 0 && data.materialSnapshot}
          <form
            class="space-y-4"
            oninput={() => {
              dirty = true;
              confirmed = false;
            }}
            onsubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 class="font-medium">Déclarer ce qui a réellement été fait</h3>
            <p class="text-sm text-ink-muted">
              Les consommations ci-dessous sortent du stock. Seuls les bons produits entrent en
              stock. Le rebut est enregistré sans créer de produit disponible. Aucun arrondi ou
              consommation automatique.
            </p>
            <div class="grid grid-cols-2 gap-3">
              <Field label="Quantité bonne"
                ><Input
                  type="number"
                  min="0"
                  step="1"
                  bind:value={good}
                  required
                  disabled={locked}
                /></Field
              ><Field label="Quantité rebutée"
                ><Input
                  type="number"
                  min="0"
                  step="1"
                  bind:value={scrap}
                  required
                  disabled={locked}
                /></Field
              >
            </div>
            <Field label="Rechercher les emplacements"
              ><Input bind:value={search} disabled={locked} /></Field
            ><Button variant="secondary" disabled={locked} onclick={searchBins}
              >Rechercher les emplacements</Button
            >{#if binTotal > 100}<p class="text-xs text-ink-muted">
                Précisez la recherche : {binTotal} emplacements.
              </p>{/if}
            <Field label="Destination des produits finis"
              ><Select bind:value={toBinId} required disabled={locked}
                ><option value="">Choisir…</option>{#each bins as bin}<option value={bin.id}
                    >{bin.code}</option
                  >{/each}</Select
              ></Field
            >
            {#if Number(good) > 0}<section
                class="space-y-2 rounded-md border border-edge p-3"
                aria-label="Lot produit"
              >
                <h4 class="text-sm font-medium">
                  Lot des bons produits · {data.materialSnapshot.product.name}
                </h4>
                <LotChoice
                  itemId={data.materialSnapshot.product.itemId}
                  bind:value={outputLotId}
                  bind:ready={outputReady}
                  disabled={locked}
                  allowCreate
                />
                <p class="text-xs text-ink-muted">
                  Un lot de sortie par déclaration. Pour plusieurs lots produits, faites des
                  déclarations distinctes. Créer sa fiche ne crée aucun stock.
                </p>
              </section>{/if}
            {#each lines as line, index (line.key)}{@const component =
                data.materialSnapshot.components.find((c) => c.itemId === line.itemId)!}
              <fieldset class="space-y-3 rounded-md border border-edge p-3">
                <legend class="px-1 text-sm font-medium">{component.name} · {component.unit}</legend
                >
                <p class="text-xs text-ink-muted">
                  Théorique pour l’OF complet : {component.requiredQuantity}
                  {component.unit}. Saisissez uniquement la consommation de cette déclaration.
                </p>
                <Field label={`Consommation réelle ${component.sku}`}
                  ><Input bind:value={lines[index].quantity} required disabled={locked} /></Field
                ><Field label={`Emplacement source ${component.sku}`}
                  ><Select bind:value={lines[index].fromBinId} required disabled={locked}
                    ><option value="">Choisir…</option>{#each bins as bin}<option value={bin.id}
                        >{bin.code}</option
                      >{/each}</Select
                  ></Field
                >
                <ConsumptionLot
                  itemId={line.itemId}
                  binId={line.fromBinId}
                  quantity={line.quantity}
                  bind:value={lines[index].lotId}
                  bind:ready={lines[index].ready}
                  disabled={locked}
                />
                <div class="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={locked || lines.length >= 200}
                    onclick={() => {
                      lines.splice(
                        index + 1,
                        0,
                        editableLine({ itemId: line.itemId, fromBinId: '', quantity: '' }),
                      );
                      dirty = true;
                    }}>Ajouter un lot / emplacement</Button
                  >
                  {#if lines.filter((l) => l.itemId === line.itemId).length > 1}<Button
                      variant="ghost"
                      disabled={locked}
                      onclick={() => {
                        lines.splice(index, 1);
                        dirty = true;
                      }}>Retirer cette ligne</Button
                    >{/if}
                </div>
              </fieldset>{/each}
            <Field label="Note d’atelier / écarts / rebuts"
              ><Input bind:value={note} required disabled={locked} /></Field
            >
            <label class="flex items-start gap-2 text-sm"
              ><input
                type="checkbox"
                bind:checked={confirmed}
                disabled={locked}
                oninput={(event) => event.stopPropagation()}
              />Je confirme les quantités et les emplacements. Cette déclaration écrit immédiatement
              les mouvements réels, sans annulation automatique.</label
            >
            <Button
              type="submit"
              disabled={locked ||
                !lotsReady ||
                !Number.isInteger(Number(good)) ||
                !Number.isInteger(Number(scrap)) ||
                Number(good) < 0 ||
                Number(scrap) < 0 ||
                Number(good) + Number(scrap) <= 0 ||
                Number(good) + Number(scrap) > data.remaining ||
                !confirmed ||
                String(good) === '' ||
                String(scrap) === '' ||
                !toBinId ||
                note.trim().length < 3}>Valider la déclaration et le stock</Button
            >
          </form>
        {:else if !data.materialSnapshot}<p class="text-sm text-ink-muted">
            Définition matières figée absente : aucune déclaration de stock ne peut être inventée
            pour cet OF historique.
          </p>{:else if data.status === 'RELEASED'}<p class="text-sm text-ink-muted">
            Démarrez l’OF pour déclarer l’activité réelle.
          </p>{:else if data.remaining === 0}<p class="text-sm text-ink-muted">
            Toute la quantité a été déclarée. Terminez l’OF depuis son dossier après vérification.
          </p>{/if}
        <section aria-label="Déclarations d’atelier" class="space-y-3">
          <h3 class="font-medium">Déclarations et preuves WMS</h3>
          {#if !data.declarations.length}<p class="text-sm text-ink-muted">
              Aucune déclaration.
            </p>{/if}{#each data.declarations as d}<article
              class="rounded-md border border-edge p-3 text-sm"
            >
              <p class="font-mono text-xs text-ink-muted">
                {formatDateTime(d.createdAt)}
              </p>
              <p class="mt-1">{d.goodQuantity} bons · {d.scrapQuantity} rebuts</p>
              {#if d.reversal}<aside
                  class="my-2 rounded-md border border-warn/30 p-3"
                  aria-label="Déclaration contrepassée"
                >
                  <p class="font-medium">Contrepassée — exclue des quantités actives</p>
                  <p class="text-xs text-ink-muted">{formatDateTime(d.reversal.createdAt)}</p>
                  <p>{d.reversal.reason}</p>
                  <a
                    class="text-accent hover:underline"
                    href={`/wms/movements?refType=manufacturing-reversal&refId=${d.reversal.id}`}
                    >Voir les mouvements compensatoires →</a
                  >
                  <p class="text-xs text-ink-muted">
                    La preuve originale ci-dessous reste historique. Une nouvelle déclaration
                    corrigée est une action distincte.
                  </p>
                </aside>{/if}
              <p class="text-ink-muted">{d.note}</p>
              {#if d.evidence.version === 2}<section
                  aria-label="Traçabilité des lots"
                  class="mt-3 space-y-3 rounded-md bg-surface-muted p-3"
                >
                  <h4 class="font-medium">Matières consommées → Production bonne</h4>
                  <p class="text-xs text-ink-muted">
                    Lien de cette déclaration seulement, pas une attribution par pièce. Les
                    consommations d’une autre déclaration ne sont pas rattachées implicitement.
                  </p>
                  <div class="grid gap-3 sm:grid-cols-2">
                    {#each ['CONSUMPTION', 'PRODUCTION'] as kind}<div class="min-w-0 space-y-2">
                        <h5 class="text-xs font-semibold">
                          {kind === 'CONSUMPTION' ? 'Sorties matières' : 'Entrée produit fini'}
                        </h5>
                        {#each d.evidence.movements.filter((m) => m.type === kind) as m}<div
                            class="rounded-md border border-edge bg-surface p-2"
                          >
                            <p class="break-words font-medium">{m.sku} · {m.name}</p>
                            <p class="font-mono text-xs">{m.quantity} {m.unit} · {m.binCode}</p>
                            {#if m.lot}<p class="mt-1 break-words">Lot {m.lot.code}</p>
                              <p class="text-xs text-ink-muted">
                                Lot fournisseur : {m.lot.supplierLot ?? 'non renseigné'} · Péremption
                                déclarée : {m.lot.expiresOn ?? 'non renseignée'}
                              </p>
                              <p class="text-xs text-ink-muted">
                                Fabrication déclarée : {m.lot.manufacturedOn ?? 'non renseignée'}
                              </p>
                              <a
                                class="text-xs text-accent hover:underline"
                                href={`/wms/movements?lotId=${encodeURIComponent(m.lot.id)}&refType=manufacturing-declaration&refId=${d.id}`}
                                >Mouvements de ce lot →</a
                              >
                            {:else}<p class="text-xs text-ink-muted">
                                Article sans suivi par lot.
                              </p>{/if}
                          </div>
                        {:else}<p class="text-xs text-ink-muted">
                            {kind === 'CONSUMPTION'
                              ? 'Aucune matière consommée dans cette déclaration.'
                              : 'Aucune entrée de stock pour le rebut.'}
                          </p>{/each}
                      </div>{/each}
                  </div>
                </section>{:else}<p class="mt-2 text-xs text-ink-muted">
                  Preuve historique sans capture des lots : aucune généalogie déduite.
                </p>{/if}
              <a
                class="mt-2 inline-block text-accent hover:underline"
                href={`/wms/movements?refType=manufacturing-declaration&refId=${d.id}`}
                >Voir les {d.evidence.movements.length} mouvements →</a
              >
            </article>{/each}
        </section>
        {#if canWrite && (data.status === 'IN_PROGRESS' || data.declarations.some((d) => d.reversal))}
          <DeclarationCorrections
            {orderId}
            declarations={data.declarations}
            disabled={busy || !!pending || needsRefresh || dirty}
            bind:active={correctionActive}
            bind:busy={correctionBusy}
            onchange={async () => {
              await onchange();
              await load();
            }}
          />
        {/if}
      {/if}
      {#if pending}<section class="space-y-3 rounded-md border border-warn/30 p-3 text-sm">
          <p>
            Réponse incertaine. La demande exacte est conservée sur cet appareil; sa reprise ne crée
            pas de doublon.
          </p>
          <Button disabled={busy || needsRefresh || !canWrite} onclick={submit}
            >Reprendre la même déclaration</Button
          >
        </section>{/if}
      <Button variant="secondary" disabled={busy || correctionActive} onclick={load}
        >Actualiser l’atelier</Button
      >
    </div>{/snippet}
</Drawer>
