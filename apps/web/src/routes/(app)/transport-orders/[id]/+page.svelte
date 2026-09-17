<script lang="ts">
  import DossierButton from '$lib/components/workflows/DossierButton.svelte';
  import { untrack } from 'svelte';
  import { confirmAction } from '$lib/stores/confirmation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    Field,
    PageHeader,
    RecordHeader,
    RecordNav,
    RecordSection,
    Drawer,
    toneFor,
    labelFor,
    Skeleton,
    ErrorNotice,
    RelatedEntities,
    StatusTimeline,
    type RelatedGroup,
    type TimelineEntry as StatusEntry,
  } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  import { fmtCustomValue } from '$lib/format';
  import { toast } from '$lib/stores/toast';

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }

  interface WindowWarning {
    shipmentNumber: string;
    field: 'pickup' | 'delivery';
    kind: 'BEFORE_EARLY' | 'AFTER_LATE';
    requested: string;
    planned: string;
  }

  interface OrderDetail {
    id: string;
    orderNumber: string;
    status: string;
    mode: string | null;
    customerReference: string | null;
    requestedPickupEarly: string | null;
    requestedPickupLate: string | null;
    requestedDeliveryEarly: string | null;
    requestedDeliveryLate: string | null;
    totalWeightKg: number | null;
    totalVolumeM3: number | null;
    palletCount: number | null;
    notes: string | null;
    createdAt: string;
    customer: { id: string; code: string; name: string };
    originLocation: { id: string; code: string; name: string; city: string };
    destinationLocation: { id: string; code: string; name: string; city: string };
    shipments: { id: string; shipmentNumber: string; status: string; loadId: string | null }[];
    sourceSalesOrderId?: string | null;
    sourceFulfillmentKey?: string | null;
    sourceSalesOrder?: { id: string; number: string; status: string } | null;
    windowWarnings?: WindowWarning[];
    customData?: Record<string, unknown>;
  }

  const orderId = $derived(page.params.id);

  let order = $state<OrderDetail | null>(null);
  let events = $state<TimelineEvent[]>([]);
  let error = $state('');
  let eventsError = $state(false);
  let busy = $state(false);
  let planError = $state('');
  let fieldsLoading = $state(false);
  let fieldsError = $state('');

  function closePlan() {
    if (busy) return false;
    if (!planDirty) return true;
    void confirmAction('Abandonner la préparation des expéditions ?', {
      title: 'Saisie non enregistrée',
      confirmLabel: 'Abandonner',
    }).then((ok) => {
      if (ok) showPlanForm = false;
    });
    return false;
  }

  // Plan-with-split form
  let showPlanForm = $state(false);
  let splitRows = $state<{ weightKg: number | null; palletCount: number | null }[]>([
    { weightKg: null, palletCount: null },
  ]);

  // Shipment custom fields
  let shipmentFieldDefs = $state<CustomFieldDef[]>([]);
  let shipmentCustomData = $state<Record<string, unknown>>({});
  let orderFieldDefs = $state<CustomFieldDef[]>([]);
  const planDirty = $derived(
    splitRows.length > 1 ||
      splitRows.some((r) => r.weightKg != null || r.palletCount != null) ||
      Object.values(shipmentCustomData).some((v) => v !== '' && v !== false && v != null),
  );

  async function submitPlan(event: SubmitEvent) {
    event.preventDefault();
    if (busy || fieldsLoading || fieldsError || !order) return;
    busy = true;
    planError = '';
    let created = 0;
    const customDataPayload =
      Object.keys(shipmentCustomData).length > 0 ? shipmentCustomData : undefined;
    const rows = splitRows.map((r) => ({
      weightKg: r.weightKg == null ? undefined : Number(r.weightKg),
      palletCount: r.palletCount == null ? undefined : Number(r.palletCount),
      customData: customDataPayload,
    }));
    try {
      if (order?.status === 'PLANNED') {
        // Post-planning re-split: each row appends one shipment.
        for (const row of rows) {
          await api(`/transportation/transport-orders/${orderId}/shipments`, {
            method: 'POST',
            body: row,
          });
          created++;
          splitRows = splitRows.slice(1);
        }
        toast.success(`${rows.length} expédition(s) ajoutée(s)`);
      } else {
        const meaningful = rows.filter(
          (r) =>
            r.weightKg !== undefined || r.palletCount !== undefined || r.customData !== undefined,
        );
        const body = splitRows.length > 1 || meaningful.length > 0 ? { shipments: rows } : {};
        await api(`/transportation/transport-orders/${orderId}/plan`, { method: 'POST', body });
        toast.success(`Ordre planifié · ${rows.length} expédition(s)`);
      }
      showPlanForm = false;
      splitRows = [{ weightKg: null, palletCount: null }];
      shipmentCustomData = {};
      await load();
    } catch (e) {
      planError =
        (created
          ? `${created} expédition(s) créée(s). Seules les lignes restantes sont conservées. `
          : '') +
        (e instanceof ApiError
          ? e.message
          : 'Impossible de planifier les expéditions. Vérifiez le dossier avant de réessayer si la connexion a été interrompue.');
      if (created) await load();
    } finally {
      busy = false;
    }
  }

  async function load() {
    const id = orderId;
    error = '';
    let detail: OrderDetail;
    try {
      [detail, orderFieldDefs] = await Promise.all([
        api<OrderDetail>(`/transportation/transport-orders/${orderId}`),
        api<CustomFieldDef[]>('/transportation/custom-fields', {
          query: { entityType: 'TRANSPORT_ORDER' },
        }).catch(() => [] as CustomFieldDef[]),
      ]);
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Failed to load order — ${String(e)}`;
      return;
    }
    if (orderId !== id) return;
    order = detail;
    eventsError = false;
    try {
      const lists = await Promise.all(
        detail.shipments.map((s) =>
          api<TimelineEvent[]>('/transportation/tracking/events', { query: { shipmentId: s.id } }),
        ),
      );
      if (orderId !== id) return;
      events = lists.flat().sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
    } catch {
      if (orderId !== id) return;
      events = [];
      eventsError = true;
    }
  }

  async function action(name: 'confirm' | 'plan' | 'cancel' | 'close') {
    if (busy) return;
    if (
      name === 'cancel' &&
      !(await confirmAction('Annuler cet ordre de transport ?', {
        title: 'Annuler l’ordre',
        confirmLabel: 'Annuler l’ordre',
      }))
    )
      return;
    busy = true;
    try {
      await api(`/transportation/transport-orders/${orderId}/${name}`, { method: 'POST' });
      toast.success('Ordre de transport mis à jour');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de mettre à jour l’ordre');
    } finally {
      busy = false;
    }
  }

  function fmtDate(value: string | null): string {
    return formatDate(value);
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early ? formatDate(early) + (late ? ' → ' + formatDate(late) : '') : '—';

  function warningText(w: WindowWarning): string {
    const kindLabel = w.kind === 'BEFORE_EARLY' ? 'avant' : 'après';
    const fieldLabel = w.field === 'pickup' ? 'pickup' : 'delivery';
    const bound = w.kind === 'BEFORE_EARLY' ? 'la borne minimale' : 'la fenêtre demandée';
    return `${w.shipmentNumber} — ${fieldLabel} planifié ${kindLabel} ${bound} (demandé ${fmtDate(w.requested)}, planifié ${fmtDate(w.planned)})`;
  }

  async function loadShipmentFields() {
    fieldsLoading = true;
    fieldsError = '';
    try {
      shipmentFieldDefs = await api<CustomFieldDef[]>('/transportation/custom-fields', {
        query: { entityType: 'SHIPMENT' },
      });
    } catch (e) {
      fieldsError = e instanceof ApiError ? e.message : 'Champs personnalisés indisponibles';
    } finally {
      fieldsLoading = false;
    }
  }
  function openPlanForm() {
    if (busy) return;
    splitRows = [{ weightKg: null, palletCount: null }];
    shipmentCustomData = {};
    planError = '';
    showPlanForm = true;
    void loadShipmentFields();
  }

  $effect(() => {
    orderId;
    untrack(() => {
      order = null;
      events = [];
      showPlanForm = false;
      void load();
    });
  });

  // "Lié à" — only ids the page already has are linked (customer, shipments, loads).
  const relatedGroups = $derived<RelatedGroup[]>(
    order
      ? [
          {
            label: 'Client',
            items: [
              {
                label: order.customer.name,
                sublabel: order.customer.code,
                href: `/customers/${order.customer.id}`,
              },
            ],
          },
          {
            label: 'Commande de vente (source)',
            items: order.sourceSalesOrder
              ? [
                  {
                    label: order.sourceSalesOrder.number,
                    sublabel:
                      order.sourceFulfillmentKey && order.sourceFulfillmentKey !== 'primary'
                        ? `Expédition « ${order.sourceFulfillmentKey} »`
                        : 'Expédition principale',
                    href: `/crm/sales-orders/${order.sourceSalesOrder.id}`,
                  },
                ]
              : [],
          },
          {
            label: 'Expéditions',
            items: order.shipments.map((s) => ({
              // No shipment-detail route exists yet — informational only, no href.
              label: s.shipmentNumber,
              sublabel: labelFor(s.status),
              tone: toneFor(s.status),
            })),
          },
          {
            label: 'Chargements',
            items: (() => {
              const byLoad = new Map<string, string[]>();
              for (const s of order.shipments) {
                if (!s.loadId) continue;
                byLoad.set(s.loadId, [...(byLoad.get(s.loadId) ?? []), s.shipmentNumber]);
              }
              return Array.from(byLoad.entries()).map(([loadId, shipmentNumbers]) => ({
                label: `Chargement #${loadId.slice(-6)}`,
                sublabel: shipmentNumbers.join(', '),
                href: `/loads/${loadId}`,
              }));
            })(),
          },
        ]
      : [],
  );

  // Status timeline: no dedicated status-history table for TransportOrder (only
  // createdAt + requested windows are available from the already-loaded record),
  // so we build a small entries array from those rather than inventing a fetch.
  const timelineEntries = $derived<StatusEntry[]>(
    order
      ? [
          { label: 'Commande créée', timestamp: order.createdAt, tone: 'neutral' },
          ...(order.requestedPickupEarly
            ? [
                {
                  label: 'Collecte demandée',
                  timestamp: order.requestedPickupEarly,
                  tone: 'info' as const,
                },
              ]
            : []),
          ...(order.requestedDeliveryEarly
            ? [
                {
                  label: 'Livraison demandée',
                  timestamp: order.requestedDeliveryEarly,
                  tone: 'info' as const,
                },
              ]
            : []),
          {
            label: labelFor(order.status),
            description: 'Statut actuel',
            tone: toneFor(order.status),
          },
        ]
      : [],
  );
