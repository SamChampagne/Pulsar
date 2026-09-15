<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Drawer, Field, Input, Select, Badge } from '$lib/components/ui';
  import {
    purchaseLabel,
    type MaterialRequest,
    type MaterialPurchase,
    type MaterialSupplier,
  } from './material-purchase-types';
  let {
    open = $bindable(false),
    preparationId,
    canManage,
    canReceive,
    onchanged,
  }: {
    open?: boolean;
    preparationId: string;
    canManage: boolean;
    canReceive: boolean;
    onchanged: () => void;
  } = $props();
  const base = '/manufacturing/material-purchases';
  let prep = $state<MaterialRequest | null>(null),
    order = $state<MaterialPurchase | null>(null);
  let suppliers = $state<MaterialSupplier[]>([]),
    bins = $state<{ id: string; code: string }[]>([]);
  let supplierSearch = $state(''),
    binSearch = $state('');
  let supplierTotal = $state(0),
    binTotal = $state(0);
  let supplierId = $state(''),
    unitPrice = $state('0'),
    currency = $state('CAD'),
    expectedDate = $state(''),
    terms = $state('');
  let reference = $state(''),
    toBinId = $state(''),
    quantity = $state(''),
    confirmed = $state(false),
    cancelConfirmed = $state(false),
    receiveConfirmed = $state(false);
  let busy = $state(false),
    error = $state(''),
    notice = $state(''),
    needsRefresh = $state(false),
    dirty = $state(false);
  let pending = $state<{ path: string; body: Record<string, unknown> } | null>(null);
  let epoch = 0;
  let amendmentKind = $state<'RESCHEDULE' | 'CLOSE_REMAINDER'>('RESCHEDULE'),
    amendmentDate = $state(''),
    amendmentReason = $state(''),
    amendmentConfirmed = $state(false);
  const key = $derived(
    `pulsar:material-purchase:${$auth?.tenant.id}:${$auth?.user.id}:${preparationId}`,
  );
  const locked = $derived(busy || needsRefresh || !!pending);
  async function choices(kind: 'suppliers' | 'bins') {
    if (!prep) return;
    busy = true;
    error = '';
    try {
      if (kind === 'suppliers') {
        const result = await api<{ items: MaterialSupplier[]; total: number }>(
          `${base}/suppliers`,
          { query: { search: supplierSearch, pageSize: 100 } },
        );
        suppliers = result.items;
        supplierTotal = result.total;
      } else {
        const result = await api<{ items: { id: string; code: string }[]; total: number }>(
          `/wms/sites/${prep.locationId}/bins`,
          { query: { search: binSearch, pageSize: 100 } },
        );
        bins = result.items;
        binTotal = result.total;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Choix indisponibles.';
    } finally {
      busy = false;
    }
  }
  async function load() {
    const stamp = ++epoch;
    busy = true;
    error = '';
    needsRefresh = false;
    dirty = false;
    confirmed = false;
    cancelConfirmed = false;
    receiveConfirmed = false;
    amendmentConfirmed = false;
    try {
      const raw = localStorage.getItem(key);
      pending = raw ? JSON.parse(raw) : null;
      const next = await api<MaterialRequest>(`${base}/requests/${preparationId}`);
      const po = next.purchaseOrder
        ? await api<MaterialPurchase>(`${base}/${next.purchaseOrder.id}`)
        : null;
      if (stamp !== epoch) return;
      prep = next;
      order = po;
      supplierId = po?.supplierId ?? '';
      unitPrice = po?.unitPrice ?? '0';
      currency = po?.currency ?? 'CAD';
      expectedDate = (po?.expectedDate ?? next.dueDate).slice(0, 10);
      amendmentDate = expectedDate;
      amendmentReason = '';
      terms = po?.terms ?? '';
      quantity = po?.remaining ?? '';
      reference = po?.supplierReference ?? '';
      toBinId = '';
      if (pending?.path === base && po) {
        localStorage.removeItem(key);
        pending = null;
      }
      // A receipt with a lost response keeps its exact operation key until replay confirms it.
      if (pending) {
        const sent = pending.body;
        if (pending.path === base) {
          supplierId = String(sent.supplierId);
          unitPrice = String(sent.unitPrice);
          currency = String(sent.currency);
          expectedDate = String(sent.expectedDate);
          terms = String(sent.terms ?? '');
        } else {
          quantity = String(sent.quantity);
          toBinId = String(sent.toBinId);
        }
      }
      if (canManage && (!po || po.status === 'DRAFT')) await choices('suppliers');
      if (canReceive && po?.status === 'CONFIRMED') await choices('bins');
    } catch (e) {
      if (stamp === epoch) {
        needsRefresh = true;
        error = e instanceof Error ? e.message : 'Dossier indisponible.';
      }
    } finally {
      if (stamp === epoch) busy = false;
    }
  }
  $effect(() => {
    if (open && preparationId)
      untrack(() => {
        prep = null;
        order = null;
        notice = '';
        void load();
      });
    return () => {
      epoch++;
    };
  });
  async function write(
    path: string,
    body: Record<string, unknown>,
    method: 'POST' | 'PUT' = 'POST',
    durable = false,
  ) {
    if (busy || needsRefresh || (!durable && pending)) return;
    busy = true;
    error = '';
    notice = '';
    try {
      if (durable) {
        pending = pending ?? { path, body: { ...body, operationKey: crypto.randomUUID() } };
        localStorage.setItem(key, JSON.stringify(pending));
        // The form is now durably retained. Inspection/closing must not ask to
        // abandon it after a lost response; replay uses this exact stored body.
        dirty = false;
        path = pending.path;
        body = pending.body;
      }
      const result = await api<MaterialPurchase | { receiptId: string }>(path, { method, body });
      if (durable) {
        localStorage.removeItem(key);
        pending = null;
      }
      notice =
        'receiptId' in result
          ? 'Réception brouillon créée. Ouvrez-la ci-dessous pour vérifier puis valider le stock.'
          : 'Commande enregistrée.';
      busy = false;
      await load();
      onchanged();
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404, 409].includes(e.statusCode) && durable) {
        localStorage.removeItem(key);
        pending = null;
      }
      needsRefresh = !pending;
      error =
        e instanceof Error
          ? e.message
          : 'Réponse incertaine. Rechargez et inspectez avant toute nouvelle action.';
      busy = false;
    }
  }
  function save() {
    if (!prep || !canManage || locked) return;
    const body = {
      supplierId,
      unitPrice,
      currency,
      expectedDate,
      terms,
      expectedUpdatedAt: order?.updatedAt ?? prep.updatedAt,
    };
    void write(
      order ? `${base}/${order.id}` : base,
      order ? body : { ...body, preparationId: prep.id },
      order ? 'PUT' : 'POST',
      !order,
    );
  }
  function closeAllowed() {
    return !dirty || window.confirm('Fermer et abandonner les conditions non enregistrées ?');
  }
