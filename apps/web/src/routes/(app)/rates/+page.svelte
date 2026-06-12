<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatMoney, formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    Modal,
    Field,
    Input,
    Select,
    toneFor,
  } from '$lib/components/ui';

  interface Option { id: string; name: string }
  interface LaneOption { id: string; name: string | null; originType: string; destinationType: string }
  interface AccessorialOpt { id: string; name: string; code: string; unit: string }
  interface RateBreak { upToKg: number; amount: number }
  interface RateAccessorialPrice {
    accessorialId?: string;
    amount: number;
    accessorial?: AccessorialOpt;
  }
  interface Rate {
    id: string;
    name: string;
    rateType: string;
    mode: string | null;
    status: string;
    currency: string;
    baseAmount: string;
    minCharge: string | null;
    fuelSurchargePct: number | null;
    validFrom: string | null;
    validTo: string | null;
    carrier: Option | null;
    customer: Option | null;
    lane: LaneOption | null;
    fuelTable: Option | null;
    breaks: RateBreak[];
    accessorialPrices: RateAccessorialPrice[];
  }

  let rates = $state<Rate[]>([]);
  let total = $state(0);
  let lanes = $state<LaneOption[]>([]);
  let carriers = $state<Option[]>([]);
  let fuelTables = $state<Option[]>([]);
  let accessorials = $state<AccessorialOpt[]>([]);
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);

  // Form state
  let editingId = $state<string | null>(null);
  let name = $state('');
  let rateType = $state('FLAT');
  let rateMode = $state<string>('');
  let baseAmount = $state(0);
  let currency = $state('CAD');
  let minCharge = $state<number | null>(null);
  let fuelSurchargePct = $state<number | null>(null);
  let carrierId = $state('');
  let laneId = $state('');
  let fuelTableId = $state('');
  let validFrom = $state('');
  let validTo = $state('');
  let status = $state('DRAFT');
  let breaks = $state<{ upToKg: number; amount: number }[]>([]);
  let prices = $state<{ accessorialId: string; amount: number }[]>([]);

  function statusTone(s: string) {
    if (s === 'ACTIVE') return 'ok';
    if (s === 'EXPIRED') return 'danger';
    return 'neutral';
  }

  function laneLabel(lane: LaneOption): string {
    return lane.name ?? `${lane.originType} → ${lane.destinationType}`;
  }

  async function load() {
    try {
      const [ratesRes, lanesRes, carriersRes, fuelRes, accsRes] = await Promise.all([
        api<Paginated<Rate>>('/transportation/rates', { query: { pageSize: 100 } }),
        api<Paginated<LaneOption>>('/transportation/lanes', { query: { pageSize: 100 } }),
        api<Paginated<Option>>('/transportation/carriers', { query: { pageSize: 100 } }),
        api<Paginated<Option>>('/transportation/fuel-tables', { query: { pageSize: 100 } }),
        api<Paginated<AccessorialOpt>>('/transportation/accessorials', { query: { pageSize: 100 } }),
      ]);
      rates = ratesRes.items;
      total = ratesRes.total;
      lanes = lanesRes.items;
      carriers = carriersRes.items;
      fuelTables = fuelRes.items;
      accessorials = accsRes.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load rates';
    } finally {
      loading = false;
    }
  }

  function reset() {
    editingId = null;
    name = '';
    rateType = 'FLAT';
    rateMode = '';
    baseAmount = 0;
    currency = 'CAD';
    minCharge = null;
    fuelSurchargePct = null;
    carrierId = '';
    laneId = '';
    fuelTableId = '';
    validFrom = '';
    validTo = '';
    status = 'DRAFT';
    breaks = [];
    prices = [];
    showForm = false;
    error = '';
  }

  function edit(rate: Rate) {
    editingId = rate.id;
    name = rate.name;
    rateType = rate.rateType;
    rateMode = rate.mode ?? '';
    baseAmount = parseFloat(rate.baseAmount);
    currency = rate.currency;
    minCharge = rate.minCharge !== null ? parseFloat(rate.minCharge) : null;
    fuelSurchargePct = rate.fuelSurchargePct ?? null;
    carrierId = rate.carrier?.id ?? '';
    laneId = rate.lane?.id ?? '';
    fuelTableId = rate.fuelTable?.id ?? '';
    validFrom = rate.validFrom ? rate.validFrom.slice(0, 10) : '';
    validTo = rate.validTo ? rate.validTo.slice(0, 10) : '';
    status = rate.status;
    breaks = rate.breaks.map((b) => ({ upToKg: b.upToKg, amount: b.amount }));
    prices = rate.accessorialPrices
      .filter((p) => p.accessorial)
      .map((p) => ({ accessorialId: p.accessorial!.id, amount: p.amount }));
    showForm = true;
  }

  function addBreak() {
    breaks = [...breaks, { upToKg: 0, amount: 0 }];
  }

  function removeBreak(index: number) {
    breaks = breaks.filter((_, i) => i !== index);
  }

  function addPrice() {
    prices = [...prices, { accessorialId: '', amount: 0 }];
  }

  function removePrice(index: number) {
    prices = prices.filter((_, i) => i !== index);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const body: Record<string, unknown> = {
        name,
        rateType,
        mode: rateMode || undefined,
        baseAmount: Number(baseAmount),
        currency: currency || undefined,
        carrierId: carrierId || undefined,
        laneId: laneId || undefined,
        fuelTableId: fuelTableId || undefined,
        minCharge: minCharge !== null && minCharge !== undefined ? Number(minCharge) : undefined,
        fuelSurchargePct: fuelSurchargePct !== null && fuelSurchargePct !== undefined ? Number(fuelSurchargePct) : undefined,
        validFrom: validFrom ? new Date(validFrom).toISOString() : undefined,
        validTo: validTo ? new Date(validTo).toISOString() : undefined,
        breaks: rateType === 'PER_HUNDREDWEIGHT'
          ? breaks.map((b) => ({ upToKg: Number(b.upToKg), amount: Number(b.amount) }))
          : undefined,
        accessorialPrices: prices
          .filter((p) => p.accessorialId)
          .map((p) => ({ accessorialId: p.accessorialId, amount: Number(p.amount) })),
      };

      if (editingId) {
        body.status = status;
        await api(`/transportation/rates/${editingId}`, { method: 'PATCH', body });
        toast.success('Rate updated');
      } else {
        await api('/transportation/rates', { method: 'POST', body });
        toast.success('Rate created');
      }
      reset();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save rate';
      error = msg;
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Rates" count={total}>
  {#snippet actions()}
    <Button onclick={() => { reset(); showForm = true; }}>New rate</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Name</th><th>Type</th><th>Mode</th><th>Lane</th><th>Carrier</th><th>Base</th><th>Valid</th><th>Status</th><th></th>
  {/snippet}
  {#snippet body()}
    {#each rates as rate (rate.id)}
      <tr>
        <td><span class="font-semibold text-ink">{rate.name}</span></td>
        <td>
          <span class="text-sm text-ink">{rate.rateType}</span>
          {#if rate.breaks.length > 0}
            <span class="ml-1 text-xs text-ink-muted">({rate.breaks.length} breaks)</span>
          {/if}
        </td>
        <td>
          {#if rate.mode}
            <span class="rounded border border-edge px-1.5 text-xs text-neutral">{rate.mode}</span>
          {:else}
            <span class="text-ink-faint">all</span>
          {/if}
        </td>
        <td>
          {#if rate.lane}
            {rate.lane.name ?? `${rate.lane.originType} → ${rate.lane.destinationType}`}
          {:else}
            <span class="text-ink-faint">catch-all</span>
          {/if}
        </td>
        <td>{rate.carrier?.name ?? '—'}</td>
        <td class="tabular-nums">{formatMoney(rate.baseAmount, rate.currency)}</td>
        <td class="text-xs text-ink-muted">
          {#if rate.validFrom || rate.validTo}
            {formatDate(rate.validFrom)} → {formatDate(rate.validTo)}
          {:else}
            —
          {/if}
        </td>
        <td>
          <Badge tone={statusTone(rate.status)}>{rate.status}</Badge>
        </td>
        <td class="text-right">
          <Button variant="secondary" onclick={() => edit(rate)}>Edit</Button>
        </td>
      </tr>
    {:else}
      <tr><td colspan="9"><EmptyState message="No rates yet." /></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

<!-- ─── Rate form Modal ───────────────────────────────────────────────────────── -->
<Modal bind:open={showForm} title={editingId ? 'Edit rate' : 'New rate'}>
  {#snippet children()}
    <form onsubmit={save}>
      <div class="grid grid-cols-3 gap-x-4">
        <div class="col-span-3">
          <Field label="Name">
            <Input bind:value={name} required placeholder="Base rate – East" />
          </Field>
        </div>

        <Field label="Type">
          <Select bind:value={rateType} required>
            <option value="FLAT">FLAT</option>
            <option value="PER_KM">PER_KM</option>
            <option value="PER_HUNDREDWEIGHT">PER_HUNDREDWEIGHT</option>
            <option value="PER_PALLET">PER_PALLET</option>
            <option value="SPOT">SPOT</option>
          </Select>
        </Field>

        <Field label="Base amount">
          <Input type="number" step="0.01" min="0" bind:value={baseAmount} required />
        </Field>

        <Field label="Currency">
          <Input bind:value={currency} placeholder="CAD" maxlength={3} />
        </Field>

        <Field label="Min charge">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={minCharge ?? ''}
            oninput={(e) => {
              const v = e.currentTarget.value;
              minCharge = v === '' ? null : parseFloat(v);
            }}
            placeholder="optional"
          />
        </Field>

        <Field label="Fuel surcharge %">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={fuelSurchargePct ?? ''}
            oninput={(e) => {
              const v = e.currentTarget.value;
              fuelSurchargePct = v === '' ? null : parseFloat(v);
            }}
            placeholder="optional"
          />
        </Field>

        <Field label="Mode">
          <Select bind:value={rateMode}>
            <option value="">— all modes —</option>
            {#each Object.values(TransportMode) as m (m)}
              <option value={m}>{m}</option>
            {/each}
          </Select>
        </Field>

        <Field label="Carrier">
          <Select bind:value={carrierId}>
            <option value="">— none —</option>
            {#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </Select>
        </Field>

        <Field label="Lane">
          <Select bind:value={laneId}>
            <option value="">— catch-all —</option>
            {#each lanes as l (l.id)}<option value={l.id}>{laneLabel(l)}</option>{/each}
          </Select>
        </Field>

        <Field label="Fuel table">
          <Select bind:value={fuelTableId}>
            <option value="">— none —</option>
            {#each fuelTables as ft (ft.id)}<option value={ft.id}>{ft.name}</option>{/each}
          </Select>
        </Field>

        <Field label="Valid from">
          <Input type="date" bind:value={validFrom} />
        </Field>

        <Field label="Valid to">
          <Input type="date" bind:value={validTo} />
        </Field>

        {#if editingId}
          <Field label="Status">
            <Select bind:value={status}>
              <option value="DRAFT">DRAFT</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="EXPIRED">EXPIRED</option>
            </Select>
          </Field>
        {/if}
      </div>

      {#if rateType === 'PER_HUNDREDWEIGHT'}
        <div class="mt-4">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-semibold text-ink">Weight breaks</span>
            <Button variant="secondary" onclick={addBreak}>Add break</Button>
          </div>
          {#if breaks.length === 0}
            <p class="text-xs text-ink-muted mb-3">No breaks — flat base rate applies.</p>
          {:else}
            <div class="space-y-2 mb-3">
              {#each breaks as brk, i (i)}
                <div class="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <Field label="Up to (kg)">
                    <Input type="number" step="0.001" min="0.001" bind:value={brk.upToKg} required />
                  </Field>
                  <Field label="Amount">
                    <Input type="number" step="0.01" min="0" bind:value={brk.amount} required />
                  </Field>
                  <Button variant="danger" onclick={() => removeBreak(i)}>Remove</Button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="mt-4">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-semibold text-ink">Accessorial prices</span>
          <Button variant="secondary" onclick={addPrice}>Add accessorial</Button>
        </div>
        {#if prices.length === 0}
          <p class="text-xs text-ink-muted mb-3">No accessorial prices configured.</p>
        {:else}
          <div class="space-y-2 mb-3">
            {#each prices as price, i (i)}
              <div class="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
                <Field label="Accessorial">
                  <Select bind:value={price.accessorialId} required>
                    <option value="" disabled>Select…</option>
                    {#each accessorials as a (a.id)}
                      <option value={a.id}>{a.code} – {a.name} ({a.unit})</option>
                    {/each}
                  </Select>
                </Field>
                <Field label="Amount">
                  <Input type="number" step="0.01" min="0" bind:value={price.amount} required />
                </Field>
                <Button variant="danger" onclick={() => removePrice(i)}>Remove</Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onclick={reset}>Cancel</Button>
        <Button type="submit">{editingId ? 'Update' : 'Create'}</Button>
      </div>
    </form>
  {/snippet}
</Modal>
