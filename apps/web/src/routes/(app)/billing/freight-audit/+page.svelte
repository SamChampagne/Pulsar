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

<PageHeader title="Freight Audit">
  {#snippet actions()}
    <Button variant="primary" onclick={() => { modalOpen = true; }}>Saisir une facture</Button>
  {/snippet}
</PageHeader>

<Card>
  <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
    Économies récupérées (30 j)
  </p>
  <p class="mt-1 text-2xl font-bold text-ink">
    {savings ? `${Number(savings.tenantTotal).toLocaleString()} $` : '—'}
  </p>
</Card>

<p class="my-4 text-sm text-ink-muted">
  Les factures entrantes des transporteurs sont rapprochées ligne par ligne avec les coûts
  attendus. Les écarts sont signalés (FLAGGED), peuvent être disputés, puis résolus et payés.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

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
        <tr><td colspan="5"><EmptyState message="Aucune facture transporteur pour l'instant." /></td></tr>
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
