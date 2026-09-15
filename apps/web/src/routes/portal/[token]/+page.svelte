<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { page } from '$app/state';
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Button, Card, Field, Input, Select, Textarea } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDate } from '$lib/format';

  interface PortalView {
    shipper: string;
    customer: string;
    branding: { logoUrl?: string; accentColor?: string };
    locations: { code: string; name: string; city: string }[];
    orders: {
      id: string;
      orderNumber: string;
      customerReference: string | null;
      status: string;
      requestedPickupEarly: string | null;
      requestedPickupLate: string | null;
      requestedDeliveryEarly: string | null;
      requestedDeliveryLate: string | null;
      originLocation: { city: string; state: string | null };
      destinationLocation: { city: string; state: string | null };
      shipments: {
        id: string;
        shipmentNumber: string;
        status: string;
        actualDeliveryAt: string | null;
        trackingUrl: string | null;
      }[];
    }[];
  }

  interface Template {
    id: string;
    name: string;
    originLocationId: string | null;
    destinationLocationId: string | null;
    mode: string | null;
    totalWeightKg: number | null;
    totalVolumeM3: number | null;
    palletCount: number | null;
    notes: string | null;
  }

  interface Invoice {
    invoiceNumber: string;
    status: string;
    currency: string;
    totalAmount: number;
    sentAt: string | null;
    paidAt: string | null;
  }

  interface PortalDocument {
    id: string;
    fileName: string;
    mimeType: string;
    createdAt: string;
  }

  interface ShipmentComment {
    id: string;
    authorType: 'CUSTOMER' | 'STAFF';
    authorName: string;
    body: string;
    createdAt: string;
  }

  const token = $derived(page.params.token);

  let view = $state<PortalView | null>(null);
  let error = $state('');

  // Tab navigation
  let activeTab = $state<'orders' | 'invoices' | 'documents' | 'change'>('orders');

  // Orders / request
  let showRequest = $state(false);
  let requestNotice = $state('');
  let request = $state({
    originLocationId: '',
    destinationLocationId: '',
    customerReference: '',
    requestedPickupEarly: '',
    requestedPickupLate: '',
    requestedDeliveryEarly: '',
    requestedDeliveryLate: '',
    palletCount: '',
    totalWeightKg: '',
    notes: '',
    mode: TransportMode.FTL as string,
  });

  // Templates
  let templates = $state<Template[]>([]);
  let selectedTemplateId = $state('');
  let showTemplateSave = $state(false);
  let templateNameInput = $state('');
  let templateNotice = $state('');

  // Invoices (lazy)
  let invoices = $state<Invoice[]>([]);
  let invoicesLoaded = $state(false);
  let invoicesLoading = $state(false);

  // Documents
  let shipmentDocs = $state<Record<string, PortalDocument[]>>({});
  let shipmentDocsOpen = $state<Record<string, boolean>>({});
  let shipmentDocsLoading = $state<Record<string, boolean>>({});

  // Comments (lazy, per shipment)
  let shipmentComments = $state<Record<string, ShipmentComment[]>>({});
  let shipmentCommentsOpen = $state<Record<string, boolean>>({});
  let shipmentCommentsLoading = $state<Record<string, boolean>>({});
  let commentDraft = $state<Record<string, string>>({});
  let commentSending = $state<Record<string, boolean>>({});
  let commentNotice = $state<Record<string, string>>({});
  let commentError = $state<Record<string, string>>({});

  // Change request
  let changeKind = $state('');
  let changeOrderId = $state('');
  let changeShipmentId = $state('');
  let changeNote = $state('');
  let changeNotice = $state('');
  let changeSending = $state(false);
  let changeError = $state('');

  const portalModeSuggestion = $derived.by(() => {
    const w = request.totalWeightKg ? Number(request.totalWeightKg) : null;
    const suggested = suggestMode(w);
    return suggested && suggested !== request.mode ? suggested : null;
  });

  const selectedOrderForChange = $derived(view?.orders.find((o) => o.id === changeOrderId) ?? null);

  const fmtWindow = (early: string | null, late?: string | null) =>
    early ? formatDate(early) + (late ? ' → ' + formatDate(late) : '') : '—';

  function fmt(value: string | null): string {
    return value ? formatDate(value) : '—';
  }

  async function load() {
    try {
      view = await api<PortalView>(`/public/portal/${token}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'This link is invalid';
    }
  }

  async function loadTemplates() {
    try {
      templates = await api<Template[]>(`/public/portal/${token}/templates`);
    } catch {
      templates = [];
    }
  }

  async function loadInvoices() {
    if (invoicesLoaded || invoicesLoading) return;
    invoicesLoading = true;
    try {
      invoices = await api<Invoice[]>(`/public/portal/${token}/invoices`);
      invoicesLoaded = true;
    } catch {
      invoices = [];
    } finally {
      invoicesLoading = false;
    }
  }

  async function loadShipmentDocs(shipmentId: string) {
    if (shipmentDocsLoading[shipmentId]) return;
    shipmentDocsLoading = { ...shipmentDocsLoading, [shipmentId]: true };
    try {
      const docs = await api<PortalDocument[]>(
        `/public/portal/${token}/shipments/${shipmentId}/documents`,
      );
      shipmentDocs = { ...shipmentDocs, [shipmentId]: docs };
    } catch {
      shipmentDocs = { ...shipmentDocs, [shipmentId]: [] };
    } finally {
      shipmentDocsLoading = { ...shipmentDocsLoading, [shipmentId]: false };
    }
  }

  function toggleShipmentDocs(shipmentId: string) {
    const isOpen = shipmentDocsOpen[shipmentId];
    shipmentDocsOpen = { ...shipmentDocsOpen, [shipmentId]: !isOpen };
    if (!isOpen && !(shipmentId in shipmentDocs)) {
      void loadShipmentDocs(shipmentId);
    }
  }

  async function downloadDoc(doc: PortalDocument) {
    const resp = await fetch(`/api/v1/public/portal/${token}/documents/${doc.id}/download`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadShipmentComments(shipmentId: string) {
    if (shipmentCommentsLoading[shipmentId]) return;
    shipmentCommentsLoading = { ...shipmentCommentsLoading, [shipmentId]: true };
    try {
      const comments = await api<ShipmentComment[]>(
        `/public/portal/${token}/shipments/${shipmentId}/comments`,
      );
      shipmentComments = { ...shipmentComments, [shipmentId]: comments };
    } catch {
      shipmentComments = { ...shipmentComments, [shipmentId]: [] };
    } finally {
      shipmentCommentsLoading = { ...shipmentCommentsLoading, [shipmentId]: false };
    }
  }

  function toggleShipmentComments(shipmentId: string) {
    const isOpen = shipmentCommentsOpen[shipmentId];
    shipmentCommentsOpen = { ...shipmentCommentsOpen, [shipmentId]: !isOpen };
    if (!isOpen && !(shipmentId in shipmentComments)) {
      void loadShipmentComments(shipmentId);
    }
  }

  async function submitComment(shipmentId: string) {
    const body = (commentDraft[shipmentId] ?? '').trim();
    if (!body) return;
    commentNotice = { ...commentNotice, [shipmentId]: '' };
    commentError = { ...commentError, [shipmentId]: '' };
    commentSending = { ...commentSending, [shipmentId]: true };
    try {
      await api(`/public/portal/${token}/shipments/${shipmentId}/comments`, {
        method: 'POST',
        body: { body },
      });
      commentDraft = { ...commentDraft, [shipmentId]: '' };
      commentNotice = { ...commentNotice, [shipmentId]: 'Commentaire envoyé.' };
      await loadShipmentComments(shipmentId);
    } catch (e) {
      commentError = {
        ...commentError,
        [shipmentId]: e instanceof ApiError ? e.message : "Échec de l'envoi",
      };
    } finally {
      commentSending = { ...commentSending, [shipmentId]: false };
    }
  }

  async function submitRequest(event: SubmitEvent) {
    event.preventDefault();
    requestNotice = '';
    try {
      const created = await api<{ orderNumber: string }>(`/public/portal/${token}/orders`, {
        method: 'POST',
        body: {
          originLocationId: request.originLocationId,
          destinationLocationId: request.destinationLocationId,
          customerReference: request.customerReference || undefined,
          requestedPickupEarly: request.requestedPickupEarly
            ? new Date(request.requestedPickupEarly).toISOString()
            : undefined,
          requestedPickupLate: request.requestedPickupLate
            ? new Date(request.requestedPickupLate).toISOString()
            : undefined,
          requestedDeliveryEarly: request.requestedDeliveryEarly
            ? new Date(request.requestedDeliveryEarly).toISOString()
            : undefined,
          requestedDeliveryLate: request.requestedDeliveryLate
            ? new Date(request.requestedDeliveryLate).toISOString()
            : undefined,
          palletCount: request.palletCount ? Number(request.palletCount) : undefined,
          totalWeightKg: request.totalWeightKg ? Number(request.totalWeightKg) : undefined,
          notes: request.notes || undefined,
          mode: request.mode || undefined,
          templateId: selectedTemplateId || undefined,
        },
      });
      requestNotice = `Demande envoyée — commande ${created.orderNumber} en attente de confirmation.`;
      showRequest = false;
      selectedTemplateId = '';
      request = {
        originLocationId: '',
        destinationLocationId: '',
        customerReference: '',
        requestedPickupEarly: '',
        requestedPickupLate: '',
        requestedDeliveryEarly: '',
        requestedDeliveryLate: '',
        palletCount: '',
        totalWeightKg: '',
        notes: '',
        mode: TransportMode.FTL,
      };
      await load();
    } catch (e) {
      requestNotice = e instanceof ApiError ? e.message : "Échec de l'envoi de la demande";
    }
  }

  async function saveTemplate() {
    try {
      await api(`/public/portal/${token}/templates`, {
        method: 'POST',
        body: {
          name: templateNameInput,
          originLocationId: request.originLocationId || undefined,
          destinationLocationId: request.destinationLocationId || undefined,
          mode: request.mode || undefined,
          totalWeightKg: request.totalWeightKg ? Number(request.totalWeightKg) : undefined,
          totalVolumeM3: undefined,
          palletCount: request.palletCount ? Number(request.palletCount) : undefined,
          notes: request.notes || undefined,
        },
      });
      await loadTemplates();
      templateNameInput = '';
      showTemplateSave = false;
      templateNotice = 'Modèle enregistré';
    } catch (e) {
      templateNotice = e instanceof ApiError ? e.message : "Échec de l'enregistrement du modèle";
    }
  }

  async function deleteTemplate(tpl: Template) {
    if (!(await confirmAction('Supprimer ce modèle ?'))) return;
    try {
      await api(`/public/portal/${token}/templates/${tpl.id}`, { method: 'DELETE' });
      await loadTemplates();
    } catch {
      // ignore
    }
  }

  async function submitChange(event: SubmitEvent) {
    event.preventDefault();
    changeNotice = '';
    changeError = '';
    changeSending = true;
    try {
      await api(`/public/portal/${token}/change-requests`, {
        method: 'POST',
        body: {
          kind: changeKind,
          note: changeNote,
          orderId: changeOrderId || undefined,
          shipmentId: changeShipmentId || undefined,
        },
      });
      changeNotice = 'Demande envoyée.';
      changeKind = '';
      changeOrderId = '';
      changeShipmentId = '';
      changeNote = '';
    } catch (e) {
      changeError = e instanceof ApiError ? e.message : "Échec de l'envoi";
    } finally {
      changeSending = false;
    }
  }

  // Pre-fill form when template changes
  $effect(() => {
    if (!selectedTemplateId) return;
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    if (tpl.originLocationId) request.originLocationId = tpl.originLocationId;
    if (tpl.destinationLocationId) request.destinationLocationId = tpl.destinationLocationId;
    if (tpl.mode) request.mode = tpl.mode;
    if (tpl.totalWeightKg != null) request.totalWeightKg = String(tpl.totalWeightKg);
    if (tpl.palletCount != null) request.palletCount = String(tpl.palletCount);
    if (tpl.notes) request.notes = tpl.notes;
  });

  // Lazy invoice load
  $effect(() => {
    if (activeTab === 'invoices' && !invoicesLoaded) {
      void loadInvoices();
    }
  });

  $effect(() => {
    if (token) {
      void load();
      void loadTemplates();
    }
  });
</script>

<PublicShell maxWidth="max-w-3xl" brand={view?.branding}>
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if view}
    <p class="mb-1 text-sm text-ink-muted">Portail client · {view.shipper}</p>
    <div class="mb-4 flex items-center justify-between gap-4">
      <h1 class="text-xl font-bold text-ink">{view.customer}</h1>
    </div>

    <!-- Tab bar -->
    <div class="mb-6 overflow-x-auto border-b border-edge">
      <div class="flex w-max gap-4">
        {#each [['orders', 'Commandes'], ['invoices', 'Factures'], ['documents', 'Documents'], ['change', 'Changement']] as [tab, label] (tab)}
          <button
            type="button"
            class={`shrink-0 pb-2 text-sm whitespace-nowrap transition-colors ${activeTab === tab ? 'border-b-2 border-accent font-semibold text-accent' : 'text-ink-muted hover:text-ink'}`}
            onclick={() => {
              activeTab = tab as typeof activeTab;
            }}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Tab: Commandes -->
    {#if activeTab === 'orders'}
      <div class="mb-4 flex items-center justify-between gap-4">
        <span></span>
        <Button
          onclick={() => {
            showRequest = !showRequest;
          }}>Demande de transport</Button
        >
      </div>

      {#if requestNotice}
        <p class="mb-4 text-sm text-ok">{requestNotice}</p>
      {/if}

      {#if showRequest}
        <div class="mb-4">
          <Card>
            <h2 class="mb-4 text-base font-semibold text-ink">Nouvelle demande de transport</h2>

            <!-- Template selector -->
            {#if templates.length > 0}
              <div class="mb-4">
                <Field label="Utiliser un modèle">
                  <Select bind:value={selectedTemplateId}>
                    <option value="">— Aucun modèle —</option>
                    {#each templates as tpl (tpl.id)}
                      <option value={tpl.id}>{tpl.name}</option>
                    {/each}
                  </Select>
                </Field>
                <!-- Template delete list -->
                <div class="mt-2 flex flex-wrap gap-2">
                  {#each templates as tpl (tpl.id)}
                    <span
                      class="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-ink-muted"
                    >
                      {tpl.name}
                      <button
                        type="button"
                        class="text-danger hover:text-danger ml-1"
                        onclick={() => deleteTemplate(tpl)}
                        aria-label="Supprimer {tpl.name}">×</button
                      >
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            <form onsubmit={submitRequest} class="flex flex-col gap-4">
              <!-- Route section -->
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Origine">
                  <Select bind:value={request.originLocationId} required>
                    <option value="" disabled>Sélectionner…</option>
                    {#each view.locations as l (l.code)}
                      <option value={l.code}>{l.name} ({l.city})</option>
                    {/each}
                  </Select>
                </Field>
                <Field label="Destination">
                  <Select bind:value={request.destinationLocationId} required>
                    <option value="" disabled>Sélectionner…</option>
                    {#each view.locations as l (l.code)}
                      <option value={l.code}>{l.name} ({l.city})</option>
                    {/each}
                  </Select>
                </Field>
              </div>

              <!-- Reference + dates section -->
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Votre référence">
                  <Input bind:value={request.customerReference} placeholder="PO-12345" />
                </Field>
                <Field label="Enlèvement du">
                  <Input type="date" bind:value={request.requestedPickupEarly} />
                </Field>
                <Field label="Enlèvement au (optionnel)">
                  <Input type="date" bind:value={request.requestedPickupLate} />
                </Field>
                <Field label="Livraison du">
                  <Input type="date" bind:value={request.requestedDeliveryEarly} />
                </Field>
                <Field label="Livraison au (optionnel)">
                  <Input type="date" bind:value={request.requestedDeliveryLate} />
                </Field>
              </div>

              <!-- Load section -->
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Palettes">
                  <Input type="number" min="0" bind:value={request.palletCount} />
                </Field>
                <Field label="Poids (kg)">
                  <Input type="number" min="0" bind:value={request.totalWeightKg} />
                </Field>
                <div>
                  <Field label="Mode">
                    <Select bind:value={request.mode}>
                      {#each Object.values(TransportMode) as m (m)}
                        <option value={m}>{m}</option>
                      {/each}
                    </Select>
                  </Field>
                  {#if portalModeSuggestion}
                    <p class="mt-1 text-xs text-ink-muted">
                      Suggéré : {portalModeSuggestion} selon le poids
                    </p>
                  {/if}
                </div>
              </div>

              <Field label="Notes">
                <Textarea bind:value={request.notes} rows={2} />
              </Field>

              <!-- Save as template -->
              <div>
                <button
                  type="button"
                  class="text-xs text-accent hover:underline"
                  onclick={() => {
                    showTemplateSave = !showTemplateSave;
                  }}
                >
                  Enregistrer comme modèle
                </button>
                {#if templateNotice}
                  <span class="ml-2 text-xs text-ok">{templateNotice}</span>
                {/if}
                {#if showTemplateSave}
                  <div class="mt-2 flex items-center gap-2">
                    <Input bind:value={templateNameInput} placeholder="Nom du modèle" />
                    <Button type="button" onclick={saveTemplate} disabled={!templateNameInput}>
                      Sauvegarder
                    </Button>
                  </div>
                {/if}
              </div>

              <div class="flex justify-end">
                <Button type="submit">Envoyer la demande</Button>
              </div>
            </form>
          </Card>
        </div>
      {/if}

      <!-- Orders list -->
      {#if view.orders.length === 0}
        <p class="mt-4 text-sm text-ink-muted">Aucune commande pour le moment.</p>
      {:else}
        <div class="mt-2 flex flex-col divide-y divide-edge">
          {#each view.orders as order (order.orderNumber)}
            <div class="py-4">
              <div class="mb-1 flex flex-wrap items-center gap-2">
                <strong class="text-ink">{order.orderNumber}</strong>
                {#if order.customerReference}
                  <span class="text-sm text-ink-muted">réf {order.customerReference}</span>
                {/if}
                <Badge tone={toneFor(order.status)}>{labelFor(order.status)}</Badge>
              </div>
              <p class="mb-2 text-sm text-ink-muted">
                {order.originLocation.city}{order.originLocation.state
                  ? `, ${order.originLocation.state}`
                  : ''}
                → {order.destinationLocation.city}{order.destinationLocation.state
                  ? `, ${order.destinationLocation.state}`
                  : ''}
                · enlèvement {fmtWindow(order.requestedPickupEarly, order.requestedPickupLate)}
                · livraison {fmtWindow(order.requestedDeliveryEarly, order.requestedDeliveryLate)}
              </p>
              {#if order.shipments.length > 0}
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <tbody>
                      {#each order.shipments as shipment (shipment.shipmentNumber)}
                        <tr class="border-b border-edge last:border-0">
                          <td class="py-1.5 pr-3 text-ink">{shipment.shipmentNumber}</td>
                          <td class="py-1.5 pr-3">
                            <Badge tone={toneFor(shipment.status)}
                              >{labelFor(shipment.status)}</Badge
                            >
                          </td>
                          <td class="py-1.5 pr-3 text-ink-muted">
                            {shipment.actualDeliveryAt
                              ? `livré ${fmt(shipment.actualDeliveryAt)}`
                              : ''}
                          </td>
                          <td class="py-1.5 text-right">
                            <button
                              type="button"
                              class="text-accent hover:underline"
                              onclick={() => toggleShipmentComments(shipment.id)}
                            >
                              Commentaires{#if shipmentComments[shipment.id]}
                                ({shipmentComments[shipment.id].length}){/if}
                            </button>
                            {#if shipment.trackingUrl}
                              <a
                                href={shipment.trackingUrl}
                                class="ml-3 text-accent hover:underline">Suivre</a
                              >
                            {/if}
                          </td>
                        </tr>
                        {#if shipmentCommentsOpen[shipment.id]}
                          <tr class="border-b border-edge last:border-0">
                            <td colspan="4" class="py-2">
                              {#if shipmentCommentsLoading[shipment.id]}
                                <p class="text-xs text-ink-muted">Chargement…</p>
                              {:else}
                                {#if !shipmentComments[shipment.id] || shipmentComments[shipment.id].length === 0}
                                  <p class="text-xs text-ink-muted">
                                    Aucun commentaire pour le moment.
                                  </p>
                                {:else}
                                  <ul class="mb-3 flex flex-col gap-2">
                                    {#each shipmentComments[shipment.id] as comment (comment.id)}
                                      <li class="rounded bg-surface-muted px-3 py-2">
                                        <div class="mb-1 flex items-center gap-2">
                                          <span class="text-sm font-semibold text-ink"
                                            >{comment.authorName}</span
                                          >
                                          <Badge
                                            tone={comment.authorType === 'STAFF'
                                              ? 'info'
                                              : 'neutral'}
                                          >
                                            {comment.authorType === 'STAFF' ? 'Équipe' : 'Client'}
                                          </Badge>
                                          <span class="text-xs text-ink-faint"
                                            >{formatDate(comment.createdAt)}</span
                                          >
                                        </div>
                                        <p class="whitespace-pre-wrap text-sm text-ink">
                                          {comment.body}
                                        </p>
                                      </li>
                                    {/each}
                                  </ul>
                                {/if}

                                {#if commentNotice[shipment.id]}
                                  <p class="mb-2 text-sm text-ok">{commentNotice[shipment.id]}</p>
                                {/if}
                                {#if commentError[shipment.id]}
                                  <p class="mb-2 text-sm text-danger">
                                    {commentError[shipment.id]}
                                  </p>
                                {/if}

                                <div class="flex flex-col gap-2">
                                  <Textarea
                                    bind:value={commentDraft[shipment.id]}
                                    rows={2}
                                    placeholder="Écrire un commentaire…"
                                  />
                                  <div class="flex justify-end">
                                    <Button
                                      type="button"
                                      loading={commentSending[shipment.id]}
                                      disabled={!(commentDraft[shipment.id] ?? '').trim()}
                                      onclick={() => submitComment(shipment.id)}
                                    >
                                      Envoyer
                                    </Button>
                                  </div>
                                </div>
                              {/if}
                            </td>
                          </tr>
                        {/if}
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- Tab: Factures -->
    {#if activeTab === 'invoices'}
      {#if invoicesLoading}
        <p class="text-sm text-ink-muted">Chargement…</p>
      {:else if invoicesLoaded && invoices.length === 0}
        <p class="text-sm text-ink-muted">Aucune facture.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-edge text-left text-xs text-ink-muted">
                <th class="pb-2 pr-4">Numéro</th>
                <th class="pb-2 pr-4">Statut</th>
                <th class="pb-2 pr-4">Montant</th>
                <th class="pb-2 pr-4">Envoyée</th>
                <th class="pb-2">Payée</th>
              </tr>
            </thead>
            <tbody>
              {#each invoices as invoice (invoice.invoiceNumber)}
                <tr class="border-b border-edge last:border-0">
                  <td class="py-2 pr-4 font-mono text-ink">{invoice.invoiceNumber}</td>
                  <td class="py-2 pr-4">
                    <Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge>
                  </td>
                  <td class="py-2 pr-4 text-ink"
                    >{invoice.currency} {invoice.totalAmount.toFixed(2)}</td
                  >
                  <td class="py-2 pr-4 text-ink-muted"
                    >{invoice.sentAt ? formatDate(invoice.sentAt) : '—'}</td
                  >
                  <td class="py-2 text-ink-muted"
                    >{invoice.paidAt ? formatDate(invoice.paidAt) : '—'}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

    <!-- Tab: Documents -->
    {#if activeTab === 'documents'}
      {#if view.orders.length === 0}
        <p class="text-sm text-ink-muted">Aucune commande.</p>
      {:else}
        <div class="flex flex-col divide-y divide-edge">
          {#each view.orders as order (order.orderNumber)}
            <div class="py-4">
              <p class="mb-2 font-semibold text-ink">{order.orderNumber}</p>
              {#if order.shipments.length === 0}
                <p class="text-xs text-ink-muted">Aucun envoi.</p>
              {:else}
                {#each order.shipments as shipment (shipment.id)}
                  <div class="mb-2">
                    <button
                      type="button"
                      class="text-sm text-accent hover:underline"
                      onclick={() => toggleShipmentDocs(shipment.id)}
                    >
                      {shipment.shipmentNumber} — Documents
                      {#if shipmentDocs[shipment.id]}({shipmentDocs[shipment.id].length}){/if}
                    </button>
                    {#if shipmentDocsOpen[shipment.id]}
                      {#if shipmentDocsLoading[shipment.id]}
                        <p class="mt-1 text-xs text-ink-muted">Chargement…</p>
                      {:else if !shipmentDocs[shipment.id] || shipmentDocs[shipment.id].length === 0}
                        <p class="mt-1 text-xs text-ink-muted">Aucun document.</p>
                      {:else}
                        <ul class="mt-1 space-y-1">
                          {#each shipmentDocs[shipment.id] as doc (doc.id)}
                            <li class="flex items-center gap-2 text-sm">
                              <span class="text-ink">{doc.fileName}</span>
                              <button
                                type="button"
                                class="text-xs text-accent hover:underline"
                                onclick={() => downloadDoc(doc)}
                              >
                                Télécharger
                              </button>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- Tab: Changement -->
    {#if activeTab === 'change'}
      <form onsubmit={submitChange} class="flex flex-col gap-4">
        {#if changeNotice}
          <p class="text-sm text-ok">{changeNotice}</p>
        {/if}
        {#if changeError}
          <p class="text-sm text-danger">{changeError}</p>
        {/if}
        <Field label="Type de demande">
          <Select bind:value={changeKind} required>
            <option value="" disabled>Sélectionner…</option>
            <option value="DATE">DATE</option>
            <option value="ADDRESS">ADDRESS</option>
            <option value="CANCEL">CANCEL</option>
            <option value="OTHER">OTHER</option>
          </Select>
        </Field>
        <Field label="Commande (optionnel)">
          <Select bind:value={changeOrderId}>
            <option value="">— Toutes —</option>
            {#each view.orders as order (order.id)}
              <option value={order.id}>{order.orderNumber}</option>
            {/each}
          </Select>
        </Field>
        {#if selectedOrderForChange && selectedOrderForChange.shipments.length > 0}
          <Field label="Envoi (optionnel)">
            <Select bind:value={changeShipmentId}>
              <option value="">— Tous —</option>
              {#each selectedOrderForChange.shipments as shipment (shipment.id)}
                <option value={shipment.id}>{shipment.shipmentNumber}</option>
              {/each}
            </Select>
          </Field>
        {/if}
        <Field label="Note">
          <Textarea
            bind:value={changeNote}
            rows={3}
            placeholder="Décrivez le changement souhaité…"
          />
        </Field>
        <div class="flex justify-end">
          <Button type="submit" loading={changeSending} disabled={!changeKind || !changeNote}>
            Envoyer
          </Button>
        </div>
      </form>
    {/if}

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {/if}
</PublicShell>
