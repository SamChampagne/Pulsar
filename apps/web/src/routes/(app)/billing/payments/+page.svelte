<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    toneFor,
    labelFor,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ─────────────────────────────────────────────────────────────────────

  interface AllocationRow {
    id: string;
    amount: string;
  }

  interface PaymentRow {
    id: string;
    paymentNumber: string;
    type: 'RECEIVE' | 'PAY';
    partyType: string;
    partyId: string;
    date: string;
    totalAmount: string;
    status: 'DRAFT' | 'SUBMITTED' | 'CANCELLED';
    modeOfPayment: string | null;
    allocations: AllocationRow[];
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  let payments = $state<PaymentRow[]>([]);
  let statusFilter = $state('');
  let typeFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── Derived KPI ──────────────────────────────────────────────────────────────

  const submittedTotal = $derived(
    payments
      .filter((p) => p.status === 'SUBMITTED')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0),
  );
  const submittedCount = $derived(payments.filter((p) => p.status === 'SUBMITTED').length);

  // ── Tone map for payment type ─────────────────────────────────────────────────

  function typeTone(type: 'RECEIVE' | 'PAY'): Tone {
    return type === 'RECEIVE' ? 'ok' : 'info';
  }

  // SUBMITTED is not in the shared STATUS_TONE map; map it manually.
  function statusTone(status: string): Tone {
    if (status === 'SUBMITTED') return 'warn';
    return toneFor(status);
  }

  // ── Load ──────────────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      payments = await api<PaymentRow[]>('/billing/payments', {
        query: {
          status: statusFilter || undefined,
          type: typeFilter || undefined,
        },
      });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load payments';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void statusFilter;
    void typeFilter;
    void load();
  });
</script>

<PageHeader
  title="Paiements"
  subtitle="Enregistrez et suivez les encaissements clients et les décaissements fournisseurs."
>
  {#snippet actions()}
    <Button onclick={() => goto('/billing/payments/new')}>Nouvelle écriture de paiement</Button>
  {/snippet}
</PageHeader>

<!-- KPI cards -->
<div class="mb-5 grid gap-3 md:grid-cols-2">
  <Card>
    <div class="text-xl font-bold text-ink">{payments.length}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Total paiements</div>
    <p class="mt-1 text-xs text-ink-faint">Tous statuts confondus.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-warn">
      {submittedTotal.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
      En attente ({submittedCount} paiement{submittedCount !== 1 ? 's' : ''} soumis)
    </div>
    <p class="mt-1 text-xs text-ink-faint">Montant total des paiements soumis non finalisés.</p>
  </Card>
</div>

<FilterBar>
  <div class="w-40">
    <Select bind:value={statusFilter}>
      <option value="">Tous les statuts</option>
      <option value="DRAFT">Brouillon</option>
      <option value="SUBMITTED">Soumis</option>
      <option value="CANCELLED">Annulé</option>
    </Select>
  </div>
  <div class="w-36">
    <Select bind:value={typeFilter}>
      <option value="">Tous les types</option>
      <option value="RECEIVE">Encaissement</option>
      <option value="PAY">Décaissement</option>
    </Select>
  </div>
</FilterBar>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>N° paiement</th>
      <th>Type</th>
      <th>Partie</th>
      <th>Date</th>
      <th>Mode</th>
      <th class="text-right">Montant</th>
      <th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each payments as payment (payment.id)}
        <tr>
          <td class="font-mono text-sm font-semibold text-ink">{payment.paymentNumber}</td>
          <td>
            <Badge tone={typeTone(payment.type)}>
              {payment.type === 'RECEIVE' ? 'Encaissement' : 'Décaissement'}
            </Badge>
          </td>
          <td class="text-sm text-ink-muted">{payment.partyType} · {payment.partyId}</td>
          <td class="text-sm">{formatDate(payment.date)}</td>
          <td class="text-sm text-ink-muted">{payment.modeOfPayment ?? '—'}</td>
          <td class="text-right font-mono text-sm">
            {Number(payment.totalAmount).toLocaleString('fr-CA', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </td>
          <td>
            <Badge tone={statusTone(payment.status)}>{labelFor(payment.status)}</Badge>
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="7">
            <EmptyState
              title="Aucun paiement"
              message="Enregistrez votre première écriture de paiement pour suivre les encaissements et décaissements."
            >
              {#snippet children()}
                <Button onclick={() => goto('/billing/payments/new')}>
                  Nouvelle écriture de paiement
                </Button>
              {/snippet}
            </EmptyState>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}
