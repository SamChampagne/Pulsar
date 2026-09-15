<script lang="ts">
  import DossierButton from '$lib/components/workflows/DossierButton.svelte';
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import LineItemsEditor, { type LineItem } from '$lib/components/crm/LineItemsEditor.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatMoney } from '$lib/format';
  import { PERMISSIONS, validateFulfillmentLogistics } from '@pulsar/shared';
  import {
    PageHeader,
    RecordHeader,
    RecordNav,
    RecordSection,
    Button,
    Badge,
    Card,
    Drawer,
    Skeleton,
    ErrorNotice,
    RelatedEntities,
    type RelatedGroup,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ────────────────────────────────────────────────────────────────────

  type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'INVOICED' | 'CANCELLED';

  interface SalesOrder {
    id: string;
    number: string;
    status: SalesOrderStatus;
    totalAmount: string | number;
    currency: string;
    ownerUserId: string | null;
    notes: string | null;
    company: { id: string; name: string } | null;
    companyId: string;
    customerId: string | null;
    dealId: string | null;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let order = $state<SalesOrder | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');

  let lines = $state<LineItem[]>([]);
  let linesLoading = $state(false);
  let linesError = $state('');

  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.CRM.MANAGE));

  // Status action state
  let transitioning = $state(false);
  let transitionError = $state('');

  // CRM module settings (gates direct invoicing of a fulfilled order)
  let directInvoicing = $state(false);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const isDraft = $derived(order?.status === 'DRAFT');

  // "Lié à" — only ids the already-loaded order carries are linked. The generated
  // customer invoice (customData.salesOrderId on CustomerInvoice) has no cheap
  // lookup-by-salesOrderId endpoint today, so it is skipped here rather than
  // adding a new API surface.
  const relatedGroups = $derived<RelatedGroup[]>(
    order
      ? [
          {
            label: 'Opportunité',
            items: order.dealId
              ? [{ label: 'Opportunité d’origine', href: `/crm/deals/${order.dealId}` }]
              : [],
          },
          {
            label: 'Société',
            items: order.company
              ? [{ label: order.company.name, href: `/crm/companies/${order.company.id}` }]
              : [],
          },
          {
            label: 'Client',
            items: order.customerId
              ? [{ label: 'Client lié', href: `/customers/${order.customerId}` }]
              : [],
          },
        ]
      : [],
  );

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadOrder() {
    const id = page.params.id;
    loading = true;
    error = '';
    notFound = false;
    try {
      const result = await api<SalesOrder>(`/crm/sales-orders/${id}`);
      if (page.params.id !== id) return;
      order = result;
      await loadLines();
    } catch (e) {
      if (page.params.id !== id) return;
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : 'Impossible de charger la commande';
      }
    } finally {
      if (page.params.id === id) loading = false;
    }
  }

  async function loadLines() {
    if (!order) return;
    const id = order.id;
    linesLoading = true;
    linesError = '';
    try {
      const result = await api<LineItem[]>(`/crm/sales-orders/${id}/line-items`);
      if (order?.id === id) lines = result;
    } catch (e) {
      if (order?.id !== id) return;
      linesError = e instanceof ApiError ? e.message : 'Impossible de charger les lignes';
    } finally {
      if (order?.id === id) linesLoading = false;
    }
  }

  async function reloadAll() {
    if (!order) return;
    const id = order.id;
    linesError = '';
    try {
      const [freshOrder, freshLines] = await Promise.all([
        api<SalesOrder>(`/crm/sales-orders/${order.id}`),
        api<LineItem[]>(`/crm/sales-orders/${order.id}/line-items`),
      ]);
      if (order?.id !== id) return;
      order = freshOrder;
      lines = freshLines;
    } catch (e) {
      linesError = 'Données non actualisées. Rechargez les lignes avant de poursuivre.';
    }
  }

  async function loadSettings() {
    try {
      const res = await api<{ values: Record<string, unknown> }>('/modules/crm/settings');
      directInvoicing = res.values?.salesOrderDirectInvoicing === true;
    } catch {
      // non-blocking — leave invoicing hidden if settings can't be read
    }
  }

  // ── Status transitions ────────────────────────────────────────────────────────

  // Buttons for transitions that have endpoints: confirm, fulfill, invoice, cancel
  // DRAFT → CONFIRMED (confirm) | CANCELLED (cancel)
  // CONFIRMED → FULFILLED (fulfill) | CANCELLED (cancel)
  // FULFILLED → INVOICED (invoice) — gated by the salesOrderDirectInvoicing CRM setting
  type TransitionVerb = 'confirm' | 'fulfill' | 'invoice' | 'cancel';

  interface StatusAction {
    verb: TransitionVerb;
    label: string;
    variant: 'primary' | 'secondary' | 'danger';
  }

  function allowedActions(status: SalesOrderStatus): StatusAction[] {
    switch (status) {
      case 'DRAFT':
        return [
          { verb: 'confirm', label: 'Confirmer', variant: 'primary' },
          { verb: 'cancel', label: 'Annuler', variant: 'danger' },
        ];
      case 'CONFIRMED':
        return [
          { verb: 'fulfill', label: 'Marquer exécutée', variant: 'primary' },
          { verb: 'cancel', label: 'Annuler', variant: 'danger' },
        ];
      case 'FULFILLED':
        return directInvoicing ? [{ verb: 'invoice', label: 'Facturer', variant: 'primary' }] : [];
      default:
        return [];
    }
  }

  async function doTransition(verb: TransitionVerb) {
    if (!order || transitioning || !canManage) return;
    const id = order.id;
    if (
      verb === 'cancel' &&
      !(await confirmAction('Annuler cette commande de vente ?', {
        title: 'Annuler la commande',
        confirmLabel: 'Annuler la commande',
      }))
    )
      return;
    if (order?.id !== id || transitioning) return;
    transitioning = true;
    transitionError = '';
    try {
      await api(`/crm/sales-orders/${order.id}/${verb}`, { method: 'POST' });
      await reloadAll();
      if (verb === 'invoice') toast.success('Commande facturée');
    } catch (e) {
      transitionError = e instanceof ApiError ? e.message : 'Erreur lors du changement de statut';
    } finally {
      transitioning = false;
    }
  }

  // ── Fulfillment bridge (Prepare shipment) ─────────────────────────────────────

  interface LocationOption {
    id: string;
    name: string;
    code: string;
  }
  interface TransportOrderLink {
    id: string;
    orderNumber: string;
    status: string;
    sourceFulfillmentKey: string | null;
    originLocation: { id: string; name: string } | null;
    destinationLocation: { id: string; name: string } | null;
  }
  interface FulfillmentContext {
    canPrepareShipment: boolean;
    transportOrders: TransportOrderLink[];
  }

  // Best-effort: this needs transportation.orders.read + crm.read. A CRM-only
  // user simply won't see the shipment panel (noTransportAccess stays true).
  let noTransportAccess = $state(true);
  let fulfillmentError = $state('');
  let fulfillment = $state<FulfillmentContext | null>(null);
  let wizardLocations = $state<LocationOption[]>([]);

  let showWizard = $state(false);
  let wOrigin = $state('');
  let wDest = $state('');
  let wPickupEarly = $state('');
  let wPickupLate = $state('');
  let wDeliveryEarly = $state('');
  let wDeliveryLate = $state('');
  let wMode = $state<'FTL' | 'LTL' | 'PARCEL'>('FTL');
  let wWeight = $state<number | null>(null);
  let wVolume = $state<number | null>(null);
  let wPallets = $state<number | null>(null);
  let wKey = $state('');
  let wNotes = $state('');
  let wSubmitting = $state(false);
  let wError = $state('');
  let lastCreatedTO = $state<{ id: string; orderNumber: string } | null>(null);

  const TO_STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Brouillon',
    CONFIRMED: 'Confirmé',
    PLANNED: 'Planifié',
    IN_EXECUTION: 'En exécution',
    COMPLETED: 'Livré',
    CLOSED: 'Clôturé',
    CANCELLED: 'Annulé',
  };

  async function loadFulfillmentContext() {
    if (!order) return;
    const id = order.id;
    fulfillmentError = '';
    try {
      const result = await api<FulfillmentContext>(
        `/transportation/transport-orders/from-sales-order/${id}/context`,
      );
      if (order?.id !== id) return;
      fulfillment = result;
      noTransportAccess = false;
    } catch (e) {
      if (order?.id !== id) return;
      noTransportAccess = e instanceof ApiError && e.statusCode === 403;
      if (!noTransportAccess)
        fulfillmentError = 'Les expéditions liées sont temporairement indisponibles.';
      fulfillment = null;
    }
  }

  async function openWizard() {
    lastCreatedTO = null;
    wError = '';
    showWizard = true;
    if (wizardLocations.length === 0) {
      try {
        const res = await api<{ items: LocationOption[] }>('/transportation/locations', {
          query: { pageSize: 100 },
        });
        wizardLocations = res.items;
      } catch {
        wError = 'Impossible de charger les lieux. Fermez puis rouvrez le panneau pour réessayer.';
      }
    }
  }

  async function submitPrepareShipment() {
    if (!order || wSubmitting) return;
    // Same contract as the server (source of truth): origin, destination, mode
    // and at least one strictly-positive physical measure. Zeros never satisfy it.
    const check = validateFulfillmentLogistics({
      originLocationId: wOrigin,
      destinationLocationId: wDest,
      mode: wMode,
      totalWeightKg: wWeight,
      totalVolumeM3: wVolume,
      palletCount: wPallets,
    });
    if (!check.ok) {
      const FR: Record<typeof check.code, string> = {
        origin: 'Une origine est requise.',
        destination: 'Une destination est requise.',
        mode: 'Un mode de transport est requis.',
        measure:
          'Au moins une mesure physique (poids, volume ou palettes) supérieure à 0 est requise.',
      };
      wError = FR[check.code];
      return;
    }
    wSubmitting = true;
    wError = '';
    try {
      const body: Record<string, unknown> = {
        originLocationId: wOrigin,
        destinationLocationId: wDest,
        mode: wMode,
      };
      if (wKey.trim()) body.fulfillmentKey = wKey.trim();
      if (wPickupEarly) body.requestedPickupEarly = new Date(wPickupEarly).toISOString();
      if (wPickupLate) body.requestedPickupLate = new Date(wPickupLate).toISOString();
      if (wDeliveryEarly) body.requestedDeliveryEarly = new Date(wDeliveryEarly).toISOString();
      if (wDeliveryLate) body.requestedDeliveryLate = new Date(wDeliveryLate).toISOString();
      if (wWeight != null) body.totalWeightKg = wWeight;
      if (wVolume != null) body.totalVolumeM3 = wVolume;
      if (wPallets != null) body.palletCount = wPallets;
      if (wNotes.trim()) body.notes = wNotes.trim();

      const to = await api<{ id: string; orderNumber: string }>(
        `/transportation/transport-orders/from-sales-order/${order.id}`,
        { method: 'POST', body },
      );
      lastCreatedTO = { id: to.id, orderNumber: to.orderNumber };
      toast.success(`Ordre de transport ${to.orderNumber} créé`);
      showWizard = false;
      // Reset the volatile fields for a possible next shipment.
      wKey = '';
      wNotes = '';
      await loadFulfillmentContext();
    } catch (e) {
      wError = e instanceof ApiError ? e.message : "Impossible de préparer l'expédition";
    } finally {
      wSubmitting = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const STATUS_LABELS: Record<SalesOrderStatus, string> = {
    DRAFT: 'Brouillon',
    CONFIRMED: 'Confirmée',
    FULFILLED: 'Exécutée',
    INVOICED: 'Facturée',
    CANCELLED: 'Annulée',
  };

  const STATUS_TONES: Record<SalesOrderStatus, Tone> = {
    DRAFT: 'neutral',
    CONFIRMED: 'info',
    FULFILLED: 'ok',
    INVOICED: 'info',
    CANCELLED: 'danger',
  };

  function statusLabel(status: SalesOrderStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusTone(status: SalesOrderStatus): Tone {
    return STATUS_TONES[status] ?? 'neutral';
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  $effect(() => {
    const id = page.params.id;
    untrack(() => {
      order = null;
      lines = [];
      void loadOrder();
    });
    void loadSettings();
  });

  $effect(() => {
    if (order) void loadFulfillmentContext();
  });
</script>

{#if loading}
  <PageHeader title="Chargement…" />
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if notFound}
  <PageHeader title="Commande introuvable" />
  <ErrorNotice message="Cette commande n'existe pas ou vous n'y avez pas accès." />
  <div class="mt-4">
    <Button variant="secondary" onclick={() => goto('/crm/sales-orders')}>
      ← Retour aux commandes
    </Button>
  </div>
{:else if error}
  <PageHeader title="Erreur" />
  <ErrorNotice message={error} onretry={loadOrder} />
{:else if order}
  <RecordHeader
    title={order!.number}
    kind="Commande de vente"
    backHref="/crm/sales-orders"
    backLabel="Commandes de vente"
  >
    {#snippet meta()}<Badge tone={statusTone(order!.status)}>{statusLabel(order!.status)}</Badge
      ><span class="font-mono">{formatMoney(order!.totalAmount, order!.currency)}</span
      >{#if order!.company}<a
          href="/crm/companies/{order!.company.id}"
          class="hover:text-ink hover:underline">{order!.company.name}</a
        >{/if}{/snippet}
    {#snippet actions()}<DossierButton
        entityType="SALES_ORDER"
        entityId={order!.id}
      />{#if canManage}{#each allowedActions(order!.status) as action (action.verb)}<Button
            variant={action.variant === 'danger' ? 'ghost' : action.variant}
            loading={transitioning}
            onclick={() => void doTransition(action.verb)}>{action.label}</Button
          >{/each}{/if}{/snippet}
  </RecordHeader>
  <ErrorNotice message={transitionError} />
  <RecordNav
    sections={[
      { id: 'record-lines', label: 'Lignes' },
      ...(!noTransportAccess ? [{ id: 'record-shipping', label: 'Expédition' }] : []),
      { id: 'record-info', label: 'Informations' },
      { id: 'record-related', label: 'Dossiers liés' },
    ]}
  />
  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Left column ── -->
    <div class="space-y-6 lg:col-span-2">
      <RecordSection id="record-lines" label="Lignes">
        {#if order?.status === 'CONFIRMED' && $auth?.tenant.enabledModules.includes('manufacturing') && $auth?.tenant.enabledModules.includes('wms') && $auth?.user.permissions.includes('manufacturing.read') && $auth?.user.permissions.includes('wms.read')}
          <div class="mb-3 rounded-md border border-edge p-3 text-sm">
            <a
              class="font-medium text-accent hover:underline"
              href={`/manufacturing/mrp?salesOrderId=${order.id}`}
              >Planifier les besoins matières de cette commande →</a
            >
            <p class="mt-1 text-xs text-ink-muted">
              Rattachement explicite des lignes aux articles WMS, au site et aux prévisions; aucun
              OF automatique.
            </p>
          </div>
        {/if}
        {#key order!.id}<LineItemsEditor
            endpoint={`/crm/sales-orders/${order!.id}/line-items`}
            {lines}
            currency={order!.currency}
            total={order!.totalAmount}
            editable={canManage && isDraft && !transitioning}
            loading={linesLoading}
            error={linesError}
            onretry={reloadAll}
            onchanged={reloadAll}
          />{/key}
      </RecordSection>
      <!-- Préparer l'expédition (fulfillment bridge) -->
      {#if !noTransportAccess}
        <RecordSection id="record-shipping" label="Expédition"
          ><Card>
            <h2 class="mb-2 text-sm font-semibold text-ink">Expédition</h2>
            <ErrorNotice message={fulfillmentError} onretry={loadFulfillmentContext} />

            {#if order!.status !== 'CONFIRMED' && (!fulfillment || fulfillment.transportOrders.length === 0)}
              <p class="text-xs text-ink-muted">
                {#if order!.status === 'DRAFT'}
                  Confirmez la commande pour pouvoir préparer une expédition.
                {:else}
                  Aucune expédition liée.
                {/if}
              </p>
            {/if}

            {#if !order!.customerId}
              <p
                class="mb-2 rounded-md border border-amber-400/40 bg-amber-50/40 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300"
              >
                Aucun client lié à cette commande. Liez un client (conversion du deal) avant de
                préparer une expédition.
              </p>
            {/if}

            <!-- Linked transport orders ("Lié à" for shipments) -->
            {#if fulfillment && fulfillment.transportOrders.length > 0}
              <div class="mb-3 space-y-1.5">
                {#each fulfillment.transportOrders as to (to.id)}
                  <a
                    href="/transport-orders/{to.id}"
                    class="flex items-center justify-between gap-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs transition-colors hover:border-accent"
                  >
                    <span class="min-w-0">
                      <span class="font-mono text-ink">{to.orderNumber}</span>
                      {#if to.sourceFulfillmentKey && to.sourceFulfillmentKey !== 'primary'}
                        <span class="ml-1 text-ink-faint">· {to.sourceFulfillmentKey}</span>
                      {/if}
                    </span>
                    <Badge
                      tone={to.status === 'CANCELLED'
                        ? 'danger'
                        : to.status === 'COMPLETED' || to.status === 'CLOSED'
                          ? 'ok'
                          : 'info'}
                    >
                      {TO_STATUS_LABELS[to.status] ?? to.status}
                    </Badge>
                  </a>
                {/each}
              </div>
            {/if}

            {#if lastCreatedTO}
              <p
                class="mb-2 rounded-md border border-emerald-400/40 bg-emerald-50/40 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-300"
              >
                Ordre de transport <a
                  class="font-mono underline"
                  href="/transport-orders/{lastCreatedTO.id}">{lastCreatedTO.orderNumber}</a
                > créé.
              </p>
            {/if}

            {#if order!.status === 'CONFIRMED' && order!.customerId && fulfillment?.canPrepareShipment}
              <Button variant="primary" onclick={openWizard}>Préparer l'expédition</Button>
            {/if}
          </Card></RecordSection
        >
      {/if}
    </div>
    <aside class="space-y-5">
      <RecordSection id="record-info" label="Informations">
        <Card>
          <h2 class="mb-3 text-sm font-semibold text-ink">Informations</h2>
          <div class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Statut</div>
              <Badge tone={statusTone(order!.status)}>{statusLabel(order!.status)}</Badge>
            </div>
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Montant total</div>
              <div class="text-base font-semibold text-accent">
                {formatMoney(order!.totalAmount, order!.currency)}
              </div>
            </div>
            {#if order!.company}
              <div>
                <div class="mb-0.5 font-medium text-ink-muted">Société</div>
                <a
                  href="/crm/companies/{order!.company.id}"
                  class="text-ink hover:underline hover:text-accent"
                >
                  {order!.company.name}
                </a>
              </div>
            {/if}
            {#if order!.ownerUserId}
              <div>
                <div class="mb-0.5 font-medium text-ink-muted">Responsable</div>
                <div class="font-mono text-xs text-ink">{order!.ownerUserId.slice(0, 8)}…</div>
              </div>
            {/if}
            {#if order!.notes}
              <div class="min-w-0">
                <div class="mb-0.5 font-medium text-ink-muted">Notes</div>
                <div class="text-ink">{order!.notes}</div>
              </div>
            {/if}
          </div>
        </Card>
      </RecordSection>

      <!-- Lié à -->
      <RecordSection id="record-related" label="Dossiers liés"
        ><Card><RelatedEntities title="Dossiers liés" groups={relatedGroups} /></Card
        ></RecordSection
      >
    </aside>
  </div>

  <!-- Prepare-shipment wizard -->
  <Drawer
    bind:open={showWizard}
    title="Préparer l'expédition"
    width="lg"
    dismissible={!wSubmitting}
  >
    <fieldset disabled={wSubmitting} class="space-y-4">
      <p class="text-sm text-ink-muted">
        Le client est repris de la commande. <strong>Origine, destination, mode</strong> et
        <strong>au moins une mesure physique &gt; 0</strong> (poids, volume ou palettes) sont requis —
        jamais déduits des montants ou des quantités. Les fenêtres horaires sont facultatives.
      </p>
      {#if wError}
        <p
          data-testid="wizard-error"
          class="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger"
        >
          {wError}
        </p>
      {/if}

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label for="w-origin" class="mb-1 block text-xs font-medium text-ink-muted"
            >Origine *</label
          >
          <select
            id="w-origin"
            bind:value={wOrigin}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Sélectionner —</option>
            {#each wizardLocations as l (l.id)}<option value={l.id}>{l.name} ({l.code})</option
              >{/each}
          </select>
        </div>
        <div>
          <label for="w-dest" class="mb-1 block text-xs font-medium text-ink-muted"
            >Destination *</label
          >
          <select
            id="w-dest"
            bind:value={wDest}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Sélectionner —</option>
            {#each wizardLocations as l (l.id)}<option value={l.id}>{l.name} ({l.code})</option
              >{/each}
          </select>
        </div>
        <div>
          <label for="w-pue" class="mb-1 block text-xs font-medium text-ink-muted"
            >Ramassage — au plus tôt</label
          >
          <input
            id="w-pue"
            type="datetime-local"
            bind:value={wPickupEarly}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-pul" class="mb-1 block text-xs font-medium text-ink-muted"
            >Ramassage — au plus tard</label
          >
          <input
            id="w-pul"
            type="datetime-local"
            bind:value={wPickupLate}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-dle" class="mb-1 block text-xs font-medium text-ink-muted"
            >Livraison — au plus tôt</label
          >
          <input
            id="w-dle"
            type="datetime-local"
            bind:value={wDeliveryEarly}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-dll" class="mb-1 block text-xs font-medium text-ink-muted"
            >Livraison — au plus tard</label
          >
          <input
            id="w-dll"
            type="datetime-local"
            bind:value={wDeliveryLate}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-mode" class="mb-1 block text-xs font-medium text-ink-muted">Mode</label>
          <select
            id="w-mode"
            bind:value={wMode}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="FTL">FTL</option>
            <option value="LTL">LTL</option>
            <option value="PARCEL">Colis</option>
          </select>
        </div>
        <div>
          <label for="w-key" class="mb-1 block text-xs font-medium text-ink-muted"
            >Clé d'expédition</label
          >
          <input
            id="w-key"
            type="text"
            placeholder="primary"
            bind:value={wKey}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-wt" class="mb-1 block text-xs font-medium text-ink-muted">Poids (kg)</label>
          <input
            id="w-wt"
            type="number"
            min="0"
            bind:value={wWeight}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-vol" class="mb-1 block text-xs font-medium text-ink-muted"
            >Volume (m³)</label
          >
          <input
            id="w-vol"
            type="number"
            min="0"
            bind:value={wVolume}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
        <div>
          <label for="w-pal" class="mb-1 block text-xs font-medium text-ink-muted">Palettes</label>
          <input
            id="w-pal"
            type="number"
            min="0"
            step="1"
            bind:value={wPallets}
            class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
          />
        </div>
      </div>
      <div>
        <label for="w-notes" class="mb-1 block text-xs font-medium text-ink-muted">Notes</label>
        <textarea
          id="w-notes"
          rows="2"
          bind:value={wNotes}
          class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-1">
        <Button
          variant="secondary"
          disabled={wSubmitting}
          onclick={() => {
            showWizard = false;
          }}>Annuler</Button
        >
        <Button
          variant="primary"
          loading={wSubmitting}
          onclick={() => void submitPrepareShipment()}
        >
          Créer l'ordre de transport
        </Button>
      </div>
    </fieldset>
  </Drawer>
{/if}
