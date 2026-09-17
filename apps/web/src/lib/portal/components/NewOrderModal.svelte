<!--
  « Nouvelle demande de transport » — the portal's order-creation form, lifted
  out of `OrdersPanel` so both doors (session workspace and capability link)
  post the exact same payload through the one `PortalClient`.

  Origin/destination use `ReferenceSelect`, not `EntityPicker`: the picker is
  hard-wired to the tenant `api()` client (staff bearer + redirect to `/login`
  on 401) and requires an `endpoint`, neither of which exists on the portal
  plane. The customer's locations already travel in `view.locations`, so the
  closed-vocabulary control is both correct and one round-trip cheaper.
-->
<script lang="ts">
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import {
    Button,
    Field,
    Input,
    Modal,
    ReferenceSelect,
    Select,
    Textarea,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalView, Template } from '../types';
  import TemplatesPanel from './TemplatesPanel.svelte';

  let {
    client,
    view,
    open = $bindable(false),
    oncreated = undefined,
  }: {
    client: PortalClient;
    view: PortalView;
    open?: boolean;
    /** Called with the created order number once the API accepted the request. */
    oncreated?: ((orderNumber: string) => void | Promise<void>) | undefined;
  } = $props();

  const blank = () => ({
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

  let request = $state(blank());
  let sending = $state(false);
  let error = $state('');

  // Templates
  let templates = $state<Template[]>([]);
  let selectedTemplateId = $state('');
  let showTemplateSave = $state(false);
  let templateNameInput = $state('');
  let templateNotice = $state('');

  const locationOptions = $derived(
    view.locations.map((l) => ({ value: l.code, label: `${l.name} (${l.city})` })),
  );

  const modeOptions = Object.values(TransportMode).map((m) => ({ value: m, label: m }));

  const modeSuggestion = $derived.by(() => {
    const weight = request.totalWeightKg ? Number(request.totalWeightKg) : null;
    const suggested = suggestMode(weight);
    return suggested && suggested !== request.mode ? suggested : null;
  });

  function reset() {
    request = blank();
    selectedTemplateId = '';
    showTemplateSave = false;
    templateNameInput = '';
    templateNotice = '';
    error = '';
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    sending = true;
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
      toast.success(
        `Demande envoyée — commande ${created.orderNumber} en attente de confirmation.`,
      );
      open = false;
      reset();
      await oncreated?.(created.orderNumber);
    } catch (e) {
      error = e instanceof PortalApiError ? e.message : "Échec de l'envoi de la demande";
    } finally {
      sending = false;
    }
  }

  async function saveTemplate() {
    templateNotice = '';
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
      templateNotice =
        e instanceof PortalApiError ? e.message : "Échec de l'enregistrement du modèle";
    }
  }

  // Pre-fill from the picked template (same behaviour as the legacy panel).
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

<Modal
  bind:open
  title="Nouvelle demande de transport"
  size="lg"
  dismissible={!sending}
  onclose={reset}
>
  {#if error}
    <p class="mb-3 text-sm text-danger" role="alert">{error}</p>
  {/if}

  <TemplatesPanel {client} bind:templates bind:selectedTemplateId />

  <form onsubmit={submit} class="flex flex-col gap-4">
    <!-- Route -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Origine">
        <ReferenceSelect options={locationOptions} bind:value={request.originLocationId} required />
      </Field>
      <Field label="Destination">
        <ReferenceSelect
          options={locationOptions}
          bind:value={request.destinationLocationId}
          required
        />
      </Field>
    </div>

    <!-- Reference + windows -->
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

    <!-- Measures -->
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
            {#each modeOptions as m (m.value)}
              <option value={m.value}>{m.label}</option>
            {/each}
          </Select>
        </Field>
        {#if modeSuggestion}
          <p class="mt-1 text-xs text-ink-muted">Suggéré : {modeSuggestion} selon le poids</p>
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

    <div class="flex justify-end gap-2 border-t border-edge pt-4">
      <Button
        variant="secondary"
        type="button"
        disabled={sending}
        onclick={() => {
          open = false;
          reset();
        }}
      >
        Annuler
      </Button>
      <Button type="submit" loading={sending}>Envoyer la demande</Button>
    </div>
  </form>
</Modal>
