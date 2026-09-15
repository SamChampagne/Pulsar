<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Drawer, Badge } from '$lib/components/ui';
  import type { MrpProposal } from '@pulsar/shared';
  type Document = {
    id: string;
    number: string;
    method: string;
    status: string;
    updatedAt: string;
    manufacturingOrderId: string | null;
    manufacturingOrder: { status: string } | null;
  };
  type Preview = {
    proposal: MrpProposal;
    item: { sku: string; name: string; unit: string };
    site: { name: string };
    revision: { revision: number } | null;
    existing: Document | null;
    canPrepare: boolean;
    blockers: string[];
    reviewToken: string;
    notice: string;
  };
  type Confirmation = { proposalId: string; reviewToken: string; operationKey: string };
  let {
    open = $bindable(false),
    runId,
    proposalId,
    canManage,
  }: {
    open?: boolean;
    runId: string;
    proposalId: string;
    canManage: boolean;
  } = $props();
  let view = $state<Preview | null>(null),
    busy = $state(false),
    error = $state('');
  let pending = $state<Confirmation | null>(null),
    acknowledged = $state(false),
    cancelConfirm = $state(false);
  let epoch = 0;
  let cancelNeedsRefresh = $state(false);
  const statusLabel = (status: string) =>
    ({
      DRAFT: 'Brouillon',
      CANCELLED: 'Annulé',
      RELEASED: 'Libéré',
      IN_PROGRESS: 'En cours',
      COMPLETED: 'Terminé',
    })[status] ?? status;
  const storageKey = $derived(
    `pulsar:mrp-preparation:${$auth?.tenant.id}:${$auth?.user.id}:${runId}:${proposalId}`,
  );
  function clearPending() {
    localStorage.removeItem(storageKey);
    pending = null;
  }
  async function load() {
    const stamp = ++epoch;
    busy = true;
    error = '';
    acknowledged = false;
    cancelConfirm = false;
    cancelNeedsRefresh = false;
    try {
      const raw = localStorage.getItem(storageKey);
      pending = raw ? JSON.parse(raw) : null;
      const next = await api<Preview>(`/manufacturing/mrp/runs/${runId}/preparation`, {
        query: { proposalId },
      });
      if (stamp !== epoch) return;
      view = next;
      if (next.existing) clearPending();
    } catch (e) {
      if (stamp === epoch)
        error = e instanceof Error ? e.message : 'Prévisualisation indisponible.';
    } finally {
      if (stamp === epoch) busy = false;
    }
  }
  $effect(() => {
    if (open && runId && proposalId)
      untrack(() => {
        view = null;
        void load();
      });
    return () => {
      epoch++;
    };
  });
  async function confirm() {
    if (!view || !canManage || (!pending && (!view.canPrepare || !acknowledged))) return;
    busy = true;
    error = '';
    try {
      const body = pending ?? {
        proposalId,
        reviewToken: view.reviewToken,
        operationKey: crypto.randomUUID(),
      };
      // Durable before sending. A lost response is retried with this exact body.
      localStorage.setItem(storageKey, JSON.stringify(body));
      pending = body;
      const document = await api<Document>(`/manufacturing/mrp/runs/${runId}/prepare`, {
        method: 'POST',
        body,
      });
      view = { ...view, existing: document, canPrepare: false, blockers: [] };
      clearPending();
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404, 409].includes(e.statusCode)) {
        clearPending();
        view = view ? { ...view, canPrepare: false } : null;
      }
      error =
        e instanceof Error
          ? e.message
          : 'Réponse incertaine. Vérifiez le document avant de reprendre la même confirmation.';
    } finally {
      busy = false;
    }
  }
  async function cancel() {
    if (!view?.existing || !cancelConfirm || cancelNeedsRefresh) return;
    busy = true;
    error = '';
    try {
      const document = await api<Document>(
        `/manufacturing/mrp/preparations/${view.existing.id}/cancel`,
        {
          method: 'POST',
          body: { expectedUpdatedAt: view.existing.updatedAt },
        },
      );
      view = { ...view, existing: document };
      cancelConfirm = false;
    } catch (e) {
      cancelConfirm = false;
      cancelNeedsRefresh = true;
      error =
        e instanceof Error
          ? e.message
          : 'Réponse incertaine. Rechargez avant toute nouvelle action.';
    } finally {
      busy = false;
    }
  }
