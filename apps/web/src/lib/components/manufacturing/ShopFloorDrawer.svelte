<script lang="ts">
  import { untrack } from 'svelte';
  import type { ManufacturingMaterialSnapshot } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Drawer, Field, Input, Select } from '$lib/components/ui';
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
      evidence: { movements: { id: string; type: string; quantity: string; unit: string }[] };
    }[];
  };
  type Intent = {
    operationKey: string;
    expectedUpdatedAt: string;
    goodQuantity: number;
    scrapQuantity: number;
    toBinId: string;
    note: string;
    consumptions: { itemId: string; fromBinId: string; quantity: string }[];
  };
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
  let lines = $state<{ itemId: string; fromBinId: string; quantity: string }[]>([]),
    pending = $state<Intent | null>(null);
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
  const locked = $derived(busy || !!pending || needsRefresh);
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
      const raw = localStorage.getItem(key);
      pending = raw ? JSON.parse(raw) : null;
      data = await api<View>(path);
      if (!pending && !dirty) {
        good = '';
        scrap = '0';
        toBinId = '';
        note = '';
        lines =
          data.materialSnapshot?.components.map((c) => ({
            itemId: c.itemId,
            quantity: '',
            fromBinId: '',
          })) ?? [];
      }
      if (pending) {
        good = String(pending.goodQuantity);
        scrap = String(pending.scrapQuantity);
        toBinId = pending.toBinId;
        note = pending.note;
        lines = pending.consumptions.map((c) => ({ ...c }));
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
  async function submit() {
    if (busy || needsRefresh || !canWrite || !data || (!pending && !confirmed)) return;
    busy = true;
    error = '';
    notice = '';
    try {
      pending = pending ?? {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: data.updatedAt,
        goodQuantity: Number(good),
        scrapQuantity: Number(scrap),
        toBinId,
        note,
        consumptions: lines.map((c) => ({ ...c })),
      };
      localStorage.setItem(key, JSON.stringify(pending));
      dirty = false;
      await api(`${path}/declarations`, { method: 'POST', body: pending });
      localStorage.removeItem(key);
      pending = null;
      notice = 'Production, consommations et mouvements de stock enregistrés ensemble.';
      await onchange();
      await load();
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404, 409].includes(e.statusCode)) {
        localStorage.removeItem(key);
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
  dismissible={!busy}
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
            {#each lines as line, index}{@const component = data.materialSnapshot.components.find(
                (c) => c.itemId === line.itemId,
              )!}
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
                {d.createdAt.slice(0, 19).replace('T', ' ')} UTC
              </p>
              <p class="mt-1">{d.goodQuantity} bons · {d.scrapQuantity} rebuts</p>
              <p class="text-ink-muted">{d.note}</p>
              <a
                class="mt-2 inline-block text-accent hover:underline"
                href={`/wms/movements?refType=manufacturing-declaration&refId=${d.id}`}
                >Voir les {d.evidence.movements.length} mouvements →</a
              >
            </article>{/each}
        </section>
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
      <Button variant="secondary" disabled={busy} onclick={load}>Actualiser l’atelier</Button>
    </div>{/snippet}
</Drawer>
