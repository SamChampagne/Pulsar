<script lang="ts">
  import { Badge, Button, Card } from '$lib/components/ui';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import type { LoadDetail, RateOption } from './types';

  interface Props {
    loadId: string;
    detail: LoadDetail;
    editable: boolean;
    onReload: () => Promise<void>;
  }

  const { loadId, detail, editable, onReload }: Props = $props();

  let rateOptions = $state<RateOption[]>([]);
  let rateOptionsOpen = $state(false);
  let rateOptionsLoading = $state(false);
  let rateOptionsError = $state('');
  let expandedRateId = $state<string | null>(null);

  async function openRateOptions() {
    rateOptionsOpen = true;
    rateOptionsLoading = true;
    rateOptionsError = '';
    try {
      const result = await api<{ referenceDate: string; options: RateOption[] }>(
        `/transportation/loads/${loadId}/rate-options`,
      );
      rateOptions = result.options;
    } catch (e) {
      rateOptionsError = e instanceof ApiError ? e.message : 'Failed to load rate options';
    } finally {
      rateOptionsLoading = false;
    }
  }

  async function assignRate(rateId: string) {
    try {
      await api(`/transportation/loads/${loadId}/assign`, {
        method: 'POST',
        body: { rateId },
      });
      toast.success('Rate assigned');
      rateOptionsOpen = false;
      await onReload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign rate');
    }
  }
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Summary</h2>
  <dl class="flex flex-col gap-2 text-sm">
    <div class="flex items-center justify-between gap-2">
      <dt class="text-ink-muted">Carrier</dt>
      <dd class="font-medium">{detail.carrier?.name ?? '—'}</dd>
    </div>
    <div class="flex items-center justify-between gap-2">
      <dt class="text-ink-muted">Driver</dt>
      <dd class="font-medium">
        {detail.driver ? `${detail.driver.firstName} ${detail.driver.lastName}` : '—'}
      </dd>
    </div>
    <div class="flex items-center justify-between gap-2">
      <dt class="text-ink-muted">Vehicle</dt>
      <dd class="font-medium">{detail.vehicle?.unitNumber ?? '—'}</dd>
    </div>
    <div class="flex items-center justify-between gap-2">
      <dt class="text-ink-muted">Trailer</dt>
      <dd class="font-medium">{detail.trailer?.unitNumber ?? '—'}</dd>
    </div>
    <div class="flex items-center justify-between gap-2">
      <dt class="text-ink-muted">Mode</dt>
      <dd class="font-medium">{detail.mode ?? '—'}</dd>
    </div>
    <div class="flex items-center justify-between gap-2">
      <dt class="text-ink-muted">Rate</dt>
      <dd class="font-medium">{detail.rate?.name ?? '—'}</dd>
    </div>
    {#if detail.estimatedCost !== null}
      <div class="flex items-center justify-between gap-2">
        <dt class="text-ink-muted">Estimated cost</dt>
        <dd class="font-semibold">
          {Number(detail.estimatedCost).toLocaleString('fr-CA')}
          {detail.costCurrency}
        </dd>
      </div>
    {/if}
  </dl>

  {#if editable}
    <div class="mt-3">
      <Button variant="secondary" onclick={openRateOptions}>Compare rates</Button>
    </div>
  {/if}

  {#if detail.costDetail}
    {@const cd = detail.costDetail}
    <div class="mt-4 rounded-card border border-edge bg-surface-muted p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <span class="text-xs text-ink-muted"
          >Cost snapshot — ref. {formatDate(cd.referenceDate)}</span
        >
        {#if !cd.rate.validAtReference}
          <Badge tone="warn">rate outside validity window</Badge>
        {/if}
      </div>
      <table class="w-full text-xs">
        <tbody>
          {#each cd.result.lines as line}
            <tr class="border-b border-edge last:border-0">
              <td class="py-1">{line.label}</td>
              <td class="py-1 text-right"
                >{line.amount.toLocaleString('fr-CA')} {cd.rate.currency}</td
              >
            </tr>
          {/each}
          <tr>
            <td class="pt-2 font-semibold">Total</td>
            <td class="pt-2 text-right font-semibold"
              >{cd.result.total.toLocaleString('fr-CA')} {cd.rate.currency}</td
            >
          </tr>
        </tbody>
      </table>
      {#if cd.result.appliedBreak}
        {@const br = cd.result.appliedBreak}
        <p class="mt-1 text-xs text-ink-muted">
          Break: ≤ {br.upToKg} kg @ {br.amount} $/CWT
          {#if br.asIfApplied}<Badge tone="warn">as-if</Badge>{/if}
        </p>
      {/if}
      <p class="mt-1 text-xs text-ink-muted">
        Fuel: {cd.rate.fuel.pct}% — {cd.rate.fuel.source}
        {#if cd.rate.fuel.source === 'TABLE' && cd.rate.fuel.effectiveFrom}
          (eff. {formatDate(cd.rate.fuel.effectiveFrom)})
        {/if}
      </p>
      {#if cd.result.missingAccessorials.length > 0}
        <p class="mt-1 text-xs text-danger">
          Missing accessorials: {cd.result.missingAccessorials.join(', ')}
        </p>
      {/if}
    </div>
  {/if}

  {#if rateOptionsOpen}
    <div class="mt-4 rounded-card border border-edge bg-surface-muted p-3">
      <div class="mb-2 flex items-center justify-between">
        <strong class="text-sm">Rate options</strong>
        <Button
          variant="ghost"
          onclick={() => {
            rateOptionsOpen = false;
          }}>Close</Button
        >
      </div>
      {#if rateOptionsLoading}
        <p class="text-sm text-ink-muted">Loading…</p>
      {:else if rateOptionsError}
        <p class="text-sm text-danger">{rateOptionsError}</p>
      {:else if rateOptions.length === 0}
        <p class="text-sm text-ink-muted">No rate options available.</p>
      {:else}
        {@const firstCompleteByCurrency = (() => {
          const seen = new Set<string>();
          const result = new Set<string>();
          for (const opt of rateOptions) {
            if (opt.missingAccessorials.length === 0 && !seen.has(opt.currency)) {
              seen.add(opt.currency);
              result.add(opt.rateId);
            }
          }
          return result;
        })()}
        <div class="flex flex-col gap-2">
          {#each rateOptions as opt (opt.rateId)}
            <div
              class="cursor-pointer rounded-md border border-edge bg-surface p-2 hover:bg-surface-muted"
              role="button"
              tabindex="0"
              onclick={() => {
                expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId;
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter')
                  expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId;
              }}
            >
              <div class="flex items-center justify-between gap-2 text-sm">
                <div class="flex items-center gap-1 flex-wrap">
                  <span class="font-medium">{opt.rateName}</span>
                  {#if firstCompleteByCurrency.has(opt.rateId)}
                    <Badge tone="ok">best</Badge>
                  {/if}
                  {#if opt.missingAccessorials.length > 0}
                    <Badge tone="warn">missing: {opt.missingAccessorials.length}</Badge>
                  {/if}
                </div>
                <span class="font-semibold whitespace-nowrap"
                  >{opt.breakdown.total.toLocaleString('fr-CA')} {opt.currency}</span
                >
              </div>
              <div class="mt-0.5 text-xs text-ink-muted">
                {opt.carrier?.name ?? '—'} ·
                {opt.laneSpecificity
                  ? `${opt.laneSpecificity.originType}→${opt.laneSpecificity.destinationType} (${opt.laneSpecificity.total})`
                  : 'catch-all'}
              </div>
              {#if expandedRateId === opt.rateId}
                <table class="mt-2 w-full text-xs">
                  <tbody>
                    {#each opt.breakdown.lines as line}
                      <tr>
                        <td class="py-0.5 text-ink-muted">{line.label}</td>
                        <td class="py-0.5 text-right"
                          >{line.amount.toLocaleString('fr-CA')} {opt.currency}</td
                        >
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
              <div class="mt-2" onclick={(e) => e.stopPropagation()} role="none">
                <Button variant="primary" onclick={() => assignRate(opt.rateId)}>Assign</Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</Card>
