<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { page } from '$app/stores';
  import type { ComponentProps } from 'svelte';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PageHeader, Button, Input, Field, EntityPicker, Skeleton } from '$lib/components/ui';
  import type { SupplierOrder } from '$lib/components/business/types';
  import {
    readReceiptIntent,
    rememberReceiptIntent,
    clearReceiptIntent,
    type ReceiptIntent,
  } from '$lib/components/business/receipt-intent';
  import type { Paginated } from '@pulsar/shared';
  import { packageQuantity } from '@pulsar/shared';
  import ScanInput from '$lib/components/scanning/ScanInput.svelte';
  import LotChoice from '$lib/components/wms/LotChoice.svelte';
  let order = $state<SupplierOrder | null>(null),
    loading = $state(true),
    error = $state(''),
    storageError = $state(''),
    busy = $state(false),
    notice = $state('');
  let locationId = $state(''),
    reference = $state(''),
    confirmed = $state(false),
    pending = $state<ReceiptIntent | null>(null);
  let current = $state(1),
    total = $state(0),
    history = $state<
      {
        id: string;
        receipt: { id: string; number: string; reference: string; postedAt: string };
        lines: {
          orderLineId: string;
          unitSnapshot: string;
          packageCount?: string | null;
          receiptLine: { qty: string; lot?: { code: string; expiresOn: string | null } | null };
        }[];
      }[]
    >([]);
  type Draft = {
    qty: number | string | null;
    binId: string;
    usePackage: boolean;
    packageCount: string;
    lotId: string;
    lotReady: boolean;
  };
  let drafts = $state<Record<string, Draft>>({});
  let definitions = $state<ComponentProps<typeof CustomFieldInputs>['definitions']>([]);
  let customData = $state<Record<string, unknown>>({});
  const id = $derived($page.params.id);
  const scope = $derived(`${$auth?.tenant.id}:${$auth?.user.id}:${id}`);
  const canReadStock = $derived(
    $auth?.tenant.enabledModules.includes('wms') && $auth.user.permissions.includes('wms.read'),
  );
  const canReceive = $derived(
    canReadStock &&
      ['purchasing.manage', 'wms.manage'].every((p) =>
        (($auth?.user.permissions as string[]) ?? []).includes(p),
      ),
  );
  function preview(lineId: string, d: Draft): { quantity: number; error: string } {
    if (!d.usePackage) return { quantity: Number(d.qty), error: '' };
    if (!d.packageCount) return { quantity: 0, error: '' };
    const pack = order?.lines.find((l) => l.id === lineId)?.packageSnapshot;
    if (!pack) return { quantity: 0, error: 'Conditionnement absent.' };
    try {
      return {
        quantity: Number(packageQuantity(d.packageCount, pack.unitsPerPackage, pack.wholeOnly, 3)),
        error: '',
      };
    } catch (e) {
      return { quantity: 0, error: (e as Error).message };
    }
  }
  const selected = $derived(
    Object.entries(drafts)
      .map(([orderLineId, d]) => ({
        orderLineId,
        quantity: preview(orderLineId, d).quantity,
        binId: d.binId,
        ...(d.lotId ? { lotId: d.lotId } : {}),
        ...(d.usePackage ? { packageCount: d.packageCount } : {}),
      }))
      .filter((l) => l.quantity > 0),
  );
  const conversionError = $derived(
    Object.entries(drafts).some(([lineId, d]) => !!preview(lineId, d).error),
  );
  async function scanPackage(code: string) {
    if (!order || busy || pending) throw new Error('Ouvrez une réception disponible.');
    const version = order.updatedAt,
      orderId = order.id;
    const result = await api<{ orderLineId: string; orderUpdatedAt: string }>(
      `/purchasing/orders/${orderId}/resolve-package`,
      { method: 'POST', body: { code } },
    );
    if (
      busy ||
      pending ||
      order?.id !== orderId ||
      order.updatedAt !== version ||
      result.orderUpdatedAt !== version
    )
      throw new Error('La commande a changé. Actualisez les quantités avant de scanner.');
    const d = drafts[result.orderLineId];
    if (!d) throw new Error('Ligne indisponible. Rechargez la commande.');
    d.usePackage = true;
    confirmed = false;
    document.getElementById(`receipt-${result.orderLineId}`)?.scrollIntoView({ block: 'center' });
    return 'Conditionnement reconnu. Saisissez le nombre réellement reçu; aucun stock ajouté par le scan.';
  }
  beforeNavigate((n) => {
    if (busy || (!pending && (reference || selected.length))) {
      n.cancel();
      error = 'Terminez ou effacez la saisie avant de quitter.';
    }
  });
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const [o, h, defs] = await Promise.all([
        api<SupplierOrder>(`/purchasing/orders/${id}`),
        api<Paginated<(typeof history)[number]>>(`/purchasing/orders/${id}/receipts`, {
          query: { page: current, pageSize: 10 },
        }),
        canReceive
          ? api<typeof definitions>('/wms/custom-fields', { query: { entityType: 'RECEIPT' } })
          : Promise.resolve([]),
      ]);
      if (g === generation) {
        order = o;
        history = h.items;
        total = h.total;
        definitions = defs;
        for (const d of defs) customData[d.key] ??= d.type === 'BOOLEAN' ? false : '';
        for (const l of o.lines)
          drafts[l.id] ??= {
            qty: '',
            binId: '',
            usePackage: false,
            packageCount: '',
            lotId: '',
            lotReady: false,
          };
      }
    } catch (e) {
      if (g === generation) {
        error = e instanceof Error ? e.message : 'Lecture impossible.';
        order = null;
      }
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void id;
    void current;
    void load();
  });
  $effect(() => {
    try {
      pending = readReceiptIntent(scope);
      storageError = '';
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'Stockage indisponible.';
    }
  });
  $effect(() => {
    void locationId;
    for (const d of Object.values(drafts)) d.binId = '';
  });
  function reset() {
    reference = '';
    confirmed = false;
    customData = Object.fromEntries(
      definitions.map((d) => [d.key, d.type === 'BOOLEAN' ? false : '']),
    );
    for (const d of Object.values(drafts)) {
      d.qty = '';
      d.binId = '';
      d.usePackage = false;
      d.packageCount = '';
      d.lotId = '';
    }
  }
  async function send(request: ReceiptIntent) {
    if (busy) return;
    busy = true;
    error = '';
    const s = scope;
    try {
      const result = await api<{ receiptId: string }>(
        `/purchasing/orders/${request.orderId}/receipts`,
        { method: 'POST', body: request.body },
      );
      clearReceiptIntent(s, request.body.operationKey);
      pending = null;
      reset();
      current = 1;
      await load();
      notice = `Réception enregistrée. Le stock et le reliquat sont actualisés.`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Réponse incertaine.';
      if (e instanceof ApiError && e.statusCode < 500) {
        try {
          clearReceiptIntent(s, request.body.operationKey);
          pending = null;
        } catch {
          storageError = 'Impossible de libérer la demande conservée. Vérifiez le journal.';
        }
        // Keep the form, but do not silently adopt a new order version and resubmit.
      }
    } finally {
      busy = false;
    }
  }
  async function submit() {
    if (
      !order ||
      busy ||
      pending ||
      storageError ||
      !confirmed ||
      !selected.length ||
      selected.some((l) => !drafts[l.orderLineId].lotReady) ||
      conversionError
    )
      return;
    const request: ReceiptIntent = {
      orderId: order.id,
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: order.updatedAt,
        locationId,
        reference: reference.trim(),
        ...(Object.keys(customData).length ? { customData } : {}),
        lines: selected,
      },
    };
    try {
      rememberReceiptIntent(scope, request);
      pending = request;
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'Stockage indisponible; aucun envoi.';
      return;
    }
    await send(request);
  }