</script>

{#if error}
  <RecordHeader
    title="Ordre de transport"
    kind="Transport"
    backHref="/transport-orders"
    backLabel="Ordres de transport"
  />
  <ErrorNotice message={error} onretry={load} />
{:else if order}
  <RecordHeader
    title={order.orderNumber}
    kind="Ordre de transport"
    backHref="/transport-orders"
    backLabel="Ordres de transport"
  >
    {#snippet meta()}<Badge tone={toneFor(order!.status)}>{labelFor(order!.status)}</Badge
      >{#if order!.mode}<Badge tone="info">{order!.mode}</Badge>{/if}<span
        >{order!.originLocation.city} → {order!.destinationLocation.city}</span
      >{/snippet}
    {#snippet actions()}
      <DossierButton entityType="TRANSPORT_ORDER" entityId={order!.id} />
      {#if order!.status === 'DRAFT'}
        <Button
          disabled={busy}
          variant="primary"
          onclick={() => {
            void action('confirm');
          }}>Confirmer</Button
        >
        <Button
          disabled={busy}
          variant="danger"
          onclick={() => {
            void action('cancel');
          }}>Annuler</Button
        >
      {:else if order!.status === 'CONFIRMED'}
        <Button
          disabled={busy}
          variant="primary"
          onclick={() => {
            void openPlanForm();
          }}>Planifier…</Button
        >
        <Button
          disabled={busy}
          variant="danger"
          onclick={() => {
            void action('cancel');
          }}>Annuler</Button
        >
      {:else if order!.status === 'PLANNED'}
        <Button
          disabled={busy}
          variant="secondary"
          onclick={() => {
            void openPlanForm();
          }}>Ajouter une expédition…</Button
        >
      {:else if order!.status === 'COMPLETED'}
        <Button
          disabled={busy}
          variant="primary"
          onclick={() => {
            void action('close');
          }}>Clôturer</Button
        >
      {/if}
    {/snippet}
  </RecordHeader>
  <RecordNav
    sections={[
      { id: 'record-shipments', label: 'Expéditions' },
      { id: 'record-tracking', label: 'Suivi' },
      { id: 'record-info', label: 'Informations' },
      { id: 'record-related', label: 'Dossiers liés' },
    ]}
  />

  {#if order.windowWarnings && order.windowWarnings.length > 0}
    <div class="mb-4 flex flex-col gap-2">
      {#each order.windowWarnings as w (w.shipmentNumber + w.field + w.kind)}
        <div class="rounded-card bg-warn-soft text-warn p-3 text-sm">
          {warningText(w)}
        </div>
      {/each}
    </div>
  {/if}

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Left 2/3: Shipments + Plan form -->
    <div class="flex flex-col gap-4 lg:col-span-2">
      <RecordSection id="record-shipments" label="Expéditions"
        ><Card>
          <h2 class="mb-3 font-semibold text-ink">Expéditions</h2>
          {#if order.shipments.length === 0}
            <p class="text-sm text-ink-muted">
              Aucune expédition. Confirmez puis planifiez l’ordre.
            </p>
          {:else}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                    <th class="pb-2 text-left font-semibold">Expédition</th>
                    <th class="pb-2 text-left font-semibold">Statut</th>
                    <th class="pb-2 text-left font-semibold">Chargement</th>
                  </tr>
                </thead>
                <tbody>
                  {#each order.shipments as shipment (shipment.id)}
                    <tr class="border-b border-edge last:border-0">
                      <td class="py-2 pr-2 font-semibold">{shipment.shipmentNumber}</td>
                      <td class="py-2 pr-2">
                        <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                      </td>
                      <td class="py-2">
                        {#if shipment.loadId}
                          <a href={`/loads/${shipment.loadId}`} class="text-accent hover:underline"
                            >Voir le chargement</a
                          >
                        {:else}
                          <a href="/shipments" class="text-accent hover:underline"
                            >Affecter une expédition</a
                          >
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </Card>
      </RecordSection>
      <RecordSection id="record-tracking" label="Suivi">
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Suivi</h2>
          {#if eventsError}<ErrorNotice
              message="Suivi indisponible. Aucun historique ne peut être confirmé."
              onretry={load}
            />{:else}<TrackingTimeline {events} />{/if}
        </Card></RecordSection
      >
    </div>

    <!-- Right 1/3: Summary + warnings -->
    <div class="flex flex-col gap-4">
      <RecordSection id="record-info" label="Informations">
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Informations</h2>
          <dl class="flex flex-col gap-2 text-sm">
            <div class="flex items-start justify-between gap-2">
              <dt class="text-ink-muted shrink-0">Client</dt>
              <dd class="font-medium text-right">
                {order.customer.name}
                <span class="text-xs text-ink-muted">({order.customer.code})</span>
              </dd>
            </div>
            {#if order.customerReference}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-muted">Référence</dt>
                <dd class="font-medium">{order.customerReference}</dd>
              </div>
            {/if}
            <div class="flex items-start justify-between gap-2">
              <dt class="text-ink-muted shrink-0">Origine</dt>
              <dd class="font-medium text-right">
                {order.originLocation.name}, {order.originLocation.city}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-2">
              <dt class="text-ink-muted shrink-0">Destination</dt>
              <dd class="font-medium text-right">
                {order.destinationLocation.name}, {order.destinationLocation.city}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Fenêtre de collecte</dt>
              <dd class="font-medium">
                {fmtWindow(order.requestedPickupEarly, order.requestedPickupLate)}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Fenêtre de livraison</dt>
              <dd class="font-medium">
                {fmtWindow(order.requestedDeliveryEarly, order.requestedDeliveryLate)}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Mode</dt>
              <dd class="font-medium">{order.mode ?? '—'}</dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Poids</dt>
              <dd class="font-medium">
                {order.totalWeightKg != null ? `${order.totalWeightKg} kg` : '—'}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Volume</dt>
              <dd class="font-medium">
                {order.totalVolumeM3 != null ? `${order.totalVolumeM3} m³` : '—'}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Palettes</dt>
              <dd class="font-medium">{order.palletCount ?? '—'}</dd>
            </div>
            {#if order.notes}
              <div class="flex items-start justify-between gap-2">
                <dt class="text-ink-muted shrink-0">Notes</dt>
                <dd class="font-medium text-right">{order.notes}</dd>
              </div>
            {/if}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Création</dt>
              <dd class="font-medium">{fmtDate(order.createdAt)}</dd>
            </div>
            {#if order.customData && orderFieldDefs.length > 0}
              {#each orderFieldDefs as d (d.key)}
                {#if order.customData[d.key] !== undefined && order.customData[d.key] !== null}
                  <div class="flex items-center justify-between gap-2">
                    <dt class="text-ink-muted">{d.label}</dt>
                    <dd class="font-medium">{fmtCustomValue(order.customData[d.key], d.type)}</dd>
                  </div>
                {/if}
              {/each}
            {/if}
          </dl>
        </Card>

        <!-- Historique (créée / fenêtres demandées / statut actuel) -->
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Historique</h2>
          <StatusTimeline entries={timelineEntries} />
        </Card>
      </RecordSection>
      <!-- Lié à -->
      <RecordSection id="record-related" label="Dossiers liés"
        ><Card><RelatedEntities title="Dossiers liés" groups={relatedGroups} /></Card
        ></RecordSection
      >
    </div>
  </div>
  <Drawer
    bind:open={showPlanForm}
    title={order!.status === 'PLANNED' ? 'Ajouter des expéditions' : 'Planifier les expéditions'}
    width="lg"
    dismissible={!busy}
    onbeforeclose={closePlan}
  >
    <p class="mb-4 text-sm text-ink-muted">
      Une expédition par ligne. Une seule ligne vide reprend les quantités de l’ordre. Les champs
      personnalisés s’appliquent à chaque ligne.
    </p>
    <ErrorNotice message={planError} />
    <ErrorNotice message={fieldsError} onretry={loadShipmentFields} />
    {#if fieldsLoading}<Skeleton rows={2} />{/if}
    <form onsubmit={submitPlan}>
      <fieldset disabled={busy || fieldsLoading || !!fieldsError}>
        <div class="flex flex-col gap-2">
          {#each splitRows as row, index (index)}
            <div class="grid grid-cols-[32px_1fr_1fr_40px] items-center gap-2">
              <span class="text-xs text-ink-muted">#{index + 1}</span>
              <Field label="Poids (kg)">
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Poids (kg)"
                  bind:value={row.weightKg}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </Field>
              <Field label="Palettes">
                <input
                  type="number"
                  min="0"
                  placeholder="Palettes"
                  bind:value={row.palletCount}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </Field>
              {#if splitRows.length > 1}
                <div class="mt-5">
                  <Button
                    variant="ghost"
                    aria-label={`Supprimer la ligne ${index + 1}`}
                    onclick={() => {
                      splitRows = splitRows.filter((_, i) => i !== index);
                    }}>✕</Button
                  >
                </div>
              {:else}
                <span></span>
              {/if}
            </div>
          {/each}
        </div>
        {#if shipmentFieldDefs.length > 0}
          <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            <CustomFieldInputs definitions={shipmentFieldDefs} bind:data={shipmentCustomData} />
          </div>
        {/if}
        <div class="mt-3 flex gap-2">
          <Button
            variant="secondary"
            type="button"
            onclick={() => {
              splitRows = [...splitRows, { weightKg: null, palletCount: null }];
            }}
          >
            Ajouter une ligne
          </Button>
          <Button variant="primary" type="submit">
            {order.status === 'PLANNED' ? 'Ajouter' : 'Planifier'}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onclick={() => {
              if (closePlan()) showPlanForm = false;
            }}>Annuler</Button
          >
        </div>
      </fieldset>
    </form>
  </Drawer>
{:else}
  <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
{/if}
