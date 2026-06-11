<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

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

  // Form state
  let editingId = $state<string | null>(null);
  let name = $state('');
  let rateType = $state('FLAT');
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
    }
  }

  function reset() {
    editingId = null;
    name = '';
    rateType = 'FLAT';
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

<div class="page-header">
  <h1>Rates <span class="muted">({total})</span></h1>
  <button class="btn" onclick={() => { reset(); showForm = !showForm; }}>New rate</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={save}>
    <h2 style="margin-top: 0;">{editingId ? 'Edit rate' : 'New rate'}</h2>

    <div class="form-grid">
      <div class="field">
        <label for="rate-name">Name</label>
        <input id="rate-name" bind:value={name} required placeholder="Base rate – East" />
      </div>
      <div class="field">
        <label for="rate-type">Type</label>
        <select id="rate-type" bind:value={rateType} required>
          <option value="FLAT">FLAT</option>
          <option value="PER_KM">PER_KM</option>
          <option value="PER_HUNDREDWEIGHT">PER_HUNDREDWEIGHT</option>
          <option value="PER_PALLET">PER_PALLET</option>
          <option value="SPOT">SPOT</option>
        </select>
      </div>
      <div class="field">
        <label for="base-amount">Base amount</label>
        <input id="base-amount" type="number" step="0.01" min="0" bind:value={baseAmount} required />
      </div>
      <div class="field">
        <label for="currency">Currency</label>
        <input id="currency" bind:value={currency} placeholder="CAD" maxlength="3" />
      </div>
      <div class="field">
        <label for="min-charge">Min charge</label>
        <input
          id="min-charge"
          type="number"
          step="0.01"
          min="0"
          value={minCharge ?? ''}
          oninput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            minCharge = v === '' ? null : parseFloat(v);
          }}
          placeholder="optional"
        />
      </div>
      <div class="field">
        <label for="fuel-surcharge">Fuel surcharge %</label>
        <input
          id="fuel-surcharge"
          type="number"
          step="0.01"
          min="0"
          value={fuelSurchargePct ?? ''}
          oninput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            fuelSurchargePct = v === '' ? null : parseFloat(v);
          }}
          placeholder="optional"
        />
      </div>
      <div class="field">
        <label for="carrier-select">Carrier</label>
        <select id="carrier-select" bind:value={carrierId}>
          <option value="">— none —</option>
          {#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lane-select">Lane</label>
        <select id="lane-select" bind:value={laneId}>
          <option value="">— catch-all —</option>
          {#each lanes as l (l.id)}<option value={l.id}>{laneLabel(l)}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="fuel-table-select">Fuel table</label>
        <select id="fuel-table-select" bind:value={fuelTableId}>
          <option value="">— none —</option>
          {#each fuelTables as ft (ft.id)}<option value={ft.id}>{ft.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="valid-from">Valid from</label>
        <input id="valid-from" type="date" bind:value={validFrom} />
      </div>
      <div class="field">
        <label for="valid-to">Valid to</label>
        <input id="valid-to" type="date" bind:value={validTo} />
      </div>
      {#if editingId}
        <div class="field">
          <label for="rate-status">Status</label>
          <select id="rate-status" bind:value={status}>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </div>
      {/if}
    </div>

    {#if rateType === 'PER_HUNDREDWEIGHT'}
      <div class="section-header">
        <strong>Weight breaks</strong>
        <button class="btn btn-secondary btn-sm" type="button" onclick={addBreak}>Add break</button>
      </div>
      {#if breaks.length === 0}
        <p class="muted" style="font-size: 12px; margin: 4px 0 12px;">No breaks — flat base rate applies.</p>
      {:else}
        <div class="breaks-list">
          {#each breaks as brk, i (i)}
            <div class="break-row">
              <div class="field" style="margin-bottom: 0;">
                <label for="brk-kg-{i}">Up to (kg)</label>
                <input id="brk-kg-{i}" type="number" step="0.001" min="0.001" bind:value={brk.upToKg} required />
              </div>
              <div class="field" style="margin-bottom: 0;">
                <label for="brk-amt-{i}">Amount</label>
                <input id="brk-amt-{i}" type="number" step="0.01" min="0" bind:value={brk.amount} required />
              </div>
              <button
                class="btn btn-danger btn-sm"
                type="button"
                style="align-self: flex-end;"
                onclick={() => removeBreak(i)}
              >
                Remove
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="section-header" style="margin-top: 8px;">
      <strong>Accessorial prices</strong>
      <button class="btn btn-secondary btn-sm" type="button" onclick={addPrice}>Add accessorial</button>
    </div>
    {#if prices.length === 0}
      <p class="muted" style="font-size: 12px; margin: 4px 0 12px;">No accessorial prices configured.</p>
    {:else}
      <div class="breaks-list">
        {#each prices as price, i (i)}
          <div class="break-row">
            <div class="field" style="margin-bottom: 0;">
              <label for="price-acc-{i}">Accessorial</label>
              <select id="price-acc-{i}" bind:value={price.accessorialId} required>
                <option value="" disabled>Select…</option>
                {#each accessorials as a (a.id)}
                  <option value={a.id}>{a.code} – {a.name} ({a.unit})</option>
                {/each}
              </select>
            </div>
            <div class="field" style="margin-bottom: 0;">
              <label for="price-amt-{i}">Amount</label>
              <input id="price-amt-{i}" type="number" step="0.01" min="0" bind:value={price.amount} required />
            </div>
            <button
              class="btn btn-danger btn-sm"
              type="button"
              style="align-self: flex-end;"
              onclick={() => removePrice(i)}
            >
              Remove
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button class="btn" type="submit">{editingId ? 'Update' : 'Create'}</button>
      <button class="btn btn-secondary" type="button" onclick={reset}>Cancel</button>
    </div>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Lane</th>
        <th>Carrier</th>
        <th>Base</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each rates as rate (rate.id)}
        <tr>
          <td><strong>{rate.name}</strong></td>
          <td>
            {rate.rateType}
            {#if rate.breaks.length > 0}
              <span class="muted">({rate.breaks.length} breaks)</span>
            {/if}
          </td>
          <td>
            {#if rate.lane}
              {rate.lane.name ?? `${rate.lane.originType} → ${rate.lane.destinationType}`}
            {:else}
              <span class="muted">catch-all</span>
            {/if}
          </td>
          <td>{rate.carrier?.name ?? '—'}</td>
          <td>{parseFloat(rate.baseAmount).toFixed(2)} {rate.currency}</td>
          <td>
            <span
              class="badge {rate.status === 'ACTIVE'
                ? 'badge-success'
                : rate.status === 'EXPIRED'
                  ? 'badge-danger'
                  : 'badge-muted'}"
            >
              {rate.status}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm" onclick={() => edit(rate)}>Edit</button>
          </td>
        </tr>
      {:else}
        <tr><td colspan="7" class="muted">No rates yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 20px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .breaks-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
    max-width: 640px;
  }

  .break-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 12px;
    align-items: flex-start;
  }
</style>
