<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
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
    status: string;
    varianceGross: string | null;
    recoveredAmount: string | null;
    carrier: { name: string };
    lines: InvoiceLine[];
  }
  interface Savings {
    tenantTotal: string;
    byAgent: { agentId: string; recovered: string }[];
  }

  // Freight-audit status → tone. (Distinct from the shared toneFor: MATCHED here
  // means a clean reconciliation → ok, FLAGGED is a warning, DISPUTED a danger.)
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

  let invoices = $state<IncomingInvoice[]>([]);
  let savings = $state<Savings | null>(null);
  let loading = $state(true);
  let error = $state('');

  const flaggedCount = $derived(invoices.filter((i) => i.status === 'FLAGGED' || i.status === 'DISPUTED').length);
  const receivedCount = $derived(invoices.filter((i) => i.status === 'RECEIVED').length);
  const recoveredTotal = $derived(savings ? Number(savings.tenantTotal).toLocaleString() : '—');

  async function load() {
    loading = true;
    try {
      const [inv, sav] = await Promise.all([
        api<IncomingInvoice[]>('/freight-audit/incoming-invoices'),
        api<Savings>('/freight-audit/savings', { query: { days: 30 } }),
      ]);
      invoices = inv;
      savings = sav;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des factures transporteur';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function money(amount: string | null, currency: string): string {
    if (amount === null) return '—';
    return `${Number(amount).toLocaleString()} ${currency}`;
  }

  // ── Manual intake form (modal) ─────────────────────────────────────────────
  interface LineDraft {
    lineRef: string;
    chargedAmount: string;
  }

  let modalOpen = $state(false);
  let carrierId = $state('');
  let carrierInvoiceNumber = $state('');
  let currency = $state('');
  let lines = $state<LineDraft[]>([{ lineRef: '', chargedAmount: '' }]);
  let saving = $state(false);

  function resetForm() {
    carrierId = '';
    carrierInvoiceNumber = '';
    currency = '';
    lines = [{ lineRef: '', chargedAmount: '' }];
  }

  function addLine() {
    lines = [...lines, { lineRef: '', chargedAmount: '' }];
  }

  function removeLine(index: number) {
    lines = lines.filter((_, i) => i !== index);
  }

  const canSubmit = $derived(
    carrierId.trim() !== '' &&
      carrierInvoiceNumber.trim() !== '' &&
      lines.length > 0 &&
      lines.every((l) => l.lineRef.trim() !== '' && l.chargedAmount.trim() !== ''),
  );

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    saving = true;
    try {
      await api<IncomingInvoice>('/freight-audit/incoming-invoices', {
        method: 'POST',
        body: {
          carrierId: carrierId.trim(),
          carrierInvoiceNumber: carrierInvoiceNumber.trim(),
          ...(currency.trim() ? { currency: currency.trim() } : {}),
          lines: lines.map((l) => ({
            lineRef: l.lineRef.trim(),
            chargedAmount: Number(l.chargedAmount),
          })),
        },
      });
      toast.success('Facture transporteur saisie');
      resetForm();
      modalOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la saisie de la facture');
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader
  title="Freight Audit"
  subtitle="Match carrier invoices against load cost snapshots, flag variances, and track recovered savings."
>
  {#snippet actions()}
    <Button variant="primary" onclick={() => { modalOpen = true; }}>Saisir une facture</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{recoveredTotal} $</div><div class="text-xs uppercase tracking-wide text-ink-muted">Recovered 30d</div><p class="mt-1 text-xs text-ink-faint">Savings attributed to invoice variance resolution.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{flaggedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Needs review</div><p class="mt-1 text-xs text-ink-faint">Flagged or disputed invoices to inspect.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{receivedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">New intake</div><p class="mt-1 text-xs text-ink-faint">Received invoices awaiting matching.</p></Card>
</div>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Facture #</th><th>Transporteur</th><th class="text-right">Total facturé</th>
      <th>Statut</th><th class="text-right">Écart (brut)</th>
    {/snippet}
    {#snippet body()}
      {#each invoices as invoice (invoice.id)}
        <tr>
          <td>
            <a
              href={`/billing/freight-audit/${invoice.id}`}
              class="text-sm font-semibold text-accent hover:underline"
            >{invoice.carrierInvoiceNumber}</a>
          </td>
          <td>{invoice.carrier.name}</td>
          <td class="text-right">{money(invoice.chargedTotal, invoice.currency)}</td>
          <td><Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge></td>
          <td class="text-right">{money(invoice.varianceGross, invoice.currency)}</td>
        </tr>
      {:else}
        <tr><td colspan="5"><EmptyState title="No carrier invoices yet" message="Enter a carrier invoice to compare charged lines against frozen load cost details and surface recoverable variances.">
          {#snippet children()}<Button variant="secondary" href="/loads">Review loads</Button><Button onclick={() => { modalOpen = true; }}>Enter first invoice</Button>{/snippet}
        </EmptyState></td></tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={modalOpen} title="Saisir une facture transporteur">
  {#snippet children()}
    <form onsubmit={create}>
      <Field label="Carrier ID">
        <Input bind:value={carrierId} required placeholder="ID du transporteur" />
      </Field>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Numéro de facture transporteur">
          <Input bind:value={carrierInvoiceNumber} required placeholder="ex. INV-12345" />
        </Field>
        <Field label="Devise">
          <Input bind:value={currency} placeholder="Optionnel — ex. CAD" />
        </Field>
      </div>

      <div class="mt-4">
        <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Lignes
        </span>
        <div class="space-y-2">
          {#each lines as line, i (i)}
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <Field label="Réf. ligne">
                  <Input bind:value={line.lineRef} placeholder="ex. L-1" />
                </Field>
              </div>
              <div class="w-36">
                <Field label="Montant facturé">
                  <Input type="number" bind:value={line.chargedAmount} placeholder="0.00" />
                </Field>
              </div>
              <Button
                variant="ghost"
                onclick={() => removeLine(i)}
                disabled={lines.length === 1}
              >Retirer</Button>
            </div>
          {/each}
        </div>
        <div class="mt-2">
          <Button variant="secondary" onclick={addLine}>Ajouter une ligne</Button>
        </div>
      </div>

      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { modalOpen = false; }}>Annuler</Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!canSubmit || saving}>
          Saisir
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>