</script>

<Drawer bind:open title="Préparer un document MRP" width="lg" dismissible={!busy}>
  {#snippet children()}
    <div class="space-y-5">
      {#if error}<p
          role="alert"
          class="rounded-md border border-danger/20 bg-danger/5 p-3 text-sm text-danger"
        >
          {error}
        </p>{/if}
      {#if busy && !view}<p role="status" class="text-sm text-ink-muted">
          Vérification du calcul et des documents…
        </p>{/if}
      {#if view}
        <header>
          <p class="font-mono text-xs text-ink-muted">{view.item.sku} · {view.site.name}</p>
          <h3 class="mt-1 text-lg font-semibold">{view.item.name}</h3>
          <p class="mt-2 text-2xl font-semibold tabular-nums">
            {view.proposal.quantity}
            <span class="text-sm font-normal text-ink-muted">{view.item.unit}</span>
          </p>
        </header>
        <dl class="grid grid-cols-2 gap-4 rounded-md border border-edge p-4 text-sm">
          <div>
            <dt class="text-ink-muted">Document</dt>
            <dd>
              {view.proposal.method === 'BUY' ? 'Demande d’achat interne' : 'Ordre de fabrication'}
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">État à la création</dt>
            <dd>Brouillon · à compléter</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Lancement prévu</dt>
            <dd>{view.proposal.release_date}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Besoin disponible le</dt>
            <dd>{view.proposal.receipt_date}</dd>
          </div>
          {#if view.revision}<div>
              <dt class="text-ink-muted">Nomenclature figée</dt>
              <dd>Version {view.revision.revision}</dd>
            </div>{/if}
        </dl>
        <p class="text-sm text-ink-muted">{view.notice}</p>
        {#if view.existing}
          <section
            class="space-y-3 rounded-md border border-edge bg-surface p-4"
            aria-label="Document préparé"
          >
            <div class="flex items-center justify-between gap-3">
              <strong>{view.existing.number}</strong>
              <Badge tone="neutral"
                >{statusLabel(
                  view.existing.manufacturingOrder?.status ?? view.existing.status,
                )}</Badge
              >
            </div>
            {#if view.existing.manufacturingOrderId}<a
                class="text-sm text-accent hover:underline"
                href={`/manufacturing/orders/${view.existing.manufacturingOrderId}`}
                >Ouvrir l’OF et compléter ses opérations →</a
              >
            {:else}<p class="text-sm text-ink-muted">
                Demande conservée dans ce calcul. Aucun bon de commande fournisseur n’a été émis.
              </p>
              {#if canManage && view.existing.status === 'DRAFT'}
                <label class="flex items-start gap-2 text-sm"
                  ><input
                    type="checkbox"
                    bind:checked={cancelConfirm}
                    disabled={busy || cancelNeedsRefresh}
                  />Je confirme l’annulation de cette demande interne.</label
                >
                <Button
                  variant="secondary"
                  disabled={!cancelConfirm || busy || cancelNeedsRefresh}
                  onclick={cancel}>Annuler la demande</Button
                >
              {/if}
            {/if}
          </section>
        {:else}
          {#if view.blockers.length}<ul class="list-disc space-y-2 pl-5 text-sm text-warn">
              {#each view.blockers as blocker (blocker)}<li>{blocker}</li>{/each}
            </ul>{/if}
          {#if pending}<p role="status" class="rounded-md border border-warn/30 p-3 text-sm">
              Une confirmation attend une réponse certaine. Rechargez pour vérifier; une reprise
              utilisera exactement la même clé, sans second document.
            </p>{/if}
          {#if view.canPrepare && canManage && !pending}<label
              class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={acknowledged} disabled={busy} />Je confirme la
              quantité, l’unité, le site et les dates de ce brouillon.</label
            >{/if}
          {#if canManage}<Button
              disabled={busy || (!pending && (!view.canPrepare || !acknowledged))}
              onclick={confirm}
              >{pending ? 'Reprendre la même confirmation' : 'Créer le brouillon confirmé'}</Button
            >{/if}
        {/if}
      {/if}
      <Button variant="secondary" disabled={busy} onclick={load}
        >Recharger la prévisualisation</Button
      >
    </div>
  {/snippet}
</Drawer>
