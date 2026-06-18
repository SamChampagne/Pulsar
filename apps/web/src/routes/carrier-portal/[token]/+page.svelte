<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Button, Card, Textarea } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDate } from '$lib/format';

  interface CarrierView {
    shipper: string;
    carrier: {
      name: string;
      code: string;
      email: string | null;
      phone: string | null;
      contactName: string | null;
    };
    tenders: {
      id: string;
      loadNumber: string;
      status: string;
      expiresAt: string | null;
      message: string | null;
    }[];
    loads: {
      id: string;
      loadNumber: string;
      status: string;
      dispatchedAt: string | null;
      completedAt: string | null;
      shipments: {
        shipmentNumber: string;
        status: string;
        actualDeliveryAt: string | null;
      }[];
    }[];
    invoices: {
      id: string;
      carrierInvoiceNumber: string;
      currency: string;
      chargedTotal: number;
      matchedTotal: number | null;
      varianceTotal: number | null;
      status: string;
      disputeReasonCode: string | null;
      disputeNote: string | null;
      resolution: string | null;
      paidAt: string | null;
    }[];
  }

  const token = $derived(page.params.token);

  let view = $state<CarrierView | null>(null);
  let error = $state('');
  let declining = $state<string | null>(null);
  let declineReason = $state('');
  let uploadingPod = $state<string | null>(null);
  let uploadingInvoice = $state<string | null>(null);
  let tenderError = $state('');
  let podNotice = $state('');
  let invoiceNotice = $state('');

  async function load() {
    try {
      view = await api<CarrierView>(`/public/carrier-portal/${token}`);
    } catch (e) {
      error = e instanceof ApiError && e.statusCode === 404
        ? 'Ce lien est invalide ou a expiré.'
        : (e instanceof ApiError ? e.message : 'Ce lien est invalide ou a expiré.');
    }
  }

  async function acceptTender(id: string) {
    tenderError = '';
    try {
      await api(`/public/carrier-portal/${token}/tenders/${id}/accept`, { method: 'POST' });
      await load();
    } catch (e) {
      tenderError = e instanceof ApiError ? e.message : 'Action échouée';
    }
  }

  async function confirmDecline() {
    if (!declining) return;
    tenderError = '';
    try {
      await api(`/public/carrier-portal/${token}/tenders/${declining}/decline`, {
        method: 'POST',
        body: { reason: declineReason || undefined },
      });
      declining = null;
      declineReason = '';
      await load();
    } catch (e) {
      tenderError = e instanceof ApiError ? e.message : 'Action échouée';
    }
  }

  async function uploadPod(loadId: string, file: File) {
    uploadingPod = loadId;
    podNotice = '';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/v1/public/carrier-portal/${token}/loads/${loadId}/pod`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      podNotice = 'POD téléversé avec succès.';
    } catch {
      podNotice = 'Échec du téléversement.';
    } finally {
      uploadingPod = null;
    }
  }

  async function uploadInvoiceAttachment(invoiceId: string, file: File) {
    uploadingInvoice = invoiceId;
    invoiceNotice = '';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/v1/public/carrier-portal/${token}/invoices/${invoiceId}/attachment`,
        { method: 'POST', body: fd },
      );
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      invoiceNotice = 'Document joint avec succès.';
    } catch {
      invoiceNotice = 'Échec du téléversement.';
    } finally {
      uploadingInvoice = null;
    }
  }

  $effect(() => {
    if (token) void load();
  });
</script>

