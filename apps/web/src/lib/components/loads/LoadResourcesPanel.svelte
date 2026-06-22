<script lang="ts">
  import { TransportMode } from '@pulsar/shared';
  import { Badge, Button, Card, Field, Select } from '$lib/components/ui';
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
    carriers: Option[];
    drivers: Option[];
    vehicles: Option[];
    trailers: Option[];
    rates: Option[];
    form: ResourceForm;
    onFormChange: (form: ResourceForm) => void;
    onReload: () => Promise<void>;
  }

  const { loadId, editable, carriers, drivers, vehicles, trailers, rates, form, onFormChange, onReload }: Props = $props();

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
        toast.error(`Mode mismatch: load ${loadMode} / order ${orderMode} — assigned anyway`);
      }
      toast.success('Resources assigned');
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
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign resources');
    }
  }
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Resources</h2>
  <div class="flex flex-col gap-3">
    <Field label="Carrier">
      <Select value={form.carrierId} onchange={(e) => onFormChange({ ...form, carrierId: (e.currentTarget as HTMLSelectElement).value })} disabled={!editable}>
        <option value="">—</option>
        {#each carriers as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
      </Select>
    </Field>
    <Field label="Driver">
      <Select value={form.driverId} onchange={(e) => onFormChange({ ...form, driverId: (e.currentTarget as HTMLSelectElement).value })} disabled={!editable}>
        <option value="">—</option>
        {#each drivers as o (o.id)}<option value={o.id}>{o.firstName} {o.lastName}</option>{/each}
      </Select>
    </Field>
    <Field label="Vehicle">
      <Select value={form.vehicleId} onchange={(e) => onFormChange({ ...form, vehicleId: (e.currentTarget as HTMLSelectElement).value })} disabled={!editable}>
        <option value="">—</option>
        {#each vehicles as o (o.id)}<option value={o.id}>{o.unitNumber}</option>{/each}
      </Select>
    </Field>
    <Field label="Trailer">
      <Select value={form.trailerId} onchange={(e) => onFormChange({ ...form, trailerId: (e.currentTarget as HTMLSelectElement).value })} disabled={!editable}>
        <option value="">—</option>
        {#each trailers as o (o.id)}<option value={o.id}>{o.unitNumber}</option>{/each}
      </Select>
    </Field>
    <Field label="Rate">
      <Select value={form.rateId} onchange={(e) => onFormChange({ ...form, rateId: (e.currentTarget as HTMLSelectElement).value })} disabled={!editable}>
        <option value="">—</option>
        {#each rates as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
      </Select>
    </Field>
    <Field label="Mode">
      <Select value={form.mode} onchange={(e) => onFormChange({ ...form, mode: (e.currentTarget as HTMLSelectElement).value })} disabled={!editable}>
        <option value="">— inherit —</option>
        {#each Object.values(TransportMode) as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </Select>
    </Field>
  </div>
  {#if editable}
    <div class="mt-3">
      <Button variant="primary" onclick={saveResources}>Save resources</Button>
    </div>
  {/if}

  {#if resourcesCapacityExcesses.length > 0}
    <div class="mt-3 rounded-card border border-warn bg-warn-soft p-3">
      <p class="mb-2 text-sm font-semibold text-warn">Trailer capacity exceeded</p>
      <table class="w-full text-xs">
        <thead>
          <tr class="text-ink-muted">
            <th class="pb-1 text-left">Axis</th>
            <th class="pb-1 text-right">Capacity</th>
            <th class="pb-1 text-right">Requested</th>
            <th class="pb-1 text-right">Excess</th>
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
          Force assignment (audited)
        </label>
        {#if resourcesForce}
          <div class="mt-2">
            <Button variant="danger" onclick={saveResources}>Confirm force assign</Button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</Card>
