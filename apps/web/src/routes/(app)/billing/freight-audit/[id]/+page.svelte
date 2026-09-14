<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    Skeleton,
    Select,
    Input,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  interface InvoiceLine {
    id: string;
    lineRef: string;
    description: string | null;
    chargedAmount: string;
    matchedLoadId: string | null;
    expectedAmount: string | null;
    variance: string | null;
  }
  interface IncomingInvoice {
    id: string;
    carrierInvoiceNumber: string;
    currency: string;
    chargedTotal: string;
    matchedTotal: string | null;
    varianceTotal: string | null;
    varianceGross: string | null;
    recoveredAmount: string | null;
    status: string;
    carrier: { name: string };
    lines: InvoiceLine[];
  }

  const REASON_CODES = [
    'RATE_MISMATCH',
    'QUANTITY_MISMATCH',
    'UNEXPECTED_CHARGE',
    'DUPLICATE_BILLING',
    'OTHER',
  ];

  const STATUS_TONE: Record<string, Tone> = {
    RECEIVED: 'neutral',
    MATCHED: 'ok',
    FLAGGED: 'warn',
    DISPUTED: 'danger',
    RESOLVED: 'ok',
    PAID: 'ok',
  };
  function statusTone(status: string): Tone {
    return STATUS_TONE[status] ?? 'neutral';
  }

  const invoiceId = $derived(page.params.id as string);

  let invoice = $state<IncomingInvoice | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);

  // Dispute / resolve form state
  let reasonCode = $state('RATE_MISMATCH');
  let note = $state('');
  let resolution = $state<'ACCEPT_CHARGED' | 'KEEP_EXPECTED'>('ACCEPT_CHARGED');

  async function load() {
    loading = true;
    try {
      invoice = await api<IncomingInvoice>(`/freight-audit/incoming-invoices/${invoiceId}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la facture';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void invoiceId;
    void load();
  });

  function money(amount: string | null, currency: string): string {
    if (amount === null) return '—';
    return `${Number(amount).toLocaleString()} ${currency}`;
  }

  async function act(verb: string, body: Record<string, unknown> = {}) {
    busy = true;
    try {
      await api(`/freight-audit/incoming-invoices/${invoiceId}/${verb}`, {
        method: 'POST',
        body,
      });
      toast.success('Action effectuée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de l’action');
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader title="Facture transporteur" />

{#if loading}
  <Card><Skeleton rows={6} /></Card>
{:else if error}
  <ErrorNotice message={error} onretry={load} />
{:else if invoice}
  {@const inv = invoice}
  <Card>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold text-ink">{invoice.carrierInvoiceNumber}</h2>
          <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
        </div>
        <p class="mt-1 text-sm text-ink-muted">{invoice.carrier.name}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if invoice.status === 'RECEIVED' || invoice.status === 'FLAGGED'}
          <Button variant="primary" loading={busy} disabled={busy} onclick={() => act('audit')}>
            Auditer
          </Button>
        {/if}
        {#if invoice.status === 'MATCHED' || invoice.status === 'RESOLVED'}
          <Button variant="primary" loading={busy} disabled={busy} onclick={() => act('pay')}>
            Payer
          </Button>
        {/if}
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div>
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Total facturé</p>
        <p class="mt-0.5 text-sm text-ink">{money(invoice.chargedTotal, invoice.currency)}</p>
      </div>
      <div>
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Total attendu</p>
        <p class="mt-0.5 text-sm text-ink">{money(invoice.matchedTotal, invoice.currency)}</p>
      </div>
      <div>
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Écart (net / brut)</p>
        <p class="mt-0.5 text-sm text-ink">
          {money(invoice.varianceTotal, invoice.currency)} / {money(invoice.varianceGross, invoice.currency)}
        </p>
      </div>
      <div>
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Récupéré</p>
        <p class="mt-0.5 text-sm text-ink">{money(invoice.recoveredAmount, invoice.currency)}</p>
      </div>
    </div>
  </Card>

  <!-- Dispute (FLAGGED) -->
  {#if invoice.status === 'FLAGGED'}
    <Card>
      <h3 class="mb-3 text-sm font-bold text-ink">Disputer la facture</h3>
      <div class="flex flex-wrap items-end gap-2">
        <div class="w-48">
          <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Motif</span>
          <Select bind:value={reasonCode}>
            {#each REASON_CODES as code (code)}<option value={code}>{code}</option>{/each}
          </Select>
        </div>
        <div class="min-w-40 flex-1">
          <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Note</span>
          <Input bind:value={note} placeholder="Optionnel" />
        </div>
        <Button
          variant="danger"
          loading={busy}
          disabled={busy}
          onclick={() => act('dispute', { reasonCode, note: note || undefined })}
        >Disputer</Button>
      </div>
    </Card>
  {/if}

  <!-- Resolve (DISPUTED) -->
  {#if invoice.status === 'DISPUTED'}
    <Card>
      <h3 class="mb-3 text-sm font-bold text-ink">Résoudre la dispute</h3>
      <div class="flex flex-wrap items-end gap-2">
        <div class="w-52">
          <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Résolution</span>
          <Select bind:value={resolution}>
            <option value="ACCEPT_CHARGED">Accepter le montant facturé</option>
            <option value="KEEP_EXPECTED">Conserver le montant attendu</option>
          </Select>
        </div>
        <div class="w-48">
          <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Motif</span>
          <Select bind:value={reasonCode}>
            {#each REASON_CODES as code (code)}<option value={code}>{code}</option>{/each}
          </Select>
        </div>
        <div class="min-w-40 flex-1">
          <span class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Note</span>
          <Input bind:value={note} placeholder="Optionnel" />
        </div>
        <Button
          variant="primary"
          loading={busy}
          disabled={busy}
          onclick={() => act('resolve', { resolution, reasonCode, note: note || undefined })}
        >Résoudre</Button>
      </div>
    </Card>
  {/if}

  <!-- Lines -->
  <div class="mt-4">
    <Table>
      {#snippet head()}
        <th>Réf.</th><th>Description</th><th class="text-right">Facturé</th>
        <th>Load</th><th class="text-right">Attendu</th><th class="text-right">Écart</th>
      {/snippet}
      {#snippet body()}
        {#each inv.lines as line (line.id)}
          <tr>
            <td>{line.lineRef}</td>
            <td>{line.description ?? '—'}</td>
            <td class="text-right">{money(line.chargedAmount, inv.currency)}</td>
            <td>{line.matchedLoadId ?? '—'}</td>
            <td class="text-right">{money(line.expectedAmount, inv.currency)}</td>
            <td class="text-right">{money(line.variance, inv.currency)}</td>
          </tr>
        {/each}
      {/snippet}
    </Table>
  </div>
{/if}