</script>

<Drawer
  bind:open
  title={order?.number ?? 'Préparer un achat matières'}
  width="lg"
  dismissible={!busy}
  onbeforeclose={closeAllowed}
>
  {#snippet children()}
    <div class="space-y-5">
      {#if error}<p
          role="alert"
          class="rounded-md border border-danger/20 bg-danger/5 p-3 text-sm text-danger"
        >
          {error}
        </p>{/if}
      {#if notice}<p
          role="status"
          class="rounded-md border border-edge bg-surface-muted p-3 text-sm"
        >
          {notice}
        </p>{/if}
      {#if busy && !prep}<p role="status" class="text-sm text-ink-muted">
          Lecture de la demande et de ses réceptions…
        </p>{/if}
      {#if prep}
        <header class="space-y-2">
          <p class="font-mono text-xs text-ink-muted">
            {prep.number} · {prep.item.sku} · {prep.location.name}
          </p>
          <div class="flex items-start justify-between gap-3">
            <h3 class="text-lg font-semibold">{prep.item.name}</h3>
            <Badge tone="neutral">{purchaseLabel(order?.status ?? prep.status)}</Badge>
          </div>
          <p class="text-2xl font-semibold tabular-nums">
            {prep.quantity}
            <span class="text-sm font-normal text-ink-muted">{prep.unitSnapshot}</span>
          </p>
          <a
            class="text-sm text-accent hover:underline"
            href={`/manufacturing/mrp?runId=${prep.runId}`}>Revoir le calcul et la demande →</a
          >
        </header>
        {#if order}
          <section class="rounded-md border border-edge p-4" aria-label="Réception de la commande">
            <div class="flex justify-between gap-3 text-sm">
              <span>Reçu au stock</span><strong
                >{order.received} / {prep.quantity} {prep.unitSnapshot}</strong
              >
            </div>
            <progress
              aria-label="Part reçue au stock"
              max={Number(prep.quantity)}
              value={Number(order.received)}
              class="mt-3 h-2 w-full accent-accent"
            ></progress>
            <p class="mt-2 text-xs text-ink-muted">
              Reste {order.remaining}
              {prep.unitSnapshot} · seules les réceptions validées comptent.
            </p>
          </section>
        {/if}
        {#if canManage && prep.status === 'DRAFT' && (!order || order.status === 'DRAFT')}
          <form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault();
              save();
            }}
            oninput={() => {
              dirty = true;
            }}
          >
            <div class="space-y-2">
              <Field label="Rechercher un fournisseur"
                ><Input bind:value={supplierSearch} disabled={locked} /></Field
              >
              <Button
                type="button"
                variant="secondary"
                disabled={locked}
                onclick={() => choices('suppliers')}>Rechercher les fournisseurs</Button
              >
              <Field label="Fournisseur"
                ><Select
                  bind:value={supplierId}
                  disabled={locked}
                  required
                  onchange={(event) => {
                    terms = suppliers.find((s) => s.id === event.currentTarget.value)?.terms ?? '';
                    dirty = true;
                  }}
                  ><option value="">Sélectionner…</option
                  >{#if order && !suppliers.some((s) => s.id === order?.supplierId)}<option
                      value={order.supplierId}>{order.supplier.name}</option
                    >{/if}{#each suppliers.filter((s) => s.isActive) as supplier}<option
                      value={supplier.id}>{supplier.code} · {supplier.name}</option
                    >{/each}</Select
                ></Field
              >
              {#if supplierTotal > 100}<p class="text-xs text-ink-muted">
                  100 premiers résultats; précisez la recherche.
                </p>{/if}
            </div>
            <div class="grid grid-cols-2 gap-3">
              <Field label={`Prix unitaire / ${prep.unitSnapshot}`}
                ><Input bind:value={unitPrice} disabled={locked} required /></Field
              ><Field label="Devise"
                ><Select bind:value={currency} disabled={locked}
                  ><option>CAD</option><option>USD</option><option>EUR</option></Select
                ></Field
              >
            </div>
            <Field label="Arrivée attendue"
              ><Input type="date" bind:value={expectedDate} disabled={locked} required /></Field
            >
            <Field label="Conditions / notes"><Input bind:value={terms} disabled={locked} /></Field>
            <p class="text-xs text-ink-muted">
              Quantité et unité figées depuis le MRP. Montant hors taxes et transport, arrondi au
              cent à l’enregistrement. Aucun courriel envoyé.
            </p>
            <Button type="submit" disabled={locked || !supplierId || !expectedDate}
              >{order ? 'Enregistrer les conditions' : 'Créer le bon d’achat brouillon'}</Button
            >
          </form>
        {:else if order}
          <dl class="grid grid-cols-2 gap-4 border-y border-edge py-4 text-sm">
            <div>
              <dt class="text-ink-muted">Fournisseur capturé</dt>
              <dd>{order.supplier.name}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Sous-total hors taxes</dt>
              <dd class="font-mono">{order.subtotal} {order.currency}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Arrivée attendue</dt>
              <dd>{order.expectedDate.slice(0, 10)}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Référence fournisseur</dt>
              <dd>{order.supplierReference ?? 'Non confirmée'}</dd>
            </div>
          </dl>
        {/if}
        {#if order?.status === 'DRAFT' && canManage}
          <section class="space-y-3 border-t border-edge pt-4">
            <h4 class="font-medium">Confirmer une commande passée</h4>
            <p class="text-sm text-ink-muted">
              {order.subtotal}
              {order.currency} hors taxes · {order.supplier.name}. Cette action crée un arrivage
              ferme pour le MRP. Elle ne contacte pas le fournisseur.
            </p>
            <Field label="Référence de la commande fournisseur"
              ><Input bind:value={reference} disabled={locked || dirty} /></Field
            >
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={confirmed} disabled={locked || dirty} />Je
              confirme que cette commande a été passée au fournisseur avec ces quantités, prix et
              dates.</label
            >
            {#if dirty}<p class="text-sm text-warn">
                Enregistrez les conditions avant de confirmer.
              </p>{/if}
            <Button
              disabled={locked || dirty || !confirmed || !reference.trim()}
              onclick={() =>
                write(`${base}/${order!.id}/confirm`, {
                  expectedUpdatedAt: order!.updatedAt,
                  supplierReference: reference,
                })}>Confirmer l’achat et l’arrivage</Button
            >
          </section>
        {/if}
        {#if order?.status === 'CONFIRMED' && !order.closedAt && Number(order.remaining) > 0 && canManage}
          <section
            class="space-y-3 border-t border-edge pt-4"
            aria-label="Modifier la promesse fournisseur"
          >
            <h4 class="font-medium">Gérer un changement fournisseur</h4>
            <Field label="Modification"
              ><Select
                bind:value={amendmentKind}
                disabled={locked}
                onchange={() => {
                  amendmentConfirmed = false;
                }}
                ><option value="RESCHEDULE">Reporter / avancer l’arrivée</option><option
                  value="CLOSE_REMAINDER">Clôturer tout le reliquat</option
                ></Select
              ></Field
            >
            {#if amendmentKind === 'RESCHEDULE'}<Field label="Nouvelle date promise"
                ><Input type="date" bind:value={amendmentDate} disabled={locked} /></Field
              >{:else}<p class="rounded-md bg-surface-muted p-3 text-sm">
                {order.remaining}
                {prep.unitSnapshot} ne seront plus attendus. Les {order.received}
                {prep.unitSnapshot} déjà reçus restent en stock. Annulez d’abord les réceptions encore
                en brouillon.
              </p>{/if}
            <Field label="Motif du changement"
              ><Input bind:value={amendmentReason} disabled={locked} /></Field
            >
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={amendmentConfirmed} disabled={locked} />Je
              confirme ce changement convenu avec le fournisseur. Le MRP et le prochain planning
              utiliseront cette nouvelle situation.</label
            >
            <Button
              disabled={locked ||
                !amendmentConfirmed ||
                amendmentReason.trim().length < 3 ||
                (amendmentKind === 'RESCHEDULE' &&
                  (!amendmentDate || amendmentDate === expectedDate))}
              onclick={() =>
                write(`${base}/${order!.id}/amendments`, {
                  expectedUpdatedAt: order!.updatedAt,
                  kind: amendmentKind,
                  reason: amendmentReason,
                  ...(amendmentKind === 'RESCHEDULE' ? { expectedDate: amendmentDate } : {}),
                })}>Confirmer le changement</Button
            >
          </section>
        {/if}
        {#if order?.closedAt}<p class="rounded-md bg-surface-muted p-3 text-sm">
            Reliquat clôturé : {order.closedQuantity}
            {prep.unitSnapshot}. Aucune réception fictive; les quantités commandées et réellement
            reçues sont conservées.
          </p>{/if}
        {#if order?.amendments?.length}<section
            aria-label="Historique des promesses"
            class="space-y-3 border-t border-edge pt-4"
          >
            <h4 class="font-medium">Historique des promesses</h4>
            {#each order.amendments as amendment}<article
                class="border-l-2 border-edge pl-3 text-sm"
              >
                <p class="font-mono text-xs text-ink-muted">{amendment.createdAt.slice(0, 10)}</p>
                <p>
                  {amendment.kind === 'RESCHEDULE'
                    ? `${amendment.previousDate.slice(0, 10)} → ${amendment.expectedDate.slice(0, 10)}`
                    : `Reliquat clôturé : ${amendment.closedQuantity} ${prep.unitSnapshot}`}
                </p>
                <p class="text-ink-muted">{amendment.reason}</p>
              </article>{/each}
          </section>{/if}
        {#if order?.status === 'CONFIRMED' && !order.closedAt && Number(order.remaining) > 0 && canReceive}
          <section class="space-y-3 border-t border-edge pt-4">
            <h4 class="font-medium">Préparer une réception partielle</h4>
            <p class="text-sm text-ink-muted">
              Crée un dossier WMS à vérifier. Le stock ne change qu’à sa validation.
            </p>
            <Field label="Rechercher un emplacement"
              ><Input bind:value={binSearch} disabled={locked} /></Field
            >
            <Button variant="secondary" disabled={locked} onclick={() => choices('bins')}
              >Rechercher les emplacements</Button
            >
            <Field label="Emplacement de réception"
              ><Select bind:value={toBinId} disabled={locked}
                ><option value="">Sélectionner…</option>{#each bins as bin}<option value={bin.id}
                    >{bin.code}</option
                  >{/each}</Select
              ></Field
            >
            {#if binTotal > 100}<p class="text-xs text-ink-muted">
                100 premiers résultats; précisez la recherche.
              </p>{/if}
            <Field label={`Quantité reçue (${prep.unitSnapshot})`}
              ><Input bind:value={quantity} disabled={locked} /></Field
            >
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={receiveConfirmed} disabled={locked} />Je
              confirme la quantité à vérifier et l’emplacement de ce brouillon.</label
            >
            <Button
              disabled={locked || !receiveConfirmed || !toBinId || !quantity}
              onclick={() =>
                write(
                  `${base}/${order!.id}/receipts`,
                  { expectedUpdatedAt: order!.updatedAt, toBinId, quantity },
                  'POST',
                  true,
                )}>Créer la réception WMS</Button
            >
          </section>
        {/if}
        {#if order?.receipts.length}<section class="space-y-3" aria-label="Réceptions liées">
            <h4 class="font-medium">Réceptions liées</h4>
            {#each order.receipts as receipt}<a
                class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge p-3 text-sm hover:bg-surface-muted"
                href={`/wms/receiving/${receipt.id}`}
                ><span class="font-mono text-accent">{receipt.number} →</span><span
                  >{receipt.quantity} {prep.unitSnapshot}</span
                ><Badge tone="neutral">{purchaseLabel(receipt.status)}</Badge></a
              >{/each}
          </section>{/if}
        {#if order && !order.closedAt && order.status !== 'CANCELLED' && canManage && order.receipts.every((r) => r.status === 'CANCELLED')}
          <section class="space-y-3 border-t border-edge pt-4">
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={cancelConfirmed} disabled={locked || dirty} />Je
              confirme l’annulation de cette commande; si elle a été passée, son annulation a été
              convenue avec le fournisseur.</label
            ><Button
              variant="secondary"
              disabled={locked || dirty || !cancelConfirmed}
              onclick={() =>
                write(`${base}/${order!.id}/cancel`, { expectedUpdatedAt: order!.updatedAt })}
              >Annuler la commande</Button
            >
          </section>
        {/if}
      {/if}
      {#if pending}<section class="space-y-3 rounded-md border border-warn/30 p-3 text-sm">
          <p role="status">
            Réponse incertaine. Rechargez pour inspecter le dossier ou reprenez exactement la même
            demande, sans nouveau document.
          </p>
          <Button
            disabled={busy ||
              needsRefresh ||
              !canManage ||
              (pending.path.endsWith('/receipts') && !canReceive)}
            onclick={() => write(pending!.path, pending!.body, 'POST', true)}
            >Reprendre la même demande</Button
          >
        </section>{/if}
      <Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          if (closeAllowed()) void load();
        }}>Recharger le dossier</Button
      >
    </div>
  {/snippet}
</Drawer>

<style>
  progress {
    appearance: none;
    border: 0;
    border-radius: 999px;
    overflow: hidden;
    background: var(--color-surface-muted);
  }
  progress::-webkit-progress-bar {
    background: var(--color-surface-muted);
  }
  progress::-webkit-progress-value {
    background: var(--color-accent);
    border-radius: 999px;
  }
  progress::-moz-progress-bar {
    background: var(--color-accent);
    border-radius: 999px;
  }
</style>
