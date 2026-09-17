<script lang="ts">
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { Badge, Button, Card, Field, Input, Select, Textarea } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalView, Template } from '../types';
  import CommentsThread from './CommentsThread.svelte';
  import TemplatesPanel from './TemplatesPanel.svelte';

  let {
    client,
    view,
    onOrderCreated,
  }: {
    client: PortalClient;
    view: PortalView;
    onOrderCreated: () => void | Promise<void>;
  } = $props();

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

  // Per-shipment comment threads (lazy, cached across toggles).
  let commentsOpen = $state<Record<string, boolean>>({});
  let commentCounts = $state<Record<string, number | null>>({});

  const portalModeSuggestion = $derived.by(() => {
    const w = request.totalWeightKg ? Number(request.totalWeightKg) : null;
    const suggested = suggestMode(w);
    return suggested && suggested !== request.mode ? suggested : null;
  });

  const fmtWindow = (early: string | null, late?: string | null) =>
    early ? formatDate(early) + (late ? ' → ' + formatDate(late) : '') : '—';

  function fmt(value: string | null): string {
    return value ? formatDate(value) : '—';
  }

  function toggleComments(shipmentId: string) {
    commentsOpen = { ...commentsOpen, [shipmentId]: !commentsOpen[shipmentId] };
  }

  async function submitRequest(event: SubmitEvent) {
    event.preventDefault();
    requestNotice = '';
    try {
      const created = await client.post<{ orderNumber: string }>('/orders', {
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
      await onOrderCreated();
    } catch (e) {
      requestNotice = e instanceof PortalApiError ? e.message : "Échec de l'envoi de la demande";
    }
  }

  async function saveTemplate() {
    try {
      await client.post('/templates', {
        name: templateNameInput,
        originLocationId: request.originLocationId || undefined,
        destinationLocationId: request.destinationLocationId || undefined,
        mode: request.mode || undefined,
        totalWeightKg: request.totalWeightKg ? Number(request.totalWeightKg) : undefined,
        totalVolumeM3: undefined,
        palletCount: request.palletCount ? Number(request.palletCount) : undefined,
        notes: request.notes || undefined,
      });
      templates = await client.get<Template[]>('/templates');
      templateNameInput = '';
      showTemplateSave = false;
      templateNotice = 'Modèle enregistré';
    } catch (e) {
      templateNotice = e instanceof PortalApiError ? e.message : "Échec de l'enregistrement du modèle";
    }
  }

  // Pre-fill form when template changes
  $effect(() => {
    if (!selectedTemplateId) return;
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    if (tpl.originCode) request.originLocationId = tpl.originCode;
    if (tpl.destinationCode) request.destinationLocationId = tpl.destinationCode;
    if (tpl.mode) request.mode = tpl.mode;
    if (tpl.totalWeightKg != null) request.totalWeightKg = String(tpl.totalWeightKg);
    if (tpl.palletCount != null) request.palletCount = String(tpl.palletCount);
    if (tpl.notes) request.notes = tpl.notes;
  });
</script>

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

      <TemplatesPanel {client} bind:templates bind:selectedTemplateId />

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
                      <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                    </td>
                    <td class="py-1.5 pr-3 text-ink-muted">
                      {shipment.actualDeliveryAt ? `livré ${fmt(shipment.actualDeliveryAt)}` : ''}
                    </td>
                    <td class="py-1.5 text-right">
                      <button
                        type="button"
                        class="text-accent hover:underline"
                        onclick={() => toggleComments(shipment.id)}
                      >
                        Commentaires{#if commentCounts[shipment.id] != null}
                          ({commentCounts[shipment.id]}){/if}
                      </button>
                      {#if shipment.trackingUrl}
                        <a href={shipment.trackingUrl} class="ml-3 text-accent hover:underline"
                          >Suivre</a
                        >
                      {/if}
                    </td>
                  </tr>
                  <CommentsThread
                    {client}
                    shipmentId={shipment.id}
                    open={!!commentsOpen[shipment.id]}
                    bind:count={commentCounts[shipment.id]}
                  />
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