</script>

<svelte:head><title>Réceptions fournisseurs | Pulsar</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5">
  <PageHeader
    title={order ? `${order.number} · Réceptions` : 'Réceptions fournisseurs'}
    subtitle="Enregistrer les arrivages physiques et suivre le reste à recevoir."
  >
    {#snippet actions()}<a href="/purchasing" class="text-sm text-accent underline"
        >Retour aux commandes</a
      >{#if canReadStock}<Button variant="secondary" href={`/wms/stock-exits?purchaseOrderId=${id}`}
          >Retours liés à cette commande</Button
        >{/if}{/snippet}
  </PageHeader>
  <a class="text-sm text-accent underline" href="/documentation?module=purchasing"
    >Guide des réceptions et reliquats</a
  >
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}
  {#if pending}<section class="rounded-lg border border-warn p-4 space-y-3">
      <h2 class="font-semibold">Réception à vérifier</h2>
      <p class="text-sm">
        Une réponse a pu être perdue. La reprise utilise exactement la même demande et ne double pas
        une réception déjà enregistrée.
      </p>
      <Button
        disabled={!canReceive || busy || !!storageError}
        loading={busy}
        onclick={() => {
          if (pending) void send(pending);
        }}>Reprendre la réception conservée</Button
      >
    </section>{/if}
  <Button variant="secondary" disabled={busy || !!pending} onclick={load}
    >Actualiser les quantités</Button
  >
  {#if loading}<Skeleton rows={5} />{:else if order}
    <section
      class="rounded-lg border border-edge bg-surface overflow-x-auto"
      aria-label="Quantités fournisseur"
    >
      <table class="w-full text-sm text-left">
        <thead class="bg-surface-muted"
          ><tr
            ><th class="p-3">Article</th><th class="p-3">Commandé</th><th class="p-3">Reçu</th><th
              class="p-3">Reste à recevoir</th
            ></tr
          ></thead
        ><tbody>
          {#each order.lines as line}<tr class="border-t border-edge"
              ><td class="p-3"
                >{line.nameSnapshot}{#if line.packageSnapshot}<span
                    class="block text-xs text-ink-muted"
                    >{line.packageSnapshot.orderedCount} × {line.packageSnapshot.label} ({line
                      .packageSnapshot.unitsPerPackage}
                    {line.unitSnapshot})</span
                  >{/if}{#if !line.stockItem}<span class="block text-xs text-ink-muted"
                    >Prestation — hors stock</span
                  >{/if}</td
              ><td class="p-3 font-mono">{line.quantity} {line.unitSnapshot}</td><td
                class="p-3 font-mono"
                >{line.stockItem ? `${line.received} ${line.unitSnapshot}` : '—'}</td
              ><td class="p-3 font-mono"
                >{line.stockItem ? `${line.remaining} ${line.unitSnapshot}` : '—'}</td
              ></tr
            >{/each}
        </tbody>
      </table>
    </section>
    {#if order.closeReason}<p class="text-sm">Motif de clôture : {order.closeReason}</p>{/if}
    {#if canReceive && order.status === 'CONFIRMED' && !pending}<form
        class="rounded-lg border border-edge bg-surface p-5 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 class="font-semibold">Nouvel arrivage</h2>
        <p class="max-w-3xl text-sm leading-6 text-ink-muted">
          Saisissez seulement les produits réellement reçus. Chaque produit doit être relié au WMS
          dans Achats fournisseurs → Données → Articles → Stock WMS, avec la même unité. La
          confirmation crée et valide une réception WMS complète pour cet arrivage; la commande
          reste ouverte.
        </p>
        <fieldset disabled={busy || !!storageError} class="min-w-0 space-y-4">
          {#if order.lines.some((l) => l.packageSnapshot?.barcode)}<ScanInput
              label="Scanner le conditionnement de cet arrivage"
              disabled={busy || !!storageError}
              onscan={scanPackage}
            />{/if}
          <EntityPicker
            endpoint="/wms/sites"
            label="Entrepôt de réception"
            bind:value={locationId}
          />
          <Field label="Bon de livraison ou référence"
            ><Input required maxlength={1000} bind:value={reference} /></Field
          >
          {#if definitions.length}<CustomFieldInputs {definitions} bind:data={customData} />{/if}
          {#each order.lines.filter((l) => l.stockItem && Number(l.remaining) > 0) as line}<section
              class="border-t border-edge pt-4 space-y-3"
              aria-label={`Recevoir ${line.nameSnapshot}`}
              id={`receipt-${line.id}`}
            >
              <h3 class="text-sm font-medium">{line.nameSnapshot} · {line.unitSnapshot}</h3>
              {#if line.packageSnapshot}<label class="flex items-center gap-2 text-sm"
                  ><input
                    type="checkbox"
                    bind:checked={drafts[line.id].usePackage}
                    onchange={() => {
                      confirmed = false;
                    }}
                  />Saisir en {line.packageSnapshot.label} · {line.packageSnapshot.unitsPerPackage}
                  {line.unitSnapshot} par conditionnement</label
                >{/if}
              <div class="grid gap-3 sm:grid-cols-2">
                {#if drafts[line.id].usePackage}<Field label="Nombre de conditionnements reçus"
                    ><Input
                      aria-label={`Nombre de conditionnements reçus pour ${line.nameSnapshot}`}
                      inputmode="decimal"
                      bind:value={drafts[line.id].packageCount}
                      oninput={() => {
                        confirmed = false;
                      }}
                    /></Field
                  >{:else}<Field label="Quantité reçue maintenant"
                    ><Input
                      type="number"
                      min={0}
                      max={Number(line.remaining)}
                      step="0.001"
                      bind:value={drafts[line.id].qty}
                    /></Field
                  >{/if}
                {#if locationId}<EntityPicker
                    endpoint={`/wms/sites/${locationId}/bins`}
                    label={`Emplacement pour ${line.nameSnapshot}`}
                    labelKey="code"
                    bind:value={drafts[line.id].binId}
                  />{:else}<p class="self-center text-sm text-ink-muted">
                    Choisissez d’abord l’entrepôt.
                  </p>{/if}
              </div>
              <LotChoice
                catalogItemId={line.catalogItemId}
                allowCreate
                bind:value={drafts[line.id].lotId}
                bind:ready={drafts[line.id].lotReady}
                disabled={busy}
              />
              {#if drafts[line.id].usePackage}<p class="font-mono text-sm">
                  {drafts[line.id].packageCount || '0'} × {line.packageSnapshot?.unitsPerPackage} = {preview(
                    line.id,
                    drafts[line.id],
                  ).quantity}
                  {line.unitSnapshot} à réceptionner
                </p>
                {#if preview(line.id, drafts[line.id]).error}<p
                    role="alert"
                    class="text-sm text-danger"
                  >
                    {preview(line.id, drafts[line.id]).error}
                  </p>{/if}{/if}
            </section>{/each}
          <label class="flex gap-2 text-sm"
            ><input type="checkbox" bind:checked={confirmed} />Je confirme l’arrivée physique de ces
            quantités aux emplacements sélectionnés.</label
          >
        </fieldset>
        <div class="flex flex-wrap gap-2">
          <Button
            type="submit"
            loading={busy}
            disabled={!confirmed ||
              !locationId ||
              !reference.trim() ||
              !selected.length ||
              selected.some((l) => !l.binId) ||
              selected.some((l) => !drafts[l.orderLineId].lotReady) ||
              conversionError ||
              !!storageError}>Confirmer la réception physique</Button
          ><Button variant="ghost" disabled={busy} onclick={reset}>Effacer la saisie</Button>
        </div>
      </form>{:else if !canReceive}<p class="text-sm text-ink-muted">
        Réceptions en lecture seule. Pour agir : Entrepôt activé, droits Achats et gestion WMS.
      </p>{/if}
    <section class="space-y-3" aria-label="Historique des arrivages">
      <h2 class="font-semibold">Arrivages enregistrés</h2>
      {#if !history.length}<p class="text-sm text-ink-muted">
          Aucune réception liée. Une réception WMS saisie séparément n’est pas rapprochée
          automatiquement.
        </p>{/if}
      {#each history as r}<article class="rounded-lg border border-edge p-4">
          <div class="flex justify-between gap-3">
            <span class="font-mono">{r.receipt.number}</span>{#if canReadStock}<a
                class="text-sm text-accent underline"
                href={`/wms/receiving/${r.receipt.id}`}>Ouvrir la réception WMS</a
              >{/if}
          </div>
          <p class="my-2 text-sm text-ink-muted">
            {r.receipt.reference} · {fmtUserInstant(r.receipt.postedAt)}
          </p>
          <ul class="text-sm space-y-1">
            {#each r.lines as l}<li>
                {order.lines.find((x) => x.id === l.orderLineId)?.nameSnapshot} : {l.receiptLine
                  .qty}
                {l.unitSnapshot}
                {#if l.receiptLine.lot}<span class="text-ink-muted">
                    · Lot {l.receiptLine.lot.code} · Péremption : {l.receiptLine.lot.expiresOn?.slice(
                      0,
                      10,
                    ) ?? 'non renseignée'}</span
                  >{/if}
                {#if l.packageCount}<span class="text-ink-muted">
                    — {l.packageCount} × {order.lines.find((x) => x.id === l.orderLineId)
                      ?.packageSnapshot?.label}</span
                  >{/if}
              </li>{/each}
          </ul>
        </article>{/each}
      <div class="flex justify-end items-center gap-3">
        <Button
          variant="ghost"
          disabled={busy || current === 1}
          onclick={() => {
            current--;
          }}>Précédent</Button
        ><span class="text-sm">{current} / {Math.max(1, Math.ceil(total / 10))}</span><Button
          variant="ghost"
          disabled={busy || current * 10 >= total}
          onclick={() => {
            current++;
          }}>Suivant</Button
        >
      </div>
    </section>
  {/if}
</div>