<PublicShell maxWidth="max-w-3xl">
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if view}
    <p class="mb-1 text-sm text-ink-muted">Portail transporteur · {view.shipper}</p>
    <h1 class="mb-4 text-xl font-bold text-ink">{view.carrier.name}</h1>

    <!-- Carrier profile card -->
    <div class="mb-6">
    <Card>
      <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <p class="text-xs text-ink-muted">Code</p>
          <p class="font-mono font-semibold text-ink">{view.carrier.code}</p>
        </div>
        <div>
          <p class="text-xs text-ink-muted">Contact</p>
          <p class="text-ink">{view.carrier.contactName ?? '—'}</p>
        </div>
        <div>
          <p class="text-xs text-ink-muted">Courriel</p>
          <p class="text-ink">{view.carrier.email ?? '—'}</p>
        </div>
        <div>
          <p class="text-xs text-ink-muted">Téléphone</p>
          <p class="text-ink">{view.carrier.phone ?? '—'}</p>
        </div>
      </div>
    </Card>
    </div>

    <!-- Tenders section -->
    <h2 class="mb-2 mt-6 text-base font-semibold text-ink">Appels d'offres</h2>
    {#if tenderError}
      <p class="mb-2 text-sm text-danger">{tenderError}</p>
    {/if}
    {#if view.tenders.length === 0}
      <p class="text-sm text-ink-muted">Aucun appel d'offres.</p>
    {:else}
      <div class="flex flex-col divide-y divide-edge rounded-card border border-edge bg-surface">
        {#each view.tenders as tender (tender.id)}
          <div class="p-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <strong class="font-mono text-ink">{tender.loadNumber}</strong>
              <Badge tone={toneFor(tender.status)}>{labelFor(tender.status)}</Badge>
              {#if tender.expiresAt}
                <span class="text-xs text-ink-muted">Expire le {formatDate(tender.expiresAt)}</span>
              {/if}
            </div>
            {#if tender.message}
              <p class="mb-2 text-sm text-ink-muted">{tender.message}</p>
            {/if}
            {#if tender.status === 'PENDING'}
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button onclick={() => acceptTender(tender.id)}>Accepter</Button>
                <Button variant="secondary" onclick={() => { declining = tender.id; declineReason = ''; }}>Refuser</Button>
              </div>
            {/if}
            {#if declining === tender.id}
              <div class="mt-3 rounded-md border border-edge bg-canvas p-3">
                <p class="mb-2 text-sm font-medium text-ink">Motif de refus (optionnel)</p>
                <Textarea bind:value={declineReason} rows={2} placeholder="Indiquez un motif…" />
                <div class="mt-2 flex gap-2">
                  <Button variant="danger" onclick={confirmDecline}>Confirmer le refus</Button>
                  <Button variant="secondary" onclick={() => { declining = null; declineReason = ''; }}>Annuler</Button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Loads section -->
    <h2 class="mb-2 mt-6 text-base font-semibold text-ink">Chargements</h2>
    {#if view.loads.length === 0}
      <p class="text-sm text-ink-muted">Aucun chargement.</p>
    {:else}
      <div class="flex flex-col divide-y divide-edge rounded-card border border-edge bg-surface">
        {#each view.loads as load (load.id)}
          <div class="p-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <strong class="font-mono text-ink">{load.loadNumber}</strong>
              <Badge tone={toneFor(load.status)}>{labelFor(load.status)}</Badge>
              {#if load.dispatchedAt}
                <span class="text-xs text-ink-muted">Dispatché le {formatDate(load.dispatchedAt)}</span>
              {/if}
              {#if load.completedAt}
                <span class="text-xs text-ink-muted">Complété le {formatDate(load.completedAt)}</span>
              {/if}
            </div>
            {#if load.shipments.length > 0}
              <table class="mb-3 w-full text-sm">
                <tbody>
                  {#each load.shipments as shipment (shipment.shipmentNumber)}
                    <tr class="border-b border-edge last:border-0">
                      <td class="py-1.5 pr-3 font-mono text-ink">{shipment.shipmentNumber}</td>
                      <td class="py-1.5 pr-3">
                        <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                      </td>
                      <td class="py-1.5 text-ink-muted">
                        {shipment.actualDeliveryAt ? `Livré le ${formatDate(shipment.actualDeliveryAt)}` : ''}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
            <div class="flex flex-wrap items-center gap-2">
              <label class="text-xs text-ink-muted">
                POD :
                <input
                  type="file"
                  class="ml-1 text-xs"
                  disabled={uploadingPod === load.id}
                  onchange={(e) => {
                    const f = (e.currentTarget as HTMLInputElement).files?.[0];
                    if (f) void uploadPod(load.id, f);
                  }}
                />
              </label>
              {#if uploadingPod === load.id}
                <span class="text-xs text-ink-muted">Envoi…</span>
              {/if}
            </div>
            {#if podNotice}
              <p class="mt-1 text-xs text-ok">{podNotice}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Invoices section -->
    <h2 class="mb-2 mt-6 text-base font-semibold text-ink">Factures</h2>
    {#if view.invoices.length === 0}
      <p class="text-sm text-ink-muted">Aucune facture.</p>
    {:else}
      <div class="flex flex-col divide-y divide-edge rounded-card border border-edge bg-surface">
        {#each view.invoices as invoice (invoice.id)}
          <div class="p-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <strong class="font-mono text-ink">{invoice.carrierInvoiceNumber}</strong>
              <Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge>
              <span class="text-sm text-ink">{invoice.chargedTotal.toFixed(2)} {invoice.currency}</span>
              {#if invoice.matchedTotal !== null}
                <span class="text-xs text-ink-muted">Rapproché : {invoice.matchedTotal.toFixed(2)} {invoice.currency}</span>
              {/if}
              {#if invoice.varianceTotal !== null}
                <span class="text-xs text-ink-muted">Écart : {invoice.varianceTotal.toFixed(2)} {invoice.currency}</span>
              {/if}
            </div>
            {#if invoice.disputeReasonCode || invoice.disputeNote}
              <p class="mb-1 text-xs text-ink-muted">
                Litige : {invoice.disputeReasonCode ?? ''}{invoice.disputeNote ? ` — ${invoice.disputeNote}` : ''}
              </p>
            {/if}
            {#if invoice.resolution}
              <p class="mb-1 text-xs text-ink-muted">Résolution : {invoice.resolution}</p>
            {/if}
            {#if invoice.paidAt}
              <p class="mb-1 text-xs text-ink-muted">Payé le {formatDate(invoice.paidAt)}</p>
            {/if}
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <label class="text-xs text-ink-muted">
                Document :
                <input
                  type="file"
                  class="ml-1 text-xs"
                  disabled={uploadingInvoice === invoice.id}
                  onchange={(e) => {
                    const f = (e.currentTarget as HTMLInputElement).files?.[0];
                    if (f) void uploadInvoiceAttachment(invoice.id, f);
                  }}
                />
              </label>
              {#if uploadingInvoice === invoice.id}
                <span class="text-xs text-ink-muted">Envoi…</span>
              {/if}
            </div>
            {#if invoiceNotice}
              <p class="mt-1 text-xs text-ok">{invoiceNotice}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {/if}
</PublicShell>
