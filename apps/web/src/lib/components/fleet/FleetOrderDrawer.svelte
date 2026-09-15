<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    PERMISSIONS,
    FLEET_ORDER_LABELS,
    FLEET_TYPE_LABELS,
    fleetDateKey,
    type CustomFieldDefinition,
    type FleetAssetRow,
  } from '@pulsar/shared';
  import {
    Badge,
    Button,
    Drawer,
    ErrorNotice,
    Field,
    Input,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  let {
    id = '',
    asset = null,
    onclose,
    onsaved,
  }: {
    id?: string;
    asset?: FleetAssetRow | null;
    onclose: () => void;
    onsaved: () => void | Promise<void>;
  } = $props();
  interface Order {
    id: string;
    description: string;
    status: string;
    type: string;
    dueDate: string | null;
    vendor: string | null;
    updatedAt: string;
    openedAt: string;
    completedAt: string | null;
    costAmount: string | null;
    costCurrency: string;
    odometerKm: number | null;
    vehicle: { id: string; unitNumber: string; status: string } | null;
    trailer: { id: string; unitNumber: string; status: string } | null;
  }
  let open = $state(true),
    loading = $state(true),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let order = $state<Order | null>(null),
    savedId = $state('');
  let mode = $state<'view' | 'edit' | 'complete'>('view');
  let description = $state(''),
    vendor = $state(''),
    dueDate = $state(''),
    type = $state('REPAIR');
  let amount = $state<number | null>(null),
    currency = $state('CAD'),
    odometer = $state<number | null>(null);
  let fields = $state<CustomFieldDefinition[]>([]),
    fieldsReady = $state(false),
    customData = $state<Record<string, unknown>>({});
  const manage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.FLEET.MANAGE));
  const active = $derived(!!order && ['OPEN', 'IN_PROGRESS'].includes(order.status));
  const creating = $derived(!id && !savedId);
  const assetLabel = $derived(
    asset?.unitNumber ?? order?.vehicle?.unitNumber ?? order?.trailer?.unitNumber ?? 'Actif',
  );
  beforeNavigate(({ cancel }) => {
    if (open) cancel();
  });
  async function load() {
    if (busy) return;
    if (
      mode !== 'view' &&
      !(await confirmAction('Abandonner la saisie et recharger la dernière version ?', {
        title: 'Actualiser le dossier',
        confirmLabel: 'Abandonner et actualiser',
      }))
    )
      return;
    loading = true;
    error = '';
    try {
      if (id || savedId) {
        order = await api<Order>(`/fleet/maintenance-orders/${id || savedId}`);
        mode = 'view';
        uncertain = false;
      } else {
        fields = await api<CustomFieldDefinition[]>('/fleet/workspace/order-fields');
        fieldsReady = true;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Dossier indisponible.';
      order = null;
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void load();
  });
  function edit() {
    if (!order) return;
    description = order.description;
    vendor = order.vendor ?? '';
    dueDate = order.dueDate ? fleetDateKey(order.dueDate) : '';
    mode = 'edit';
    error = '';
  }
  function complete() {
    if (!order) return;
    amount = order.costAmount === null ? null : Number(order.costAmount);
    currency = order.costCurrency;
    odometer = order.odometerKm;
    mode = 'complete';
    error = '';
  }
  async function close() {
    if (busy) return;
    if (
      (mode !== 'view' || creating) &&
      !uncertain &&
      !(await confirmAction('Abandonner la saisie non enregistrée ?', {
        title: 'Fermer l’intervention',
        confirmLabel: 'Abandonner',
      }))
    )
      return;
    open = false;
    onclose();
  }
  async function write(action: 'create' | 'edit' | 'start' | 'complete' | 'cancel') {
    if (busy || loading || !manage || uncertain || (creating && !fieldsReady)) return;
    if ((action === 'create' || action === 'edit') && !description.trim()) {
      error = 'Décrivez l’intervention.';
      return;
    }
    if (
      action === 'complete' &&
      ((amount != null &&
        (!Number.isFinite(amount) ||
          amount < 0 ||
          Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7)) ||
        !/^[A-Z]{3}$/.test(currency) ||
        (odometer != null && (!Number.isInteger(odometer) || odometer < 0)))
    ) {
      error =
        'Coût positif ou nul (deux décimales), devise à trois lettres et kilométrage entier requis.';
      return;
    }
    const messages = {
      create: `Ouvrir une intervention pour ${assetLabel} ? L’actif passe en maintenance dès l’ouverture, même avec une échéance future.`,
      edit: 'Enregistrer cette échéance et ces consignes ? Une échéance ne réserve ni atelier ni technicien.',
      start: `Démarrer l’intervention sur ${assetLabel} ?`,
      complete: `Terminer l’intervention sur ${assetLabel} ? Le serveur revérifie les autres ordres ouverts avant toute remise en disponibilité. Aucun paiement ne sera créé.`,
      cancel: `Annuler cette intervention sur ${assetLabel} ? Les autres travaux restent inchangés.`,
    };
    busy = true;
    error = '';
    let sent = false;
    const scope = `${$auth?.tenant.id}:${$auth?.user.id}`;
    try {
      if (
        !(await confirmAction(messages[action], {
          title: 'Confirmer l’intervention',
          confirmLabel: 'Confirmer',
        }))
      )
        return;
      if (scope !== `${$auth?.tenant.id}:${$auth?.user.id}`)
        throw new Error('La session a changé.');
      let body: Record<string, unknown> = order ? { expectedUpdatedAt: order.updatedAt } : {};
      let path = `/fleet/maintenance-orders/${order?.id ?? ''}`;
      if (action === 'create') {
        if (!asset) throw new Error('Actif requis.');
        body = {
          [asset.kind === 'vehicle' ? 'vehicleId' : 'trailerId']: asset.id,
          type,
          description: description.trim(),
          ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
          ...(dueDate ? { dueDate: `${dueDate}T00:00:00.000Z` } : {}),
          customData: Object.fromEntries(
            Object.entries(customData).filter(([, v]) => v !== '' && v !== null && v !== undefined),
          ),
        };
        path = '/fleet/maintenance-orders';
      } else if (action === 'edit')
        body = {
          ...body,
          description: description.trim(),
          vendor: vendor.trim(),
          dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null,
        };
      else {
        path += `/${action}`;
        if (action === 'complete')
          body = {
            ...body,
            ...(amount != null ? { costAmount: amount } : {}),
            costCurrency: currency,
            ...(odometer != null ? { odometerKm: odometer } : {}),
          };
      }
      sent = true;
      const result = await api<Order>(path, { method: action === 'edit' ? 'PATCH' : 'POST', body });
      savedId = result.id;
      order = result;
      mode = 'view';
      await onsaved();
    } catch (e) {
      uncertain =
        sent && (!(e instanceof ApiError) || ![400, 403, 404, 409, 422].includes(e.statusCode));
      error = uncertain
        ? 'Résultat non confirmé. Ne recréez pas cette intervention. Fermez puis vérifiez le parc et le journal de maintenance avant toute nouvelle action.'
        : e instanceof Error
          ? e.message
          : 'Enregistrement impossible.';
    } finally {
      busy = false;
    }
  }
</script>

<Drawer
  bind:open
  title={creating ? `Intervention · ${assetLabel}` : `Maintenance · ${assetLabel}`}
  width="lg"
  dismissible={!busy}
  onbeforeclose={() => {
    void close();
    return false;
  }}
>
  <ErrorNotice
    message={error}
    onretry={!busy && (creating ? !fieldsReady && !uncertain : true) ? load : undefined}
  />
  {#if loading}<Skeleton rows={5} />{:else if creating || order}
    {#if order}<section class="mb-6 border-b border-edge pb-5">
        <div class="flex flex-wrap items-center gap-2">
          <Badge>{FLEET_ORDER_LABELS[order.status] ?? order.status}</Badge><span
            class="text-xs text-ink-muted">{FLEET_TYPE_LABELS[order.type]}</span
          >
        </div>
        <h3 class="mt-3 break-words text-lg font-semibold">{order.description}</h3>
        <dl class="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-xs text-ink-muted">Ouverture</dt>
            <dd>{fleetDateKey(order.openedAt)}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Échéance (UTC)</dt>
            <dd>{order.dueDate ? fleetDateKey(order.dueDate) : 'À dater'}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Prestataire</dt>
            <dd class="break-words">{order.vendor || 'Non renseigné'}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Clôture</dt>
            <dd>{order.completedAt ? fleetDateKey(order.completedAt) : 'Non clôturé'}</dd>
          </div>
        </dl>
        {#if order.costAmount !== null}<p class="mt-3 font-mono text-sm">
            Coût enregistré : {order.costAmount}
            {order.costCurrency}
          </p>{/if}
        <p class="mt-3 text-xs text-ink-muted">
          Le statut flotte n’est pas une réservation de transport. Les autres interventions peuvent
          maintenir l’immobilisation.
        </p>
      </section>{:else}<p class="mb-5 rounded-md bg-surface-muted p-3 text-sm">
        Ouvrir l’ordre place l’actif en maintenance immédiatement. Pour prévoir un entretien
        récurrent sans l’immobiliser, utilisez les plans préventifs.
      </p>{/if}
    {#if creating || mode === 'edit'}<fieldset disabled={busy || uncertain} class="space-y-4">
        {#if creating}<Field label="Type d’intervention"
            ><Select bind:value={type}
              >{#each Object.entries(FLEET_TYPE_LABELS) as [key, label]}<option value={key}
                  >{label}</option
                >{/each}</Select
            ></Field
          >{/if}
        <Field label="Consignes de l’intervention"
          ><Textarea bind:value={description} rows={3} maxlength={2000} /></Field
        >
        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Échéance (date UTC)"><Input type="date" bind:value={dueDate} /></Field
          ><Field label="Prestataire"><Input bind:value={vendor} maxlength={200} /></Field>
        </div>
        {#if creating}<CustomFieldInputs definitions={fields} bind:data={customData} />{/if}
      </fieldset>
    {:else if mode === 'complete'}<fieldset disabled={busy || uncertain} class="space-y-4">
        <h3 class="font-semibold">Bilan de l’intervention</h3>
        <div class="grid grid-cols-2 gap-4">
          <Field label="Coût total"
            ><Input type="number" min={0} step={0.01} bind:value={amount} /></Field
          ><Field label="Devise"><Input bind:value={currency} maxlength={3} /></Field>
        </div>
        <Field label="Kilométrage relevé"
          ><Input type="number" min={0} step={1} bind:value={odometer} /></Field
        >
        <p class="text-xs text-ink-muted">
          Le relevé et la date de fin réancrent le plan préventif lié. Ce coût n’est ni une facture
          ni un paiement.
        </p>
      </fieldset>
    {:else if active && manage}<div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || uncertain} onclick={edit}
          >Modifier l’échéance</Button
        >{#if order?.status === 'OPEN'}<Button
            variant="secondary"
            disabled={busy || uncertain}
            onclick={() => write('start')}>Démarrer</Button
          >{/if}<Button disabled={busy || uncertain} onclick={complete}>Terminer</Button><Button
          variant="ghost"
          disabled={busy || uncertain}
          onclick={() => write('cancel')}>Annuler l’ordre</Button
        >
      </div>{/if}
  {/if}
  {#snippet footer()}<div class="flex w-full flex-wrap justify-between gap-2">
      <Button variant="secondary" disabled={busy} onclick={close}>Fermer</Button>
      <div class="flex flex-wrap gap-2">
        {#if !creating}<Button variant="ghost" disabled={busy} onclick={load}
            >Actualiser le dossier</Button
          >{/if}{#if (creating || mode !== 'view') && manage}<Button
            disabled={busy || loading || uncertain || (creating && !fieldsReady)}
            onclick={() => write(creating ? 'create' : mode === 'edit' ? 'edit' : 'complete')}
            >{creating
              ? 'Ouvrir l’intervention'
              : mode === 'edit'
                ? 'Enregistrer l’échéance'
                : 'Confirmer la clôture'}</Button
          >{/if}
      </div>
    </div>{/snippet}
</Drawer>
