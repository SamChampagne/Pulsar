<script lang="ts">
  import { TransportMode } from '@pulsar/shared';
  import { Button, Card, EntityPicker, Field, Select } from '$lib/components/ui';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import type { Option, CapacityExcess } from './types';

  interface ResourceForm {
    carrierId: string;
    driverId: string;
    vehicleId: string;
    trailerId: string;
    rateId: string;
    mode: string;
  }

  interface Props {
    loadId: string;
    editable: boolean;
    carriers?: Option[];
    drivers?: Option[];
    vehicles?: Option[];
    trailers?: Option[];
    rates?: Option[];
    form: ResourceForm;
    onFormChange: (form: ResourceForm) => void;
    onReload: () => Promise<void>;
  }

  // `carriers`/`drivers`/`vehicles`/`trailers`/`rates` stay in Props for the parent's
  // call site (loads/[id]/+page.svelte, out of scope here) but are no longer read:
  // each field below searches its own endpoint through EntityPicker (hard rule 53)
  // instead of a capped `pageSize: 100` preload.
  const { loadId, editable, form, onFormChange, onReload }: Props = $props();

  let resourcesCapacityExcesses = $state<CapacityExcess[]>([]);
  let resourcesForce = $state(false);

  async function saveResources() {
    try {
      const resp = await api<{ modeWarning?: { loadMode: string; orderMode: string } }>(
        `/transportation/loads/${loadId}/assign`,
        {
          method: 'POST',
          body: {
            carrierId: form.carrierId || undefined,
            driverId: form.driverId || undefined,
            vehicleId: form.vehicleId || undefined,
            trailerId: form.trailerId || undefined,
            rateId: form.rateId || undefined,
            mode: form.mode || undefined,
            ...(resourcesForce ? { force: true } : {}),
          },
        },
      );
      if (resp?.modeWarning) {
        const { loadMode, orderMode } = resp.modeWarning;
        toast.error(
          `Mode incompatible : load ${loadMode} / commande ${orderMode} — assigné quand même`,
        );
      }
      toast.success('Ressources assignées');
      resourcesCapacityExcesses = [];
      resourcesForce = false;
      await onReload();
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 400) {
        const body = e.body as { excesses?: CapacityExcess[] } | null;
        if (body?.excesses?.length) {
          resourcesCapacityExcesses = body.excesses;
          return;
        }
      }
      toast.error(e instanceof ApiError ? e.message : "Échec de l'assignation des ressources");
    }
  }
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Ressources</h2>
  <div class="flex flex-col gap-3">
    <Field label="Transporteur">
      <EntityPicker
        endpoint="/transportation/carriers"
        label="Transporteur"
        labelKey="name"
        detailKey="code"
        disabled={!editable}
        bind:value={() => form.carrierId, (v) => onFormChange({ ...form, carrierId: v })}
      />
    </Field>
    <Field label="Chauffeur">
      <EntityPicker
        endpoint="/transportation/drivers"
        label="Chauffeur"
        labelKey="lastName"
        detailKey="firstName"
        disabled={!editable}
        bind:value={() => form.driverId, (v) => onFormChange({ ...form, driverId: v })}
      />
    </Field>
    <Field label="Véhicule">
      <EntityPicker
        endpoint="/transportation/vehicles"
        label="Véhicule"
        labelKey="unitNumber"
        disabled={!editable}
        bind:value={() => form.vehicleId, (v) => onFormChange({ ...form, vehicleId: v })}
      />
    </Field>
    <Field label="Remorque">
      <EntityPicker
        endpoint="/transportation/trailers"
        label="Remorque"
        labelKey="unitNumber"
        disabled={!editable}
        bind:value={() => form.trailerId, (v) => onFormChange({ ...form, trailerId: v })}
      />
    </Field>
    <Field label="Tarif">
      <EntityPicker
        endpoint="/transportation/rates"
        label="Tarif"
        labelKey="name"
        disabled={!editable}
        bind:value={() => form.rateId, (v) => onFormChange({ ...form, rateId: v })}
      />
    </Field>
    <Field label="Mode">
      <Select
        value={form.mode}
        onchange={(e) =>
          onFormChange({ ...form, mode: (e.currentTarget as HTMLSelectElement).value })}
        disabled={!editable}
      >
        <option value="">— hérité —</option>
        {#each Object.values(TransportMode) as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </Select>
    </Field>
  </div>
  {#if editable}
    <div class="mt-3">
      <Button variant="primary" onclick={saveResources}>Enregistrer les ressources</Button>
    </div>
  {/if}

  {#if resourcesCapacityExcesses.length > 0}
    <div class="mt-3 rounded-card border border-warn bg-warn-soft p-3">
      <p class="mb-2 text-sm font-semibold text-warn">Capacité de la remorque dépassée</p>
      <table class="w-full text-xs">
        <thead>
          <tr class="text-ink-muted">
            <th class="pb-1 text-left">Axe</th>
            <th class="pb-1 text-right">Capacité</th>
            <th class="pb-1 text-right">Demandé</th>
            <th class="pb-1 text-right">Excédent</th>
          </tr>
        </thead>
        <tbody>
          {#each resourcesCapacityExcesses as ex (ex.axis)}
            <tr>
              <td class="py-0.5">{ex.axis}</td>
              <td class="py-0.5 text-right">{ex.capacity}</td>
              <td class="py-0.5 text-right">{ex.requested}</td>
              <td class="py-0.5 text-right text-danger">+{ex.excess}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if editable}
        <label class="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={resourcesForce} />
          Forcer l'assignation (audité)
        </label>
        {#if resourcesForce}
          <div class="mt-2">
            <Button variant="danger" onclick={saveResources}>Confirmer l'assignation forcée</Button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</Card>
